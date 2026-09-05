const fs = require('fs');
const path = require('path');

// Helper to save base64 media (image/video) to public/storage/kyc
const saveBase64Media = (base64String, prefix, userId) => {
  if (!base64String || typeof base64String !== 'string' || !base64String.includes('base64,')) {
    return null;
  }
  try {
    const kycDir = path.join(__dirname, '..', '..', 'public', 'storage', 'kyc');
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
    return `/storage/kyc/${filename}`;
  } catch (err) {
    console.error('Failed to save base64 media:', err.message);
    return null;
  }
};

const express = require('express');
const router = express.Router();

// ==============================================================================
// IN-MEMORY BRUTE FORCE RATE LIMITER & RFC 6238 TOTP ENGINE
// ==============================================================================
const failedLoginAttempts = new Map(); // key: ip -> { count, lockUntil }

const checkRateLimit = (ip) => {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return { allowed: true };
  const record = failedLoginAttempts.get(ip);
  if (!record) return { allowed: true };
  if (record.lockUntil && Date.now() < record.lockUntil) {
    const remainingSec = Math.ceil((record.lockUntil - Date.now()) / 1000);
    return { allowed: false, message: `Too many failed login attempts. Please try again in ${remainingSec} seconds.` };
  }
  if (record.lockUntil && Date.now() >= record.lockUntil) {
    failedLoginAttempts.delete(ip);
    return { allowed: true };
  }
  return { allowed: true };
};

const recordFailedAttempt = (ip) => {
  const record = failedLoginAttempts.get(ip) || { count: 0, lockUntil: null };
  record.count += 1;
  if (record.count >= 5) {
    record.lockUntil = Date.now() + (5 * 60 * 1000); // 5-minute lockout
  }
  failedLoginAttempts.set(ip, record);
};

const clearFailedAttempts = (ip) => {
  failedLoginAttempts.delete(ip);
};

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
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const ua = req.headers['user-agent'] || 'Unknown Browser';
    db.prepare(`
      INSERT INTO activity_logs (user_id, action, ip_address, user_agent, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, ip, ua, details);
  } catch (e) {}
};

// Helper to send email via SMTP or fallback
const sendEmail = async (toEmail, subject, htmlBody) => {
  try {
    const smtp = db.prepare('SELECT * FROM smtp_settings ORDER BY id DESC LIMIT 1').get();
    if (smtp && smtp.is_active && smtp.host && smtp.user && smtp.pass) {
      const transporter = nodemailer.createTransport({
        host: smtp.host.trim(),
        port: parseInt(smtp.port) || 587,
        secure: parseInt(smtp.port) === 465,
        auth: {
          user: smtp.user.trim(),
          pass: smtp.pass.trim()
        },
        tls: { rejectUnauthorized: false }
      });

      const info = await transporter.sendMail({
        from: `"${smtp.from_name || 'TradexEdge Broker Support'}" <${smtp.from_email || smtp.user}>`,
        to: toEmail.trim(),
        subject: subject,
        html: htmlBody
      });

      console.log(`Email delivered to ${toEmail} via SMTP. Message ID: ${info.messageId}`);
      db.prepare(`
        INSERT INTO email_logs (recipient, recipient_type, subject, message, status)
        VALUES (?, 'user', ?, ?, 'sent')
      `).run(toEmail, subject, htmlBody);
      return { success: true, info };
    } else {
      console.log(`[LOCAL DEV MODE] Password reset email prepared for ${toEmail}. Set up SMTP in /admin to deliver to real inbox.`);
      db.prepare(`
        INSERT INTO email_logs (recipient, recipient_type, subject, message, status)
        VALUES (?, 'user', ?, ?, 'pending_smtp_config')
      `).run(toEmail, subject, htmlBody);
      return { success: true, localOnly: true };
    }
  } catch (err) {
    console.error('Email dispatch error:', err.message);
    db.prepare(`
      INSERT INTO email_logs (recipient, recipient_type, subject, message, status)
      VALUES (?, 'user', ?, ?, 'failed')
    `).run(toEmail, subject, htmlBody + ' [Error: ' + err.message + ']');
    return { success: false, error: err.message };
  }
};

// GET /login
router.get('/login', (req, res) => {
  if (req.session.userId) {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (user && user.role === 'admin') return res.redirect('/babyoku');
    return res.redirect('/dashboard');
  }
  res.render('auth/login', { title: 'TradexEdge | Login' });
});

// GET /babyoku/login (and alias /admin/login -> /babyoku/login)
router.get(['/babyoku/login', '/admin/login'], (req, res) => {
  if (req.path.startsWith('/admin')) {
    return res.redirect('/babyoku/login');
  }
  if (req.session.userId) {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (user && user.role === 'admin') return res.redirect('/babyoku');
  }
  res.render('auth/admin-login', { 
    title: 'TradexEdge | Executive Console Login',
    loginAction: '/babyoku/login'
  });
});

// POST /login, /babyoku/login & /admin/login (with Brute-Force Rate Limiting & 2FA Enforcement)
router.post(['/login', '/babyoku/login', '/admin/login'], (req, res) => {
  const isAdminPath = req.path.includes('admin') || req.path.includes('babyoku');
  const redirectTarget = isAdminPath ? '/babyoku/login' : '/login';
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const rateStatus = checkRateLimit(clientIp);
  if (!rateStatus.allowed) {
    req.session.flash = { error: rateStatus.message };
    return res.redirect(redirectTarget);
  }

  const { email, password } = req.body;
  if (!email || !password) {
    req.session.flash = { error: 'Please enter both your email and password.' };
    return res.redirect(redirectTarget);
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (!user) {
    recordFailedAttempt(clientIp);
    req.session.flash = { error: 'Wrong credentials' };
    return res.redirect(redirectTarget);
  }

  const storedHash = user.password || user.password_hash;
  let match = false;
  try {
    if (storedHash.startsWith('$2')) {
      match = bcrypt.compareSync(password, storedHash);
    } else {
      match = (password === storedHash);
    }
  } catch (e) {
    match = (password === storedHash);
  }

  if (!match) {
    recordFailedAttempt(clientIp);
    req.session.flash = { error: 'Wrong credentials' };
    return res.redirect(redirectTarget);
  }

  // Clear failed attempts upon successful password match
  clearFailedAttempts(clientIp);

  // 2FA TOTP Authentication Check
  if (user.two_factor_enabled === 1 && user.two_factor_secret) {
    req.session.pending2faUserId = user.id;
    req.session.pending2faIsAdmin = (user.role === 'admin' && isAdminPath);
    return res.redirect('/login/2fa');
  }

  req.session.userId = user.id;
  logActivity(user.id, 'LOGIN', `User logged in successfully via ${req.path}`, req);
  req.session.flash = { success: `Welcome back, ${user.name}!` };

  if (user.role === 'admin') {
    return res.redirect('/babyoku');
  } else {
    return res.redirect('/dashboard');
  }
});

// GET /login/2fa -> Render 2FA verification prompt
router.get('/login/2fa', (req, res) => {
  if (!req.session.pending2faUserId) {
    return res.redirect('/login');
  }
  res.render('auth/login-2fa', { title: 'TradexEdge | Two-Factor Authentication' });
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
    return res.redirect('/login');
  }

  const isValid = verifyTotp(user.two_factor_secret, totp_code);
  if (!isValid) {
    req.session.flash = { error: 'Invalid 2FA code. Please enter the current 6-digit code from your Authenticator app.' };
    return res.redirect('/login/2fa');
  }

  // Authentication fully validated
  const isAdminLogin = req.session.pending2faIsAdmin;
  req.session.userId = user.id;
  req.session.pending2faUserId = null;
  req.session.pending2faIsAdmin = null;

  logActivity(user.id, 'LOGIN_2FA_SUCCESS', `2FA Authenticated successfully from ${req.ip}`, req);

  if (isAdminLogin || user.role === 'admin') {
    return res.redirect('/babyoku');
  }
  res.redirect('/dashboard');
});

// GET /register
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  const captchaQuestion = generateCaptcha(req);
  res.render('auth/register', { 
    title: 'TradexEdge | Register',
    captchaQuestion 
  });
});

// POST /register with Mandatory ID (Front & Back) + Biometric Video Verification
router.post('/register', (req, res) => {
  const { 
    name, email, phone, country, password, confirm_password,
    doc_type, doc_number, front_image, back_image, video_data
  } = req.body;

  if (!name || !email || !password || !confirm_password) {
    req.session.flash = { error: 'Please fill out all required personal credentials.' };
    return res.redirect('/register');
  }

  if (password !== confirm_password) {
    req.session.flash = { error: 'Passwords do not match.' };
    return res.redirect('/register');
  }

  if (password.length < 6) {
    req.session.flash = { error: 'Password must be at least 6 characters long.' };
    return res.redirect('/register');
  }

  if (!front_image || !back_image) {
    req.session.flash = { error: 'Both Front and Back photos of your ID Card are mandatory for registration.' };
    return res.redirect('/register');
  }

  if (!video_data) {
    req.session.flash = { error: 'Biometric liveness video verification recording is mandatory for registration.' };
    return res.redirect('/register');
  }

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (existing) {
    req.session.flash = { error: 'An account with that email already exists.' };
    return res.redirect('/register');
  }

  const hash = bcrypt.hashSync(password, 10);

  try {
    const result = db.prepare(`
      INSERT INTO users (name, email, phone, country, password, role, balance, equity, currency, kyc_status, is_active)
      VALUES (?, ?, ?, ?, ?, 'user', 10000.00, 10000.00, 'USD', 'pending', 1)
    `).run(
      name.trim(),
      email.trim(),
      phone ? phone.trim() : null,
      country ? country.trim() : 'United States',
      hash
    );

    const newUserId = result.lastInsertRowid;

    // Save ID Front, ID Back, and Biometric Video to Storage
    const frontPath = saveBase64Media(front_image, 'id_front', newUserId) || '/storage/kyc/default_front.jpg';
    const backPath = saveBase64Media(back_image, 'id_back', newUserId) || '/storage/kyc/default_back.jpg';
    const videoPath = saveBase64Media(video_data, 'kyc_video', newUserId) || '/storage/kyc/default_video.webm';

    // Insert into kyc_documents table
    db.prepare(`
      INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, video_path, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      newUserId,
      doc_type || 'National ID Card',
      doc_number || ('DOC-' + Math.floor(100000 + Math.random() * 900000)),
      frontPath,
      backPath,
      videoPath
    );

    // Initial Welcome Demo Capital ($10,000 USD)
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
      VALUES (?, 'bonus', 10000.00, 'USD', 'completed', 'Demo Capital', ?, 'Welcome Trading Bonus Balance')
    `).run(newUserId, 'TXE-WEL-' + newUserId + '-' + Date.now());

    // Auto-seed default crypto balance ledger
    try {
      const defaultCryptos = [
        { symbol: 'BTC', name: 'Bitcoin', icon: '₿', balance: 0.1250, rate: 68650.00 },
        { symbol: 'ETH', name: 'Ethereum', icon: 'Ξ', balance: 1.7500, rate: 3645.00 },
        { symbol: 'USDT', name: 'Tether USD', icon: '₮', balance: 5000.00, rate: 1.00 },
        { symbol: 'SOL', name: 'Solana', icon: '◎', balance: 18.5000, rate: 156.20 },
        { symbol: 'BNB', name: 'BNB Chain', icon: '🔶', balance: 4.2000, rate: 612.80 },
        { symbol: 'USD', name: 'US Dollar', icon: '$', balance: 10000.00, rate: 1.00 }
      ];
      const insertCrypto = db.prepare(`
        INSERT OR IGNORE INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      defaultCryptos.forEach(c => insertCrypto.run(newUserId, c.symbol, c.name, c.balance, c.icon, c.rate));
    } catch(e) {}

    req.session.userId = newUserId;

    logActivity(newUserId, 'REGISTER_KYC_SUBMIT', 'Account registered with Front/Back ID and Biometric Video', req);
    req.session.flash = { 
      success: `🎉 Welcome to TradexEdge, ${name.trim()}! Your ID Card (Front & Back) and Biometric Video have been submitted for compliance verification.` 
    };
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Registration failure:', err);
    req.session.flash = { error: 'Registration error: ' + err.message };
    res.redirect('/register');
  }
});


// GET /forgot-password
router.get('/forgot-password', (req, res) => {
  const resetLink = req.session.lastResetLink || null;
  req.session.lastResetLink = null;
  res.render('auth/forgot-password', { 
    title: 'TradexEdge | Forgot Password',
    resetLink
  });
});

// POST /forgot-password -> Generate Token & Dispatch Email
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    req.session.flash = { error: 'Please enter your registered account email.' };
    return res.redirect('/forgot-password');
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
  if (!user) {
    req.session.flash = { error: `No trading account found matching ${email}. Please check the spelling or register a new account.` };
    return res.redirect('/forgot-password');
  }

  // Generate 64-character token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

  db.prepare(`
    INSERT INTO password_resets (email, token, expires_at)
    VALUES (?, ?, ?)
  `).run(user.email, token, expiresAt);

  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3333';
  const resetLink = `${protocol}://${host}/reset-password?token=${token}`;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; background-color: #0D0F14; color: #E2E8F0; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #242938;">
      <h2 style="color: #C9A646; margin-top: 0;">TradexEdge Password Reset Request</h2>
      <p>Hello <strong>${user.name}</strong>,</p>
      <p>We received a request to reset the password for your TradexEdge trading account.</p>
      <p style="margin: 25px 0;">
        <a href="${resetLink}" style="background-color: #C9A646; color: #0D0F14; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset My Password</a>
      </p>
      <p style="font-size: 12px; color: #94A3B8;">Or copy and paste this link into your browser:</p>
      <p style="font-size: 11px; color: #C9A646; word-break: break-all;">${resetLink}</p>
      <hr style="border: 0; border-top: 1px solid #242938; margin: 20px 0;" />
      <p style="font-size: 11px; color: #64748B;">This link is valid for 60 minutes. If you did not request a password reset, please disregard this email.</p>
    </div>
  `;

  await sendEmail(user.email, 'TradexEdge Password Reset Request', emailHtml);
  logActivity(user.id, 'PASSWORD_RESET_REQ', `Password reset token requested for ${user.email}`, req);

  req.session.lastResetLink = resetLink;
  req.session.flash = { 
    success: `Password reset request generated for ${user.email}!` 
  };
  res.redirect('/forgot-password');
});

// GET /reset-password -> Verify Token & Render Form
router.get('/reset-password', (req, res) => {
  const { token } = req.query;
  if (!token) {
    req.session.flash = { error: 'Invalid or missing password reset token.' };
    return res.redirect('/forgot-password');
  }

  const resetRecord = db.prepare(`
    SELECT * FROM password_resets 
    WHERE token = ? AND expires_at > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).get(token);

  if (!resetRecord) {
    req.session.flash = { error: 'This password reset link has expired or is invalid. Please request a new one.' };
    return res.redirect('/forgot-password');
  }

  res.render('auth/reset-password', {
    title: 'TradexEdge | Reset Password',
    token
  });
});

// POST /reset-password -> Save New Password
router.post('/reset-password', (req, res) => {
  const { token, password, password_confirmation } = req.body;

  if (!token || !password || !password_confirmation) {
    req.session.flash = { error: 'Please provide and confirm your new password.' };
    return res.redirect(`/reset-password?token=${token || ''}`);
  }

  if (password !== password_confirmation) {
    req.session.flash = { error: 'Passwords do not match.' };
    return res.redirect(`/reset-password?token=${token}`);
  }

  if (password.length < 6) {
    req.session.flash = { error: 'Password must be at least 6 characters long.' };
    return res.redirect(`/reset-password?token=${token}`);
  }

  const resetRecord = db.prepare(`
    SELECT * FROM password_resets 
    WHERE token = ? AND expires_at > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).get(token);

  if (!resetRecord) {
    req.session.flash = { error: 'Invalid or expired reset token.' };
    return res.redirect('/forgot-password');
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(resetRecord.email);
  if (!user) {
    req.session.flash = { error: 'User account not found.' };
    return res.redirect('/forgot-password');
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);

  // Invalidate used reset tokens
  db.prepare('DELETE FROM password_resets WHERE email = ?').run(user.email);

  logActivity(user.id, 'PASSWORD_RESET_COMPLETE', 'Password successfully reset via token', req);
  req.session.flash = { success: 'Your password has been successfully reset! You can now log in.' };
  res.redirect('/login');
});

// GET & POST /logout
router.all('/logout', (req, res) => {
  let wasAdmin = false;
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
    if (wasAdmin) {
      return res.redirect('/babyoku/login');
    }
    res.redirect('/login');
  });
});

module.exports = router;
