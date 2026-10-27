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
const { restoreFromCloudVault, scheduleCloudSync } = require('./src/services/cloudPersistenceService');

const app = express();
const PORT = process.env.PORT || 3333;

app.disable('x-powered-by');

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

// Static assets (allow dotfiles for /.well-known domain verification)
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'allow' }));

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(cors());

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
    sameSite: 'lax'
  }
}));

// CSRF & User injection
app.use(csrfMiddleware);
app.use(injectUser);

// Automatically persist any state-mutating request (signup, KYC, balance, admin delete) to the permanent Cloud Vault
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    res.on('finish', () => {
      scheduleCloudSync(db, 800);
    });
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

// Restore permanent live users & state from Cloud Vault before accepting traffic
(async () => {
  await restoreFromCloudVault(db);
  startWorkers(db);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mainstreet Capital Exchange platform is live at http://localhost:${PORT}`);
  });
})();
