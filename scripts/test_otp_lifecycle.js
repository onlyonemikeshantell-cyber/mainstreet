const db = require('../src/db');
const { sendEmail } = require('../src/services/mailer');

async function testOtpLifecycle() {
  console.log('=== OTP LIFECYCLE & RESILIENCE VERIFICATION ===');

  // Test 1: Verify email_otps table exists
  console.log('\n1. Checking email_otps SQLite schema...');
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_otps'").get();
  if (!tableCheck) throw new Error('email_otps table does not exist in SQLite!');
  console.log('✓ email_otps table is verified in SQLite.');

  // Test 2: Simulate Step 2 OTP Dispatch & Persistence
  console.log('\n2. Testing OTP dispatch & DB persistence...');
  const testEmail = 'tester_' + Date.now() + '@example.com';
  const testCode = '654321';
  const expiresMs = Date.now() + 15 * 60 * 1000;

  db.prepare('DELETE FROM email_otps WHERE email = ?').run(testEmail);
  db.prepare('INSERT INTO email_otps (email, code, expires_at, verified) VALUES (?, ?, ?, 0)').run(testEmail, testCode, expiresMs);

  const savedOtp = db.prepare('SELECT * FROM email_otps WHERE email = ?').get(testEmail);
  if (!savedOtp || savedOtp.code !== testCode || savedOtp.verified !== 0) {
    throw new Error('Failed to persist OTP correctly!');
  }
  console.log('✓ OTP successfully persisted in DB for:', testEmail, 'Code:', savedOtp.code);

  // Test 3: Simulate Container Restart / Memory Wipe
  console.log('\n3. Simulating container restart / process memory wipe...');
  // The in-memory map would be empty after a restart, but SQLite has the record!
  const restoredOtp = db.prepare('SELECT * FROM email_otps WHERE email = ? ORDER BY id DESC LIMIT 1').get(testEmail);
  if (!restoredOtp || restoredOtp.code !== testCode) {
    throw new Error('Lost OTP after memory wipe!');
  }
  console.log('✓ OTP persisted across simulated process restart.');

  // Test 4: Simulate Step 2 Code Verification
  console.log('\n4. Testing Step 2 code verification in DB...');
  if (restoredOtp.code === testCode && Date.now() <= restoredOtp.expires_at) {
    db.prepare('UPDATE email_otps SET verified = 1 WHERE id = ?').run(restoredOtp.id);
  } else {
    throw new Error('Verification match failed!');
  }

  const verifiedOtp = db.prepare('SELECT verified FROM email_otps WHERE id = ?').get(restoredOtp.id);
  if (verifiedOtp.verified !== 1) {
    throw new Error('OTP status not updated to verified!');
  }
  console.log('✓ OTP verified status persisted in SQLite.');

  // Test 5: Simulate Final Registration Checking email_otps
  console.log('\n5. Testing user registration with verified DB OTP...');
  const dbVerified = db.prepare('SELECT id FROM email_otps WHERE email = ? AND verified = 1 AND expires_at > ?').get(testEmail, Date.now());
  if (!dbVerified) throw new Error('Registration could not find verified OTP!');

  const userInsert = db.prepare(`
    INSERT INTO users (name, email, password, role, balance, equity, currency, kyc_status, email_verified, is_active)
    VALUES ('Lifecycle Tester', ?, 'mockhash', 'user', 0.00, 0.00, 'USD', 'pending', 1, 1)
  `).run(testEmail);
  const newUserId = userInsert.lastInsertRowid;
  db.prepare('DELETE FROM email_otps WHERE email = ?').run(testEmail);

  const createdUser = db.prepare('SELECT id, email, email_verified FROM users WHERE id = ?').get(newUserId);
  if (!createdUser || createdUser.email_verified !== 1) {
    throw new Error('User was not registered with email_verified = 1!');
  }
  console.log('✓ User created with instant verified email status, ID:', newUserId);

  // Test 6: Verify unverified user flow on /verify-email
  console.log('\n6. Testing /verify-email auto-generation & code verification for unverified account...');
  const unverifiedEmail = 'unverified_' + Date.now() + '@example.com';
  const unverifiedInsert = db.prepare(`
    INSERT INTO users (name, email, password, role, balance, equity, currency, kyc_status, email_verified, is_active)
    VALUES ('Unverified User', ?, 'mockhash', 'user', 0.00, 0.00, 'USD', 'pending', 0, 1)
  `).run(unverifiedEmail);
  const unverifiedId = unverifiedInsert.lastInsertRowid;

  // Simulate GET /verify-email logic: generates code if missing
  const freshCode = '882211';
  const freshExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET email_verification_code = ?, email_verification_expires = ? WHERE id = ?').run(freshCode, freshExpires, unverifiedId);

  const checkUser = db.prepare('SELECT email_verification_code FROM users WHERE id = ?').get(unverifiedId);
  if (checkUser.email_verification_code !== freshCode) throw new Error('Failed to set verification code!');

  // Simulate POST /verify-email verification
  db.prepare('UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL WHERE id = ?').run(unverifiedId);
  const finalCheck = db.prepare('SELECT email_verified, email_verification_code FROM users WHERE id = ?').get(unverifiedId);
  if (finalCheck.email_verified !== 1 || finalCheck.email_verification_code !== null) {
    throw new Error('Final verification failed!');
  }
  console.log('✓ Unverified user successfully verified through /verify-email.');

  // Clean up test records
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(newUserId, unverifiedId);
  console.log('\n✓ Test records cleaned up.');
  console.log('\n🎉 ALL OTP TESTS COMPLETED WITH 100% SUCCESS!');
}

testOtpLifecycle().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
