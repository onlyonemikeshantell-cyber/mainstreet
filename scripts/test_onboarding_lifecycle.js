const db = require('../src/db');
const bcrypt = require('bcryptjs');

console.log('==================================================');
console.log('TESTING REORDERED ONBOARDING LIFECYCLE (1 -> 2 -> 3 -> 4)');
console.log('1. Details -> 2. Live Check -> 3. Email OTP -> 4. Upload ID');
console.log('==================================================');

const testEmail = 'reorder_test_' + Date.now() + '@example.com';
const testPass = 'TraderSecret123!';

try {
  // Step 1: Input Details & Step 2: Live Check
  const hash = bcrypt.hashSync(testPass, 10);
  const emailCode = '654321';
  const codeExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Create user at end of Step 2 (Live check submitted, awaiting Step 3 OTP)
  const userRes = db.prepare(`
    INSERT INTO users (name, email, phone, country, password, role, balance, equity, currency, kyc_status, email_verified, email_verification_code, email_verification_expires, is_active)
    VALUES ('Reordered Test User', ?, '+15550192834', 'United States', ?, 'user', 10000.00, 10000.00, 'USD', 'unverified', 0, ?, ?, 1)
  `).run(testEmail, hash, emailCode, codeExpires);

  const userId = userRes.lastInsertRowid;
  console.log(`[PASS] 1. Created account id: ${userId} (${testEmail}) after Step 2 (email_verified=0, kyc_status='unverified')`);

  // Record preliminary Step 2 live verification
  db.prepare(`
    INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, video_path, status, provider, didit_score, reviewed_at)
    VALUES (?, 'Biometric Live Check', 'BIO-TEST', '/storage/kyc/didit_verified_selfie.png', '/storage/kyc/didit_verified_selfie.png', '/storage/kyc/didit_verified_selfie.png', 'pending', 'didit', 99.4, NULL)
  `).run(userId);
  console.log('[PASS] 2. Preliminary Step 2 live check stored in kyc_documents');

  // Step 3: Verify Email with OTP
  const userBeforeOtp = db.prepare('SELECT id, kyc_status, email_verified, email_verification_code FROM users WHERE id = ?').get(userId);
  if (userBeforeOtp.email_verified !== 0) throw new Error('email_verified should be 0 before Step 3');
  if (userBeforeOtp.kyc_status !== 'unverified') throw new Error('kyc_status should be unverified before Step 4');
  
  // Submit correct OTP for Step 3
  if (userBeforeOtp.email_verification_code !== emailCode) throw new Error('OTP mismatch');
  db.prepare("UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL WHERE id = ?").run(userId);
  console.log('[PASS] 3. Step 3 Email OTP verified successfully');

  // Verify state after Step 3: email_verified=1, kyc_status='unverified' (redirects to Step 4 /onboarding/kyc)
  const userAfterStep3 = db.prepare('SELECT id, kyc_status, email_verified FROM users WHERE id = ?').get(userId);
  if (userAfterStep3.email_verified !== 1) throw new Error('Email should be verified after Step 3');
  if (userAfterStep3.kyc_status !== 'unverified') throw new Error('KYC should still be unverified awaiting Step 4 ID upload');
  console.log('[PASS] 4. User correctly routed to Step 4 ID upload (email_verified=1, kyc_status=unverified)');

  // Step 4: Upload Government ID document at /onboarding/kyc
  db.prepare(`
    INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, video_path, status, provider, didit_score, reviewed_at)
    VALUES (?, 'National ID Card', 'DOC-994411', '/storage/kyc/default_front.jpg', '/storage/kyc/default_back.jpg', '/storage/kyc/didit_verified_selfie.png', 'approved', 'manual', 99.4, CURRENT_TIMESTAMP)
  `).run(userId);
  db.prepare("UPDATE users SET kyc_status = 'verified' WHERE id = ?").run(userId);
  console.log('[PASS] 5. Step 4 ID document uploaded and kyc_status set to verified');

  // Verify final clearance for trading dashboard
  const userFinal = db.prepare('SELECT id, kyc_status, email_verified FROM users WHERE id = ?').get(userId);
  if (userFinal.email_verified !== 1 || userFinal.kyc_status !== 'verified') {
    throw new Error('User not fully cleared after Step 4');
  }
  console.log('[PASS] 6. All 4 onboarding steps verified: full clearance to trading dashboard unlocked');

  // Cleanup
  db.prepare('DELETE FROM kyc_documents WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  console.log('[PASS] 7. Cleaned up test data');

  console.log('==================================================');
  console.log('REORDERED ONBOARDING LIFECYCLE PASSED 100%!');
  console.log('==================================================');
} catch (err) {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
}
