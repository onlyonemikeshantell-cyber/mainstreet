require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});

const express = require('express');
const session = require('express-session');
const path = require('path');
const zlib = require('zlib');
const cors = require('cors');

// Import DB & Middleware
const db = require('./src/db');
const { injectUser } = require('./src/middleware/auth');
const csrfMiddleware = require('./src/middleware/csrf');

// Import Routes
const publicRoutes = require('./src/routes/public');
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user');
const adminRoutes = require('./src/routes/admin');
const retirementRoutes = require('./src/routes/retirement');

// Import Background Workers & Cloud Vault Persistence
const { startWorkers } = require('./src/workers/tradingWorkers');
const { restoreFromCloudVault, scheduleCloudSync, recordLocalMutation } = require('./src/services/cloudPersistenceService');

const app = express();
const PORT = process.env.PORT || 3333;

app.disable('x-powered-by');

// Lightweight zero-DB health check endpoint for instant Render port detection & uptime pings
app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, uptime: Math.round(process.uptime()) });
});

// HTTP Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});

app.set('trust proxy', 1);

// View engine setup
app.set('views', path.join(__dirname, 'src', 'views'));
app.set('view engine', 'ejs');

// Zero-dependency Gzip compression for HTML, JSON, JS, CSS, SVG (~75-85% smaller payloads)
app.use((req, res, next) => {
  const acceptEnc = String(req.headers['accept-encoding'] || '');
  if (!acceptEnc.includes('gzip') || req.method === 'HEAD') return next();
  const origSend = res.send.bind(res);
  res.send = function(body) {
    try {
      if (res.headersSent || res.getHeader('Content-Encoding') || body == null) return origSend(body);
      // Ensure Content-Type is set BEFORE bypassing Express's origSend (res.render calls res.send without Content-Type set yet!)
      let ct = String(res.getHeader('Content-Type') || '');
      if (!ct) {
        if (typeof body === 'string') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          ct = 'text/html; charset=utf-8';
        } else if (typeof body === 'object' && !Buffer.isBuffer(body)) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          ct = 'application/json; charset=utf-8';
        } else {
          return origSend(body);
        }
      }
      const isCompressible = /html|json|javascript|css|svg|text|xml/i.test(ct);
      if (!isCompressible) return origSend(body);
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
      if (buf.length < 1024) return origSend(body);
      const gz = zlib.gzipSync(buf, { level: 6 });
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', gz.length);
      return res.end(gz);
    } catch (e) {
      return origSend(body);
    }
  };
  next();
});

// Static assets with 7-day browser caching (allow dotfiles for /.well-known domain verification)
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'allow',
  maxAge: '7d',
  etag: true,
  lastModified: true
}));

// Body parsing: 50mb scoped strictly to KYC/media upload routes; 2mb default everywhere else
const largeBodyUrlencoded = express.urlencoded({ extended: true, limit: '50mb' });
const largeBodyJson = express.json({ limit: '50mb' });
const defaultBodyUrlencoded = express.urlencoded({ extended: true, limit: '2mb' });
const defaultBodyJson = express.json({ limit: '2mb' });
const LARGE_UPLOAD_PREFIXES = [
  '/register',
  '/onboarding/kyc',
  '/settings',
  '/babyoku/copy-trading/master',
  '/admin/copy-trading/master',
  '/babyoku/gateways',
  '/admin/gateways'
];
app.use((req, res, next) => {
  const isLarge = LARGE_UPLOAD_PREFIXES.some(p => req.path.startsWith(p));
  return (isLarge ? largeBodyUrlencoded : defaultBodyUrlencoded)(req, res, (err) => {
    if (err) return next(err);
    return (isLarge ? largeBodyJson : defaultBodyJson)(req, res, next);
  });
});

// Strict CORS allowlist (same-origin requests have no Origin header and always pass)
const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    const allowed =
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
      /^https:\/\/([a-z0-9-]+\.)?mainstreetcapitalx\.com$/i.test(origin) ||
      /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin) ||
      extraAllowedOrigins.includes(origin);
    return cb(null, allowed);
  },
  credentials: true
}));

// Lightweight IP rate limiter for sensitive auth endpoints
const authRateBuckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authRateBuckets) {
    if (v.resetAt < now) authRateBuckets.delete(k);
  }
}, 10 * 60 * 1000).unref();

const createRateLimiter = (prefix, maxHits, windowMs) => (req, res, next) => {
  if (req.method !== 'POST') return next();
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const key = prefix + ':' + ip;
  const now = Date.now();
  let bucket = authRateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    authRateBuckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > maxHits) {
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    if (req.session) req.session.flash = { error: 'Too many attempts from your network. Please wait 15 minutes and try again.' };
    return res.status(429).redirect(req.headers.referer || '/');
  }
  next();
};
app.use(['/babyoku/login', '/admin/login'], createRateLimiter('admin_login', 8, 15 * 60 * 1000));
app.use('/register', createRateLimiter('register', 12, 15 * 60 * 1000));
app.use('/forgot-password', createRateLimiter('forgot', 8, 15 * 60 * 1000));

// Persistent SQLite Session Store (survives server restarts)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
`);

class SQLiteSessionStore extends session.Store {
  constructor() {
    super();
    setInterval(() => {
      try {
        db.prepare('DELETE FROM user_sessions WHERE expire < ?').run(Date.now());
      } catch (e) {}
    }, 15 * 60 * 1000).unref();
  }
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expire FROM user_sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) {
        db.prepare('DELETE FROM user_sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.sess));
    } catch (err) {
      return cb(err);
    }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = (sess && sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : (1000 * 60 * 60 * 24 * 7);
      const expire = Date.now() + maxAge;
      db.prepare(`
        INSERT INTO user_sessions (sid, sess, expire)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
      `).run(sid, JSON.stringify(sess), expire);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }
  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM user_sessions WHERE sid = ?').run(sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }
  touch(sid, sess, cb) {
    try {
      const maxAge = (sess && sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : (1000 * 60 * 60 * 24 * 7);
      const expire = Date.now() + maxAge;
      db.prepare('UPDATE user_sessions SET expire = ? WHERE sid = ?').run(expire, sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }
}

// Prevent browser/proxy from caching guest HTML across login/logout transitions
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie');
  next();
});

// Session setup
app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || 'mainstreet_secure_jwt_token_session_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto'
  }
}));

// CSRF & User injection
app.use(csrfMiddleware);
app.use(injectUser);

// Automatically persist any state-mutating request (signup, KYC, balance, admin delete) to the permanent Cloud Vault
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    recordLocalMutation(db);
    res.on('finish', () => {
      scheduleCloudSync(db, 500);
    });
  }
  next();
});

// Graceful shutdown: flush SQLite WAL and push final snapshot to Cloud Vault before Render kills the process
const { syncToCloudVault } = require('./src/services/cloudPersistenceService');
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Shutdown] Received ${signal}. Flushing database to Cloud Vault before exit...`);
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
  try { await syncToCloudVault(db); } catch (e) {}
  process.exit(0);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Bind port immediately for fast Render boot; restore Cloud Vault snapshot concurrently in background
let vaultReadyPromise = null;

// Gate state-mutating requests briefly until initial Cloud Vault restore finishes so writes are never lost
app.use(async (req, res, next) => {
  if (vaultReadyPromise && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    try {
      await Promise.race([
        vaultReadyPromise,
        new Promise(r => setTimeout(r, 6000))
      ]);
    } catch (e) {}
  }
  next();
});

// Mount application routes
app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', adminRoutes);
app.use('/', retirementRoutes);
app.use('/', userRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).render('errors/404', { 
    title: '404 - Page Not Located | Mainstreet Capital Exchange'
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Server Unhandled Error:', err);
  res.status(500).send('Internal Server Error');
});

// Start HTTP listener immediately so Render marks the service Live in ~1s
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mainstreet Capital Exchange platform is live at http://localhost:${PORT}`);

  // Restore permanent live users & state from Cloud Vault in the background
  vaultReadyPromise = restoreFromCloudVault(db)
    .catch(err => console.error('[CloudVault] Background restore error:', err.message))
    .finally(() => {
      vaultReadyPromise = null;
      startWorkers(db);
    });
});
