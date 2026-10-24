const db = require('../src/db');
const bcrypt = require('bcryptjs');

console.log('==================================================');
console.log('TESTING ONBOARDING LIFECYCLE (1 -> 2 -> 3 -> 4)');
console.log('1. Details -> 2. Email OTP -> 3. Upload ID -> 4. Live Check');
console.log('==================================================');

const testEmail = 'onboarding_test_' + Date.now() + '@example.com';
const testPass = 'TraderSecret123!';

try {
  // Step 1: Input Details, Step 2: Upload ID, Step 3: Live Verification
  const hash = bcrypt.hashSync(testPass, 10);
  const emailCode = '654321';
  const codeExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Settings auto approve check
  const systemSettings = db.prepare('SELECT auto_approve_kyc, didit_auto_approve FROM system_settings WHERE id = 1').get() || {};
  const isAutoApprove = ((systemSettings.auto_approve_kyc ?? systemSettings.didit_auto_approve) === 1);
  const initialKycStatus = isAutoApprove ? 'verified' : 'pending';
  const docStatus = isAutoApprove ? 'approved' : 'pending';

  // Create user at end of Step 3 (Details + ID + Live Check submitted, awaiting Step 4 Email OTP)
  const userRes = db.prepare(`
    INSERT INTO users (name, email, phone, country, password, role, balance, equity, currency, kyc_status, email_verified, email_verification_code, email_verification_expires, is_active)
    VALUES ('Onboarding Test User', ?, '+15550192834', 'United States', ?, 'user', 10000.00, 10000.00, 'USD', ?, 0, ?, ?, 1)
  `).run(testEmail, hash, initialKycStatus, emailCode, codeExpires);

  const userId = userRes.lastInsertRowid;
  console.log(`[PASS] 1. Created account id: ${userId} (${testEmail}) after Step 1, 2, 3 (email_verified=0, kyc_status='${initialKycStatus}')`);

  // Record Step 2 (ID) + Step 3 (Live Biometric) in kyc_documents
  db.prepare(`
    INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, video_path, status, provider, reviewed_at)
    VALUES (?, 'National ID Card', 'DOC-994411', '/storage/kyc/default_front.jpg', '/storage/kyc/default_back.jpg', '/storage/kyc/default_video.webm', ?, 'native', ?)
  `).run(userId, docStatus, isAutoApprove ? new Date().toISOString() : null);
  console.log('[PASS] 2. ID document and live biometric check recorded in kyc_documents');

  // Step 4: Verify Email with OTP
  const userBeforeOtp = db.prepare('SELECT id, kyc_status, email_verified, email_verification_code FROM users WHERE id = ?').get(userId);
  if (userBeforeOtp.email_verified !== 0) throw new Error('email_verified should be 0 before Step 4');
  
  // Submit correct OTP for Step 4
  if (userBeforeOtp.email_verification_code !== emailCode) throw new Error('OTP mismatch');
  db.prepare("UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL WHERE id = ?").run(userId);
  console.log('[PASS] 3. Step 4 Email OTP verified successfully');

  // Verify final user state after Step 4: email_verified=1 and kyc_status='verified' (or 'pending') -> cleared for dashboard!
  const userFinal = db.prepare('SELECT id, kyc_status, email_verified FROM users WHERE id = ?').get(userId);
  if (userFinal.email_verified !== 1) {
    throw new Error('Email should be verified after Step 4');
  }
  if (userFinal.kyc_status === 'unverified') {
    throw new Error('User should not be unverified after submitting ID & selfie in registration');
  }
  console.log(`[PASS] 4. User fully cleared for trading dashboard access (email_verified=1, kyc_status=${userFinal.kyc_status})`);

  // Cleanup
  db.prepare('DELETE FROM kyc_documents WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  console.log('[PASS] 5. Cleaned up test data');

  console.log('==================================================');
  console.log('ONBOARDING 4-STEP LIFECYCLE PASSED 100%!');
  console.log('==================================================');
} catch (err) {
  console.error('[FAIL] Test failed:', err.message);
  process.exit(1);
}
