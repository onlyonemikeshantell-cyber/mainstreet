const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, '..', 'src', 'routes', 'auth.js');
let code = fs.readFileSync(authPath, 'utf8');

// 1. Update POST /register/send-otp to persist to SQLite email_otps table and return fallbackCode if delivery fails
const oldSendOtp = `  pendingRegOtps.set(cleanEmail, otpRecord);
  req.session.regOtp = otpRecord;`;

const newSendOtp = `  pendingRegOtps.set(cleanEmail, otpRecord);
  req.session.regOtp = otpRecord;
  try {
    db.prepare('DELETE FROM email_otps WHERE email = ?').run(cleanEmail);
    db.prepare('INSERT INTO email_otps (email, code, expires_at, verified) VALUES (?, ?, ?, 0)').run(cleanEmail, emailCode, expiresMs);
  } catch (e) {
    console.warn('[EMAIL OTP DB WARNING] Could not persist OTP in sqlite:', e.message);
  }`;

if (code.includes(oldSendOtp)) {
  code = code.replace(oldSendOtp, newSendOtp);
  console.log('1. Updated send-otp persistence');
} else {
  console.log('1. Warning: oldSendOtp pattern not found');
}

// Update res.json in POST /register/send-otp
const oldSendOtpJson = `    res.json({
      success: true,
      deliverySuccess: emailDelivery.success,
      error: emailDelivery.error
    });`;

const newSendOtpJson = `    res.json({
      success: true,
      deliverySuccess: emailDelivery.success,
      fallbackCode: emailDelivery.success ? null : emailCode,
      error: emailDelivery.error
    });`;

if (code.includes(oldSendOtpJson)) {
  code = code.replace(oldSendOtpJson, newSendOtpJson);
  console.log('2. Updated send-otp json response with fallbackCode');
} else {
  console.log('2. Warning: oldSendOtpJson pattern not found');
}

// 2. Update POST /register/verify-otp to verify from SQLite email_otps table
const oldVerifyOtpLogic = `  const sessRecord = (req.session.regOtp && req.session.regOtp.email === cleanEmail) ? req.session.regOtp : null;
  const memRecord = pendingRegOtps.get(cleanEmail) || null;
  const record = sessRecord || memRecord;

  if (!record) {
    return res.status(400).json({ success: false, error: 'No active verification code found. Please click Resend Code.' });
  }

  if (Date.now() > record.expires) {
    return res.status(400).json({ success: false, error: 'Verification code has expired. Please click Resend Code.' });
  }

  if (record.code !== cleanCode && (!memRecord || memRecord.code !== cleanCode)) {
    return res.status(400).json({ success: false, error: 'Invalid verification code. Please check your email and try again.' });
  }

  record.verified = true;
  if (sessRecord) sessRecord.verified = true;
  if (memRecord) memRecord.verified = true;
  pendingRegOtps.set(cleanEmail, record);
  req.session.regOtp = record;`;

const newVerifyOtpLogic = `  const sessRecord = (req.session.regOtp && req.session.regOtp.email === cleanEmail) ? req.session.regOtp : null;
  const memRecord = pendingRegOtps.get(cleanEmail) || null;
  let dbRow = null;
  try {
    dbRow = db.prepare('SELECT id, code, expires_at FROM email_otps WHERE email = ? ORDER BY id DESC LIMIT 1').get(cleanEmail);
  } catch (e) {}

  let matched = false;
  let isExpired = false;

  if (dbRow) {
    if (Date.now() > dbRow.expires_at) {
      isExpired = true;
    } else if (dbRow.code === cleanCode) {
      matched = true;
      try { db.prepare('UPDATE email_otps SET verified = 1 WHERE id = ?').run(dbRow.id); } catch (e) {}
    }
  }

  const record = sessRecord || memRecord;
  if (record) {
    if (Date.now() > record.expires) {
      isExpired = true;
    } else if (record.code === cleanCode) {
      matched = true;
    }
    record.verified = true;
    if (sessRecord) sessRecord.verified = true;
    if (memRecord) memRecord.verified = true;
    pendingRegOtps.set(cleanEmail, record);
    req.session.regOtp = record;
  }

  if (!dbRow && !record) {
    return res.status(400).json({ success: false, error: 'No active verification code found. Please click Resend Code.' });
  }

  if (!matched && isExpired) {
    return res.status(400).json({ success: false, error: 'Verification code has expired. Please click Resend Code.' });
  }

  if (!matched) {
    return res.status(400).json({ success: false, error: 'Invalid verification code. Please check your email and try again.' });
  }`;

if (code.includes(oldVerifyOtpLogic)) {
  code = code.replace(oldVerifyOtpLogic, newVerifyOtpLogic);
  console.log('3. Updated verify-otp logic');
} else {
  console.log('3. Warning: oldVerifyOtpLogic pattern not found');
}

// 3. Update POST /register to check SQLite email_otps table
const oldRegisterCheck = `  // Check if Step 2 Email OTP was verified during the registration wizard
  const cleanSubmittedOtp = String(otp_code || '').replace(/\\D/g, '').trim();
  const sessOtp = (req.session.regOtp && req.session.regOtp.email === cleanEmail) ? req.session.regOtp : null;
  const memOtp = pendingRegOtps.get(cleanEmail) || null;
  const isStep2EmailVerified = Boolean(
    (sessOtp && (sessOtp.verified || (cleanSubmittedOtp && sessOtp.code === cleanSubmittedOtp))) ||
    (memOtp && (memOtp.verified || (cleanSubmittedOtp && memOtp.code === cleanSubmittedOtp)))
  );`;

const newRegisterCheck = `  // Check if Step 2 Email OTP was verified during the registration wizard
  const cleanSubmittedOtp = String(otp_code || '').replace(/\\D/g, '').trim();
  const sessOtp = (req.session.regOtp && req.session.regOtp.email === cleanEmail) ? req.session.regOtp : null;
  const memOtp = pendingRegOtps.get(cleanEmail) || null;
  let dbOtpVerified = false;
  try {
    const dbOtp = db.prepare('SELECT id, verified, code, expires_at FROM email_otps WHERE email = ? ORDER BY id DESC LIMIT 1').get(cleanEmail);
    if (dbOtp && dbOtp.expires_at > Date.now() && (dbOtp.verified === 1 || (cleanSubmittedOtp && dbOtp.code === cleanSubmittedOtp))) {
      dbOtpVerified = true;
    }
  } catch (e) {}

  const isStep2EmailVerified = Boolean(
    dbOtpVerified ||
    (sessOtp && (sessOtp.verified || (cleanSubmittedOtp && sessOtp.code === cleanSubmittedOtp))) ||
    (memOtp && (memOtp.verified || (cleanSubmittedOtp && memOtp.code === cleanSubmittedOtp)))
  );`;

if (code.includes(oldRegisterCheck)) {
  code = code.replace(oldRegisterCheck, newRegisterCheck);
  console.log('4. Updated register check for Step 2 email verification');
} else {
  console.log('4. Warning: oldRegisterCheck pattern not found');
}

// Delete OTP from email_otps after successful registration
const oldClearOtp = `    req.session.regOtp = null;
    pendingRegOtps.delete(cleanEmail);`;

const newClearOtp = `    req.session.regOtp = null;
    pendingRegOtps.delete(cleanEmail);
    try { db.prepare('DELETE FROM email_otps WHERE email = ?').run(cleanEmail); } catch (e) {}`;

if (code.includes(oldClearOtp)) {
  code = code.replace(oldClearOtp, newClearOtp);
  console.log('5. Updated clear OTP cleanup');
} else {
  console.log('5. Warning: oldClearOtp pattern not found');
}

// 4. Update GET /verify-email to automatically dispatch email when landing on the page
const oldVerifyEmailGet = `  // Ensure user always has a valid active 6-digit confirmation code
  if (!user.email_verification_code) {
    const freshCode = Math.floor(100000 + Math.random() * 900000).toString();
    const freshExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET email_verification_code = ?, email_verification_expires = ? WHERE id = ?').run(freshCode, freshExpires, user.id);
    user.email_verification_code = freshCode;
    user.email_verification_expires = freshExpires;
  }`;

const newVerifyEmailGet = `  // Ensure user always has a valid active 6-digit confirmation code
  const isCodeExpired = !user.email_verification_expires || (Date.now() > new Date(user.email_verification_expires).getTime());
  if (!user.email_verification_code || isCodeExpired) {
    const freshCode = Math.floor(100000 + Math.random() * 900000).toString();
    const freshExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET email_verification_code = ?, email_verification_expires = ? WHERE id = ?').run(freshCode, freshExpires, user.id);
    user.email_verification_code = freshCode;
    user.email_verification_expires = freshExpires;
  }

  // Automatically dispatch confirmation email if not yet sent in this session for the current code
  if (user.email_verified === 0 && (!req.session.emailVerificationSentFor || req.session.emailVerificationSentFor !== user.email_verification_code)) {
    try {
      const forwardedProto = req.headers['x-forwarded-proto'];
      const forwardedHost = req.headers['x-forwarded-host'];
      const host = forwardedHost || req.get('host') || 'localhost:3333';
      const isHttps = forwardedProto === 'https' || req.secure || host.includes('trycloudflare.com') || host.includes('mainstreetcapitalx.com');
      const protocol = isHttps ? 'https' : (req.protocol || 'http');
      const verifyUrl = \`\${protocol}://\${host}/verify-email?email=\${encodeURIComponent(user.email)}&code=\${user.email_verification_code}\`;

      const verifyEmailHtml = \`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #080B11; color: #E2E8F0; padding: 35px 25px; border-radius: 16px; max-width: 580px; margin: 0 auto; border: 1px solid #1E293B;">
          <div style="text-align: center; margin-bottom: 25px;">
            <img src="\${protocol}://\${host}/img/brand/mainstreet-logo.png" alt="Mainstreet Capital Exchange" style="height: 48px; width: auto; object-fit: contain; display: inline-block;" />
            <div style="color: #0284C7; font-size: 11px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 10px;">Security & Identity Protocol</div>
          </div>
          <h2 style="color: #FFFFFF; font-size: 20px; font-weight: 700; margin: 0 0 10px; text-align: center;">Verify Your Email Address</h2>
          <p style="color: #94A3B8; font-size: 14px; line-height: 1.6; text-align: center; margin: 0 0 25px;">
            Hello <strong>\${user.name}</strong>, use the 6-digit confirmation code below to verify your account:
          </p>
          <div style="background: linear-gradient(135deg, rgba(2, 132, 199, 0.1), rgba(15, 23, 42, 0.8)); border: 1px solid rgba(2, 132, 199, 0.3); border-radius: 12px; padding: 22px; text-align: center; margin: 25px 0;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #38BDF8; font-weight: 700; margin-bottom: 8px;">6-Digit Verification Code</div>
            <div style="font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #FFFFFF; font-family: 'SF Mono', Consolas, Monaco, monospace; text-indent: 10px;">\${user.email_verification_code}</div>
            <div style="font-size: 11px; color: #64748B; margin-top: 8px;">Code expires in 60 minutes</div>
          </div>
          <div style="text-align: center; margin: 25px 0 15px;">
            <a href="\${verifyUrl}" style="background-color: #0284C7; color: #FFFFFF; padding: 13px 32px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);">Verify Email Immediately &rarr;</a>
          </div>
        </div>
      \`;

      const dispatchResult = await sendEmail({
        to: user.email,
        subject: 'Verify Your Email Address - Mainstreet Capital Exchange',
        html: verifyEmailHtml,
        recipientType: 'user'
      });
      req.session.emailVerificationSentFor = user.email_verification_code;
      req.session.otpDelivery = dispatchResult;
      console.log(\`[VERIFY-EMAIL DISPATCH] Sent verification code \${user.email_verification_code} to \${user.email} (success=\${dispatchResult?.success})\`);
    } catch (e) {
      console.warn('[VERIFY-EMAIL DISPATCH NOTICE] Could not send initial email:', e.message);
      req.session.otpDelivery = { success: false, error: e.message };
    }
  }`;

if (code.includes(oldVerifyEmailGet)) {
  code = code.replace(oldVerifyEmailGet, newVerifyEmailGet);
  console.log('6. Updated GET /verify-email dispatch');
} else {
  console.log('6. Warning: oldVerifyEmailGet pattern not found');
}

// 5. Update showCodeFallback on GET /verify-email so users see code if delivery failed or pending
const oldShowFallback = `    // Only reveal the code on-screen when email delivery demonstrably failed
    showCodeFallback: !!(req.session.otpDelivery && req.session.otpDelivery.success === false),`;

const newShowFallback = `    // Reveal the code on-screen if email delivery had an issue or was not confirmed
    showCodeFallback: !(req.session.otpDelivery && req.session.otpDelivery.success === true),`;

if (code.includes(oldShowFallback)) {
  code = code.replace(oldShowFallback, newShowFallback);
  console.log('7. Updated showCodeFallback condition');
} else {
  console.log('7. Warning: oldShowFallback pattern not found');
}

fs.writeFileSync(authPath, code, 'utf8');
console.log('Finished updating auth.js');
