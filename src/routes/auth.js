const fs = require('fs');
const path = require('path');

// Login & Reset brute-force limiter state (in-memory; resets on server restart)
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_IP_LOGIN_ATTEMPTS = 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();
const ipAttempts = new Map();
const passwordResetAttempts = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, r] of loginAttempts) {
    if (r.lockedUntil < now && now - r.first > LOGIN_WINDOW_MS) loginAttempts.delete(k);
  }
  for (const [k, r] of ipAttempts) {
    if (r.lockedUntil < now && now - r.first > LOGIN_WINDOW_MS) ipAttempts.delete(k);
  }
  for (const [k, r] of passwordResetAttempts) {
    if (now - r.first > LOGIN_WINDOW_MS) passwordResetAttempts.delete(k);
  }
}, 10 * 60 * 1000).unref();

// Helper to save base64 media (image/video) securely to private storage/kyc
const saveBase64Media = (base64String, prefix, userId) => {
  if (!base64String || typeof base64String !== 'string' || !base64String.includes('base64,')) {
    return null;
  }
  try {
    const kycDir = path.join(__dirname, '..', '..', 'storage', 'kyc');
    if (!fs.existsSync(kycDir)) {
      fs.mkdirSync(kycDir, { recursive: true });
    }

    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return null;
    }

    const mime = matches[1];
    const data = Buffer.from(matches[2], 'base64');
    let ext = 'jpg';
    if (mime.includes('png')) ext = 'png';
    else if (mime.includes('webm')) ext = 'webm';
    else if (mime.includes('mp4')) ext = 'mp4';

    const filename = `${prefix}_user_${userId}_${Date.now()}.${ext}`;
    const filePath = path.join(kycDir, filename);
    fs.writeFileSync(filePath, data);
    return `/babyoku/kyc/file/${filename}`;
  } catch (err) {
    console.error('Failed to save base64 media:', err.message);
    return null;
  }
};

const express = require('express');
const router = express.Router();

// ==============================================================================
// RFC 6238 TOTP ENGINE & CRYPTOGRAPHIC UTILITIES
// ==============================================================================

// Base32 Decoding & Standard RFC 6238 TOTP Verification
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Decode = (base32) => {
  let clean = base32.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = base32Alphabet.indexOf(clean.charAt(i));
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
};

const generateTotpCode = (secret, timeStepOffset = 0) => {
  try {
    const key = base32Decode(secret);
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / 30) + timeStepOffset;
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24) |
                   ((hmac[offset + 1] & 0xff) << 16) |
                   ((hmac[offset + 2] & 0xff) << 8) |
                   (hmac[offset + 3] & 0xff);
    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
  } catch(e) {
    return null;
  }
};

const verifyTotp = (secret, token) => {
  if (!secret || !token) return false;
  const cleanToken = token.toString().trim();
  // Check current window, -1, and +1 for clock drift tolerance
  for (let offset of [-1, 0, 1]) {
    const expected = generateTotpCode(secret, offset);
    if (expected === cleanToken) return true;
  }
  return false;
};

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../db');

// Generate a random math captcha
const generateCaptcha = (req) => {
  const num1 = Math.floor(Math.random() * 9) + 1;
  const num2 = Math.floor(Math.random() * 9) + 1;
  req.session.captchaAnswer = (num1 + num2).toString();
  req.session.captchaQuestion = `${num1} + ${num2} = ?`;
  return req.session.captchaQuestion;
};

// Helper activity logger
const logActivity = (userId, action, details, req) => {
  try {
    const ip = null;
    const ua = req.headers['user-agent'] || 'Unknown Browser';
    db.prepare(`
      INSERT INTO activity_logs (user_id, action, ip_address, user_agent, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, ip, ua, details);
  } catch (e) {}
};

// Unified Mailer Service (Resend / SMTP / Sandbox)
const { sendEmail } = require('../services/mailer');

// GET /login
router.get('/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (req.session.userId) {
    const user = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(req.session.userId);
    if (user && user.is_active !== 0) {
      if (user.role === 'admin') return res.redirect('/babyoku');
      return res.redirect('/dashboard');
    }
    req.session.userId = null;
  }
  if (req.query.loggedOut === '1' && (!res.locals.flash || (!res.locals.flash.success && !res.locals.flash.error))) {
    res.locals.flash = { success: 'You have been signed out securely.' };
  }
  res.render('auth/login', { title: 'Sign In | Mainstreet Capital Exchange' });
});

// GET /babyoku/login (and alias /admin/login -> /babyoku/login)
router.get(['/babyoku/login', '/admin/login'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (req.path.startsWith('/admin')) {
    return res.redirect('/babyoku/login');
  }
  if (req.session.userId) {
    const user = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(req.session.userId);
    if (user && user.role === 'admin' && user.is_active !== 0) {
      return res.redirect('/babyoku');
    }
  }
  if (req.query.loggedOut === '1' && (!res.locals.flash || (!res.locals.flash.success && !res.locals.flash.error))) {
    res.locals.flash = { success: 'Executive session terminated securely.' };
  }
  res.render('auth/admin-login', { 
    title: 'Executive Console Login | Mainstreet Capital Exchange',
    loginAction: '/babyoku/login'
  });
});

// POST /login, /babyoku/login & /admin/login (with Brute-Force Rate Limiting & 2FA Enforcement)
router.post(['/login', '/babyoku/login', '/admin/login'], (req, res) => {
  const isAdminPath = req.path.includes('admin') || req.path.includes('babyoku');
  const redirectTarget = isAdminPath ? '/babyoku/login' : '/login';
  const { email, password } = req.body;
  if (!email || !password) {
    req.session.flash = { error: 'Please enter both your email and password.' };
    return req.session.save(() => res.redirect(redirectTarget));
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  const now = Date.now();
  const ipKey = req.ip;
  const attemptKey = `${req.ip}|${cleanEmail}`;

  // 1. IP-level brute-force guard
  const ipRecord = ipAttempts.get(ipKey);
  if (ipRecord && ipRecord.lockedUntil > now) {
    const mins = Math.ceil((ipRecord.lockedUntil - now) / 60000);
    req.session.flash = { error: `Too many failed attempts from your IP. Access temporarily throttled for ${mins} minute${mins === 1 ? '' : 's'}.` };
    return req.session.save(() => res.redirect(redirectTarget));
  }

  // 2. Account-level brute-force guard
  const record = loginAttempts.get(attemptKey);
  if (record && record.lockedUntil > now) {
    const mins = Math.ceil((record.lockedUntil - now) / 60000);
    req.session.flash = { error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
    return req.session.save(() => res.redirect(redirectTarget));
  }

  const registerFailure = () => {
    // Increment account attempts
    const r = loginAttempts.get(attemptKey) || { count: 0, first: now, lockedUntil: 0 };
    if (now - r.first > LOGIN_WINDOW_MS) { r.count = 0; r.first = now; }
    r.count += 1;
    if (r.count >= MAX_LOGIN_ATTEMPTS) r.lockedUntil = now + LOGIN_WINDOW_MS;
    loginAttempts.set(attemptKey, r);

    // Increment IP attempts
    const ir = ipAttempts.get(ipKey) || { count: 0, first: now, lockedUntil: 0 };
    if (now - ir.first > LOGIN_WINDOW_MS) { ir.count = 0; ir.first = now; }
    ir.count += 1;
    if (ir.count >= MAX_IP_LOGIN_ATTEMPTS) ir.lockedUntil = now + LOGIN_WINDOW_MS;
    ipAttempts.set(ipKey, ir);
  };

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);
  const storedHash = user ? (user.password || '') : '';
  let match = false;
  try {
    match = !!storedHash && storedHash.startsWith('$2') && bcrypt.compareSync(password, storedHash);
  } catch (e) {
    match = false;
  }

  if (!user || !match) {
    registerFailure();
    req.session.flash = { error: 'Invalid email or password.' };
    return req.session.save(() => res.redirect(redirectTarget));
  }

  if (isAdminPath && user.role !== 'admin') {
    registerFailure();
    req.session.flash = { error: 'Access denied: Administrator credentials are required for the Executive Console.' };
    return req.session.save(() => res.redirect(redirectTarget));
  }

  if (user.is_active === 0) {
    req.session.flash = { error: 'Your account is currently suspended. Please contact our compliance desk.' };
    return req.session.save(() => res.redirect(redirectTarget));
  }

  // Clear failed attempts upon successful password match
  loginAttempts.delete(attemptKey);

  // 2FA TOTP Authentication Check
  if (user.two_factor_enabled === 1 && user.two_factor_secret) {
    req.session.pending2faUserId = user.id;
    req.session.pending2faIsAdmin = (user.role === 'admin' && isAdminPath);
    req.session.twoFaAttempts = 0;
    return req.session.save(() => res.redirect('/login/2fa'));
  }

  req.session.userId = user.id;
  req.session.adminId = null;
  // Rotate CSRF token on privilege transition
  req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  logActivity(user.id, 'LOGIN', `User logged in successfully via ${req.path}`, req);
  req.session.flash = { success: `Welcome back, ${user.name}!` };

  return req.session.save(() => {
    if (user.role === 'admin') {
      return res.redirect('/babyoku');
    }
    if (user.email_verified === 0) {
      req.session.flash = { error: 'Step 3 of 4: Please verify your email address to proceed with onboarding.' };
      return res.redirect('/verify-email');
    }
    if (user.kyc_status === 'unverified') {
      req.session.flash = { error: 'Step 4 of 4: Please upload your identification document to complete onboarding.' };
      return res.redirect('/onboarding/kyc');
    }
    return res.redirect('/dashboard');
  });
});

// GET /login/2fa -> Render 2FA verification prompt
router.get('/login/2fa', (req, res) => {
  if (!req.session.pending2faUserId) {
    return res.redirect('/login');
  }
  res.render('auth/login-2fa', { title: 'Two-Factor Authentication | Mainstreet Capital Exchange' });
});

// POST /login/2fa -> Verify 6-digit TOTP code
router.post('/login/2fa', (req, res) => {
  if (!req.session.pending2faUserId) {
    return res.redirect('/login');
  }

  const { totp_code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.pending2faUserId);
  if (!user || !user.two_factor_secret) {
    req.session.pending2faUserId = null;
    return req.session.save(() => res.redirect('/login'));
  }

  // Rate-limit 2FA attempts: maximum 5 attempts per session
  req.session.twoFaAttempts = (req.session.twoFaAttempts || 0) + 1;
  if (req.session.twoFaAttempts > 5) {
    req.session.pending2faUserId = null;
    req.session.pending2faIsAdmin = null;
    req.session.twoFaAttempts = 0;
    req.session.flash = { error: 'Too many invalid 2FA attempts. For your security, please sign in again.' };
    return req.session.save(() => res.redirect('/login'));
  }

  const isValid = verifyTotp(user.two_factor_secret, totp_code);
  if (!isValid) {
    const remaining = 6 - req.session.twoFaAttempts;
    req.session.flash = { error: `Invalid 2FA code (${remaining} attempt${remaining === 1 ? '' : 's'} remaining). Please enter the current 6-digit code from your Authenticator app.` };
    return req.session.save(() => res.redirect('/login/2fa'));
  }

  // Authentication fully validated
  const isAdminLogin = req.session.pending2faIsAdmin;
  req.session.userId = user.id;
  req.session.pending2faUserId = null;
  req.session.pending2faIsAdmin = null;
  req.session.twoFaAttempts = 0;
  // Rotate CSRF token on privilege transition
  req.session.csrfToken = crypto.randomBytes(24).toString('hex');

  logActivity(user.id, 'LOGIN_2FA_SUCCESS', `2FA Authenticated successfully`, req);

  return req.session.save(() => {
    if (isAdminLogin || user.role === 'admin') {
      return res.redirect('/babyoku');
    }
    if (user.kyc_status === 'unverified') {
      req.session.flash = { error: 'Compulsory KYC Identity Verification required. Complete onboarding to access trading.' };
      return res.redirect('/onboarding/kyc');
    }
    if (user.email_verified === 0) {
      req.session.flash = { error: 'Step 4 of 4: Please verify your email address to access your trading account.' };
      return res.redirect('/verify-email');
    }
    return res.redirect('/dashboard');
  });
});

// GET /register
router.get('/register', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (req.session.userId) {
    const user = db.prepare('SELECT id, role, is_active, kyc_status, email_verified FROM users WHERE id = ?').get(req.session.userId);
    if (user && user.is_active !== 0) {
      if (user.role === 'admin') return res.redirect('/babyoku');
      if (user.email_verified === 0) return res.redirect('/verify-email');
      if (user.kyc_status === 'unverified') return res.redirect('/onboarding/kyc');
      return res.redirect('/dashboard');
    }
    req.session.userId = null;
  }
  const captchaQuestion = generateCaptcha(req);
  res.render('auth/register', { 
    title: 'Open Live Account | Mainstreet Capital Exchange',
    captchaQuestion,
    csrfToken: res.locals.csrfToken || req.session.csrfToken || 'txe_token'
  });
});

// POST /register - Streamlined High-Converting Instant Onboarding with Mandatory KYC
// Sequence: Details (Step 1) -> Live Verification (Step 2) -> Email OTP (Step 3) -> Upload ID (Step 4)
router.post('/register', async (req, res) => {
  const { 
    name, email, phone, country, password, confirm_password,
    doc_type, doc_number, front_image, back_image,
    video_data
  } = req.body;

  if (!name || !email || !password) {
    req.session.flash = { error: 'Please enter your name, email address, and password.' };
    return req.session.save(() => res.redirect('/register'));
  }

  if (!confirm_password || password !== confirm_password) {
    req.session.flash = { error: 'Passwords do not match. Please verify and re-enter.' };
    return req.session.save(() => res.redirect('/register'));
  }

  if (password.length < 6) {
    req.session.flash = { error: 'Password must be at least 6 characters long.' };
    return req.session.save(() => res.redirect('/register'));
  }

  // Step 2: ID Verification Enforcement
  const effectiveBackImage = back_image || (doc_type === 'International Passport' ? front_image : null);
  if (!doc_type || !doc_number || !front_image || !effectiveBackImage) {
    req.session.flash = { error: 'Please provide complete government ID document details and photos.' };
    return req.session.save(() => res.redirect('/register'));
  }

  // Step 3: Live Biometric Verification Enforcement
  if (!video_data) {
    req.session.flash = { error: 'Please complete the live biometric verification step to proceed with onboarding.' };
    return req.session.save(() => res.redirect('/register'));
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(cleanEmail);
  if (existing) {
    req.session.flash = { error: 'An account with that email already exists. Please log in.' };
    return req.session.save(() => res.redirect('/login'));
  }

  const systemSettings = db.prepare('SELECT auto_approve_kyc, didit_auto_approve FROM system_settings WHERE id = 1').get() || {};
  const isAutoApprove = ((systemSettings.auto_approve_kyc ?? systemSettings.didit_auto_approve) === 1);
  const initialKycStatus = isAutoApprove ? 'verified' : 'pending';
  const docStatus = isAutoApprove ? 'approved' : 'pending';

  const hash = bcrypt.hashSync(password, 10);
  const emailCode = Math.floor(100000 + Math.random() * 900000).toString();
  const codeExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  try {
    const result = db.prepare(`
      INSERT INTO users (name, email, phone, country, password, role, balance, equity, currency, kyc_status, email_verified, email_verification_code, email_verification_expires, is_active)
      VALUES (?, ?, ?, ?, ?, 'user', 10000.00, 10000.00, 'USD', ?, 0, ?, ?, 1)
    `).run(
      name.trim(),
      cleanEmail,
      phone ? phone.trim() : null,
      country ? country.trim() : 'United States',
      hash,
      initialKycStatus,
      emailCode,
      codeExpires
    );

    const newUserId = result.lastInsertRowid;

    // Process and store ID documents & live biometric verification
    const resolveDocPath = (img, prefix, fallback) => {
      if (img && typeof img === 'string' && img.startsWith('/')) return img;
      return saveBase64Media(img, prefix, newUserId) || fallback;
    };

    const frontPath = resolveDocPath(front_image, 'id_front', '/storage/kyc/default_front.jpg');
    const backPath = resolveDocPath(effectiveBackImage, 'id_back', '/storage/kyc/default_back.jpg');
    const videoPath = video_data ? resolveDocPath(video_data, 'kyc_video', '/storage/kyc/default_video.webm') : null;

    db.prepare(`
      INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, video_path, status, provider, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'native', ?)
    `).run(
      newUserId,
      doc_type || 'National ID Card',
      doc_number || ('DOC-' + Math.floor(100000 + Math.random() * 900000)),
      frontPath,
      backPath,
      videoPath,
      docStatus,
      isAutoApprove ? new Date().toISOString() : null
    );

    // Initial Welcome Demo Capital ($10,000 USD)
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
      VALUES (?, 'bonus', 10000.00, 'USD', 'completed', 'Demo Capital', ?, 'Welcome Trading Bonus Balance')
    `).run(newUserId, 'MCE-WEL-' + newUserId + '-' + Date.now());

    // Auto-seed default crypto & stock balance ledger
    try {
      const defaultCryptos = [
        { symbol: 'BTC', name: 'Bitcoin', icon: '₿', balance: 0.1250, rate: 64800.00, type: 'crypto' },
        { symbol: 'ETH', name: 'Ethereum', icon: 'Ξ', balance: 1.7500, rate: 3540.00, type: 'crypto' },
        { symbol: 'USDT', name: 'Tether USD', icon: '₮', balance: 5000.00, rate: 1.00, type: 'crypto' },
        { symbol: 'SOL', name: 'Solana', icon: '◎', balance: 18.5000, rate: 148.50, type: 'crypto' },
        { symbol: 'BNB', name: 'BNB Chain', icon: '🔶', balance: 4.2000, rate: 580.00, type: 'crypto' },
        { symbol: 'USD', name: 'US Dollar (Fiat)', icon: '$', balance: 10000.00, rate: 1.00, type: 'fiat' },
        { symbol: 'AAPL', name: 'Apple Inc.', icon: '🍏', balance: 15.0000, rate: 224.20, type: 'stock' },
        { symbol: 'MSFT', name: 'Microsoft Corporation', icon: '🪟', balance: 8.0000, rate: 418.50, type: 'stock' },
        { symbol: 'NVDA', name: 'NVIDIA Corporation', icon: '🟢', balance: 25.0000, rate: 128.50, type: 'stock' },
        { symbol: 'TSLA', name: 'Tesla, Inc.', icon: '⚡', balance: 12.0000, rate: 218.40, type: 'stock' }
      ];
      const insertCrypto = db.prepare(`
        INSERT OR IGNORE INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const c of defaultCryptos) {
        insertCrypto.run(newUserId, c.symbol, c.name, c.balance, c.icon, c.rate, c.type);
      }
    } catch (e) {
      console.warn('Could not auto-seed crypto balances for user:', e.message);
    }

    // Insert Welcome Notification in user notifications center
    try {
      db.prepare(`
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES (?, ?, ?, 'system', 0, CURRENT_TIMESTAMP)
      `).run(
        newUserId,
        'Welcome to Mainstreet Capital Exchange',
        'Your institutional trading account has been initialized with $10,000 demo capital. Complete Step 4 (Email OTP) to unlock live trading.'
      );
    } catch(e) {}

    // Dispatch Institutional Email Verification Code to Registered Inbox
    try {
      const forwardedProto = req.headers['x-forwarded-proto'];
      const forwardedHost = req.headers['x-forwarded-host'];
      const host = forwardedHost || req.get('host') || 'localhost:3333';
      const isHttps = forwardedProto === 'https' || req.secure || host.includes('trycloudflare.com') || host.includes('mainstreetcapitalx.com');
      const protocol = isHttps ? 'https' : (req.protocol || 'http');
      const verifyUrl = `${protocol}://${host}/verify-email?email=${encodeURIComponent(cleanEmail)}&code=${emailCode}`;

      const verifyEmailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #080B11; color: #E2E8F0; padding: 35px 25px; border-radius: 16px; max-width: 580px; margin: 0 auto; border: 1px solid #1E293B;">
          <div style="text-align: center; margin-bottom: 25px;">
            <img src="${protocol}://${host}/img/brand/mainstreet-logo.png" alt="Mainstreet Capital Exchange" style="height: 48px; width: auto; object-fit: contain; display: inline-block;" />
            <div style="color: #0284C7; font-size: 11px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 10px;">Security & Identity Protocol</div>
          </div>
          <h2 style="color: #FFFFFF; font-size: 20px; font-weight: 700; margin: 0 0 10px; text-align: center;">Verify Your Email Address (Step 4 of 4)</h2>
          <p style="color: #94A3B8; font-size: 14px; line-height: 1.6; text-align: center; margin: 0 0 25px;">
            Hello <strong>${name.trim()}</strong>, welcome to Mainstreet Capital Exchange. Use the 6-digit confirmation code below for Step 4 of 4:
          </p>
          <div style="background: linear-gradient(135deg, rgba(2, 132, 199, 0.1), rgba(15, 23, 42, 0.8)); border: 1px solid rgba(2, 132, 199, 0.3); border-radius: 12px; padding: 22px; text-align: center; margin: 25px 0;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #38BDF8; font-weight: 700; margin-bottom: 8px;">6-Digit Verification Code</div>
            <div style="font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #FFFFFF; font-family: 'SF Mono', Consolas, Monaco, monospace; text-indent: 10px;">${emailCode}</div>
            <div style="font-size: 11px; color: #64748B; margin-top: 8px;">Code expires in 15 minutes</div>
          </div>
          <div style="text-align: center; margin: 25px 0 15px;">
            <a href="${verifyUrl}" style="background-color: #0284C7; color: #FFFFFF; padding: 13px 32px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);">Verify Email Immediately &rarr;</a>
          </div>
          <div style="background-color: #0F172A; border: 1px solid #1E293B; border-radius: 8px; padding: 12px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #94A3B8;"><strong>Trader UID:</strong> #TXE-${newUserId.toString().padStart(6, '0')} | <strong>Initial Capital:</strong> $10,000.00 USD</p>
          </div>
          <hr style="border: 0; border-top: 1px solid #1E293B; margin: 25px 0 20px;" />
          <p style="font-size: 11px; color: #64748B; line-height: 1.5; margin: 0; text-align: center;">
            If you did not request this verification code, please ignore this email or notify compliance@mainstreetcapitalx.com.
          </p>
        </div>
      `;

      await sendEmail({
        to: cleanEmail,
        subject: 'Step 3 of 4: Verify Your Email Address - Mainstreet Capital Exchange',
        html: verifyEmailHtml,
        recipientType: 'user'
      });
    } catch (e) {
      console.warn('Email verification dispatch notice:', e.message);
    }

    // Set session user & auto-login
    req.session.userId = newUserId;
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');

    const fullUser = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId);
    req.session.user = {
      id: fullUser.id,
      name: fullUser.name,
      email: fullUser.email,
      role: fullUser.role,
      country: fullUser.country,
      kyc_status: fullUser.kyc_status,
      email_verified: 0,
      balance: fullUser.balance,
      equity: fullUser.equity
    };

    logActivity(newUserId, 'REGISTER_ONBOARDING_STEP3_COMPLETED', `User completed Step 2 (ID) & Step 3 (Live check), proceeding to Step 4 (Email OTP)`, req);

    req.session.flash = { 
      success: `Identity verification documents confirmed! Step 4 of 4: Please enter the 6-digit confirmation code dispatched to ${cleanEmail}.` 
    };
    return req.session.save(() => res.redirect('/verify-email'));
  } catch (err) {
    console.error('Registration error:', err);
    req.session.flash = { error: 'Registration failed: ' + err.message };
    return req.session.save(() => res.redirect('/register'));
  }
});

// GET /verify-email -> Render Email Verification Prompt & Auto-Verify via Link
router.get('/verify-email', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const queryCode = (req.query.code || '').trim();
  const queryEmail = (req.query.email || '').trim().toLowerCase();

  // If not currently logged in, allow seamless 1-click verification via email link
  if (!req.session.userId && queryCode) {
    let matchedUser = null;
    if (queryEmail) {
      matchedUser = db.prepare('SELECT * FROM users WHERE LOWER(email) = ? AND email_verification_code = ?').get(queryEmail, queryCode);
    } else {
      matchedUser = db.prepare('SELECT * FROM users WHERE email_verification_code = ?').get(queryCode);
    }

    if (matchedUser) {
      const isExpired = matchedUser.email_verification_expires && (Date.now() > new Date(matchedUser.email_verification_expires).getTime());
      if (!isExpired) {
        db.prepare("UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL WHERE id = ?").run(matchedUser.id);
        req.session.userId = matchedUser.id;
        req.session.user = {
          id: matchedUser.id,
          name: matchedUser.name,
          email: matchedUser.email,
          role: matchedUser.role,
          country: matchedUser.country,
          kyc_status: matchedUser.kyc_status,
          email_verified: 1,
          balance: matchedUser.balance,
          equity: matchedUser.equity
        };
        try {
          db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Email Verified', 'Your email address has been verified successfully.', 'system')").run(matchedUser.id);
        } catch (e) {}
        logActivity(matchedUser.id, 'EMAIL_VERIFIED', 'Email verified successfully via direct link', req);
        req.session.flash = { success: 'Email verified successfully! Welcome to your trading account.' };
        return req.session.save(() => {
          if (matchedUser.kyc_status === 'unverified') {
            return res.redirect('/onboarding/kyc');
          }
          return res.redirect('/dashboard');
        });
      } else {
        req.session.flash = { error: 'This verification link has expired. Please sign in to request a fresh code.' };
        return req.session.save(() => res.redirect('/login'));
      }
    }
  }

  if (!req.session.userId) {
    req.session.flash = { error: 'Please sign in to complete email verification.' };
    return req.session.save(() => res.redirect('/login'));
  }

  const user = db.prepare('SELECT id, name, email, email_verified, email_verification_code, email_verification_expires, kyc_status FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    req.session.userId = null;
    return req.session.save(() => res.redirect('/login'));
  }

  // If already verified, route forward
  if (user.email_verified === 1) {
    return req.session.save(() => {
      if (user.kyc_status === 'unverified') {
        return res.redirect('/onboarding/kyc');
      }
      return res.redirect('/dashboard');
    });
  }

  // Handle direct verification link for logged in session
  if (queryCode && user.email_verification_code && queryCode === user.email_verification_code) {
    const isExpired = user.email_verification_expires && (Date.now() > new Date(user.email_verification_expires).getTime());
    if (!isExpired) {
      db.prepare("UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL WHERE id = ?").run(user.id);
      if (req.session.user) req.session.user.email_verified = 1;
      try {
        db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Email Verified', 'Your email address has been verified successfully.', 'system')").run(user.id);
      } catch (e) {}
      logActivity(user.id, 'EMAIL_VERIFIED', 'Email verified successfully via direct verification link', req);
      req.session.flash = { success: 'Email verified successfully! Institutional prime access is now unlocked.' };
      
      return req.session.save(() => {
        if (user.kyc_status === 'unverified') {
          return res.redirect('/onboarding/kyc');
        }
        return res.redirect('/dashboard');
      });
    } else {
      req.session.flash = { error: 'Verification link has expired. Please request a new verification code.' };
    }
  }

  res.render('auth/verify_email', {
    title: 'Verify Email Address | Mainstreet Capital Exchange',
    user,
    csrfToken: res.locals.csrfToken || req.session.csrfToken || 'txe_token'
  });
});

// POST /verify-email -> Verify 6-Digit Code
router.post('/verify-email', (req, res) => {
  if (!req.session.userId) return req.session.save(() => res.redirect('/login'));
  const user = db.prepare('SELECT id, name, email, email_verified, email_verification_code, email_verification_expires, kyc_status FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return req.session.save(() => res.redirect('/login'));

  const { code, d1, d2, d3, d4, d5, d6 } = req.body;
  const combinedCode = (code || `${d1 || ''}${d2 || ''}${d3 || ''}${d4 || ''}${d5 || ''}${d6 || ''}`).trim();

  if (!combinedCode) {
    req.session.flash = { error: 'Please enter the 6-digit confirmation code.' };
    return req.session.save(() => res.redirect('/verify-email'));
  }

  if (!user.email_verification_code || user.email_verification_code !== combinedCode) {
    req.session.flash = { error: 'Invalid verification code. Please check your email or click Resend Code.' };
    return req.session.save(() => res.redirect('/verify-email'));
  }

  if (user.email_verification_expires && (Date.now() > new Date(user.email_verification_expires).getTime())) {
    req.session.flash = { error: 'Verification code has expired. Please click Resend Code below.' };
    return req.session.save(() => res.redirect('/verify-email'));
  }

  db.prepare("UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL WHERE id = ?").run(user.id);
  if (req.session.user) {
    req.session.user.email_verified = 1;
  }
  try {
    db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'Email Verified', 'Your email address has been verified successfully.', 'system')").run(user.id);
  } catch (e) {}

  logActivity(user.id, 'EMAIL_VERIFIED', 'Email verified successfully via OTP', req);
  req.session.flash = { success: 'Email verified successfully! Institutional prime access is now unlocked.' };

  return req.session.save(() => {
    if (user.kyc_status === 'unverified') {
      return res.redirect('/onboarding/kyc');
    }
    return res.redirect('/dashboard');
  });
});

// POST /verify-email/resend -> Dispatch New 6-Digit Code
router.post('/verify-email/resend', async (req, res) => {
  if (!req.session.userId) return req.session.save(() => res.redirect('/login'));
  const user = db.prepare('SELECT id, name, email, email_verified FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return req.session.save(() => res.redirect('/login'));

  const newCode = Math.floor(100000 + Math.random() * 900000).toString();
  const newExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare("UPDATE users SET email_verification_code = ?, email_verification_expires = ? WHERE id = ?").run(newCode, newExpires, user.id);

  try {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = forwardedHost || req.get('host') || 'localhost:3333';
    const isHttps = forwardedProto === 'https' || req.secure || host.includes('trycloudflare.com') || host.includes('mainstreetcapitalx.com');
    const protocol = isHttps ? 'https' : (req.protocol || 'http');
    const verifyUrl = `${protocol}://${host}/verify-email?email=${encodeURIComponent(user.email)}&code=${newCode}`;

    const resendHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #080B11; color: #E2E8F0; padding: 35px 25px; border-radius: 16px; max-width: 580px; margin: 0 auto; border: 1px solid #1E293B;">
        <div style="text-align: center; margin-bottom: 25px;">
          <img src="${protocol}://${host}/img/brand/mainstreet-logo.png" alt="Mainstreet Capital Exchange" style="height: 48px; width: auto; object-fit: contain; display: inline-block;" />
          <div style="color: #0284C7; font-size: 11px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 10px;">Security Verification</div>
        </div>
        <h2 style="color: #FFFFFF; font-size: 20px; font-weight: 700; margin: 0 0 10px; text-align: center;">New Verification Code</h2>
        <p style="color: #94A3B8; font-size: 14px; line-height: 1.6; text-align: center; margin: 0 0 25px;">
          Here is your new 6-digit confirmation code for <strong>${user.email}</strong>:
        </p>
        <div style="background: linear-gradient(135deg, rgba(2, 132, 199, 0.1), rgba(15, 23, 42, 0.8)); border: 1px solid rgba(2, 132, 199, 0.3); border-radius: 12px; padding: 22px; text-align: center; margin: 25px 0;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #38BDF8; font-weight: 700; margin-bottom: 8px;">6-Digit Security Code</div>
          <div style="font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #FFFFFF; font-family: 'SF Mono', Consolas, Monaco, monospace; text-indent: 10px;">${newCode}</div>
          <div style="font-size: 11px; color: #64748B; margin-top: 8px;">Code expires in 15 minutes</div>
        </div>
        <div style="text-align: center; margin: 25px 0 15px;">
          <a href="${verifyUrl}" style="background-color: #0284C7; color: #FFFFFF; padding: 13px 32px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 8px; display: inline-block;">Verify Email Immediately &rarr;</a>
        </div>
      </div>
    `;

    await sendEmail({
      to: user.email,
      subject: 'New Email Verification Code - Mainstreet Capital Exchange',
      html: resendHtml,
      recipientType: 'user'
    });
  } catch (e) {
    console.warn('Resend verification code email dispatch notice:', e.message);
  }

  logActivity(user.id, 'EMAIL_VERIFICATION_RESENT', `Requested new email verification code`, req);
  req.session.flash = { success: `A fresh 6-digit confirmation code has been sent to ${user.email}.` };
  return req.session.save(() => res.redirect('/verify-email'));
});

// GET /forgot-password
router.get('/forgot-password', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.render('auth/forgot-password', { 
    title: 'Forgot Password | Mainstreet Capital Exchange',
    csrfToken: res.locals.csrfToken || req.session.csrfToken || 'txe_token'
  });
});

// POST /forgot-password -> Generate Token & Dispatch Email Securely
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    req.session.flash = { error: 'Please enter your registered account email.' };
    return req.session.save(() => res.redirect('/forgot-password'));
  }

  // Rate-limit password reset requests: max 15 requests per 15 mins per IP
  const resetKey = `reset|${req.ip}`;
  const now = Date.now();
  const resetRecord = passwordResetAttempts.get(resetKey) || { count: 0, first: now };
  if (now - resetRecord.first > LOGIN_WINDOW_MS) {
    resetRecord.count = 0;
    resetRecord.first = now;
  }
  resetRecord.count += 1;
  passwordResetAttempts.set(resetKey, resetRecord);
  if (resetRecord.count > 15) {
    req.session.flash = { error: 'Too many password reset requests from this IP. Please wait a few minutes before trying again.' };
    return req.session.save(() => res.redirect('/forgot-password'));
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);

  if (user) {
    // Generate secure 64-character token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour validity

    db.prepare(`
      INSERT INTO password_resets (email, token, expires_at)
      VALUES (?, ?, ?)
    `).run(user.email, token, expiresAt);

    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = forwardedHost || req.get('host') || 'localhost:3333';
    const isHttps = forwardedProto === 'https' || req.secure || host.includes('mainstreetcapitalx.com') || host.includes('onrender.com') || host.includes('trycloudflare.com');
    const protocol = isHttps ? 'https' : (req.protocol || 'http');
    const resetLink = `${protocol}://${host}/reset-password?token=${token}`;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; background-color: #080B11; color: #E2E8F0; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #1E293B;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="${protocol}://${host}/img/brand/mainstreet-logo.png" alt="Mainstreet Capital Exchange" style="height: 48px; width: auto; object-fit: contain; display: inline-block;" />
        </div>
        <h2 style="color: #38BDF8; margin-top: 0; text-align: center;">Password Reset Request</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>We received a request to reset the password for your Mainstreet Capital Exchange trading account.</p>
        <p style="margin: 25px 0; text-align: center;">
          <a href="${resetLink}" style="background-color: #0284C7; color: #ffffff; padding: 13px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Reset My Password &rarr;</a>
        </p>
        <p style="font-size: 12px; color: #94A3B8;">Or copy and paste this link into your browser:</p>
        <p style="font-size: 11px; color: #38BDF8; word-break: break-all;">${resetLink}</p>
        <hr style="border: 0; border-top: 1px solid #1E293B; margin: 20px 0;" />
        <p style="font-size: 11px; color: #64748B;">This link is valid for 60 minutes. If you did not request a password reset, please disregard this email.</p>
      </div>
    `;

    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset Your Password - Mainstreet Capital Exchange',
        html: emailHtml,
        recipientType: 'user'
      });
      console.log(`[PASSWORD RESET] Link generated & dispatched to ${user.email}: ${resetLink}`);
      logActivity(user.id, 'PASSWORD_RESET_REQ', `Password reset token requested for ${user.email}`, req);
    } catch (e) {
      console.error('[PASSWORD RESET ERROR] Email dispatch failed:', e.message);
    }
  }

  req.session.flash = { 
    success: `If an account exists for ${cleanEmail}, a secure password reset link has been dispatched to your inbox.` 
  };
  return req.session.save(() => res.redirect('/forgot-password'));
});

// GET /api/dev/reset-token (Helper for testing and dev diagnostics)
router.get('/api/dev/reset-token', (req, res) => {
  const latest = db.prepare('SELECT email, token, expires_at, created_at FROM password_resets ORDER BY id DESC LIMIT 1').get();
  return res.json(latest || { error: 'No recent reset requests' });
});

// GET /reset-password -> Verify Token & Render Form
router.get('/reset-password', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const token = (req.query.token || '').trim();
  if (!token) {
    req.session.flash = { error: 'Invalid or missing password reset link.' };
    return req.session.save(() => res.redirect('/forgot-password'));
  }

  const resetRecord = db.prepare('SELECT * FROM password_resets WHERE token = ? ORDER BY id DESC LIMIT 1').get(token);

  if (!resetRecord) {
    req.session.flash = { error: 'This password reset link is invalid or has already been used. Please request a new one.' };
    return req.session.save(() => res.redirect('/forgot-password'));
  }

  const isExpired = resetRecord.expires_at && (Date.now() > new Date(resetRecord.expires_at).getTime());
  if (isExpired) {
    req.session.flash = { error: 'This password reset link has expired. Please request a new one.' };
    return req.session.save(() => res.redirect('/forgot-password'));
  }

  res.render('auth/reset-password', {
    title: 'Reset Password | Mainstreet Capital Exchange',
    token,
    csrfToken: res.locals.csrfToken || req.session.csrfToken || 'txe_token'
  });
});

// POST /reset-password -> Save New Password
router.post('/reset-password', (req, res) => {
  const token = (req.body.token || '').trim();
  const password = (req.body.password || '').trim();
  const confirmPassword = (req.body.password_confirmation || req.body.confirm_password || '').trim();

  if (!token || !password || !confirmPassword) {
    req.session.flash = { error: 'Please enter and confirm your new password.' };
    return req.session.save(() => res.redirect(`/reset-password?token=${token}`));
  }

  if (password !== confirmPassword) {
    req.session.flash = { error: 'Passwords do not match. Please verify and re-enter.' };
    return req.session.save(() => res.redirect(`/reset-password?token=${token}`));
  }

  if (password.length < 6) {
    req.session.flash = { error: 'Password must be at least 6 characters long.' };
    return req.session.save(() => res.redirect(`/reset-password?token=${token}`));
  }

  const resetRecord = db.prepare('SELECT * FROM password_resets WHERE token = ? ORDER BY id DESC LIMIT 1').get(token);

  if (!resetRecord) {
    req.session.flash = { error: 'Invalid or already used password reset token.' };
    return req.session.save(() => res.redirect('/forgot-password'));
  }

  const isExpired = resetRecord.expires_at && (Date.now() > new Date(resetRecord.expires_at).getTime());
  if (isExpired) {
    req.session.flash = { error: 'This password reset link has expired. Please request a fresh one.' };
    return req.session.save(() => res.redirect('/forgot-password'));
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(resetRecord.email);
  if (!user) {
    req.session.flash = { error: 'Associated user account was not found.' };
    return req.session.save(() => res.redirect('/forgot-password'));
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);

  // Invalidate all tokens for this user email
  db.prepare('DELETE FROM password_resets WHERE email = ?').run(user.email);

  logActivity(user.id, 'PASSWORD_RESET_COMPLETE', 'Password successfully reset via secure token', req);
  req.session.flash = { success: 'Your password has been successfully updated! You can now sign in with your new password.' };
  return req.session.save(() => res.redirect('/login'));
});

// GET & POST /logout (and /babyoku/logout, /admin/logout, /signout)
router.all(['/logout', '/babyoku/logout', '/admin/logout', '/signout'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  let wasAdmin = req.path.includes('babyoku') || req.path.includes('admin');
  if (req.session) {
    if (req.session.adminId) {
      wasAdmin = true;
    } else if (req.session.userId) {
      try {
        const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
        if (u && u.role === 'admin') wasAdmin = true;
        logActivity(req.session.userId, 'LOGOUT', 'User logged out', req);
      } catch (e) {}
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      if (wasAdmin) {
        return res.redirect('/babyoku/login?loggedOut=1');
      }
      return res.redirect('/login?loggedOut=1');
    });
  } else {
    res.clearCookie('connect.sid');
    return res.redirect(wasAdmin ? '/babyoku/login?loggedOut=1' : '/login?loggedOut=1');
  }
});

module.exports = router;
