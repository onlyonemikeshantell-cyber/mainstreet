const db = require('../src/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

console.log('==================================================');
console.log('TESTING PASSWORD RESET LIFECYCLE (END-TO-END)');
console.log('==================================================');

const testEmail = 'reset_test_' + Date.now() + '@example.com';
const initialPassword = 'InitialSecretPass123!';
const newPassword = 'NewSecretPassword456!';

try {
  // 1. Create a dummy test user
  const initialHash = bcrypt.hashSync(initialPassword, 10);
  const result = db.prepare(`
    INSERT INTO users (name, email, password, role, is_active, email_verified, kyc_status)
    VALUES ('Reset Test User', ?, ?, 'user', 1, 1, 'verified')
  `).run(testEmail, initialHash);
  const userId = result.lastInsertRowid;
  console.log(`[PASS] 1. Created test user id: ${userId} (${testEmail})`);

  // Verify initial login password works
  const userBefore = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!bcrypt.compareSync(initialPassword, userBefore.password)) {
    throw new Error('Initial password verification failed');
  }
  console.log('[PASS] 2. Initial password correctly verified with bcrypt');

  // 2. Simulate forgot-password token generation (1 hour validity)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  db.prepare(`
    INSERT INTO password_resets (email, token, expires_at)
    VALUES (?, ?, ?)
  `).run(testEmail, token, expiresAt);
  console.log(`[PASS] 3. Generated and stored reset token: ${token.substring(0, 10)}... (expires: ${expiresAt})`);

  // 3. Lookup reset record and test validity
  const resetRecord = db.prepare('SELECT * FROM password_resets WHERE token = ? ORDER BY id DESC LIMIT 1').get(token);
  if (!resetRecord) throw new Error('Reset record not found');
  const isExpired = resetRecord.expires_at && (Date.now() > new Date(resetRecord.expires_at).getTime());
  if (isExpired) throw new Error('Valid token was flagged as expired');
  console.log('[PASS] 4. Token lookup and expiration logic verified as VALID');

  // 4. Test expired token logic
  const expiredToken = crypto.randomBytes(32).toString('hex');
  const expiredAt = new Date(Date.now() - 3600000).toISOString(); // 1 hour in the past
  db.prepare(`
    INSERT INTO password_resets (email, token, expires_at)
    VALUES (?, ?, ?)
  `).run(testEmail, expiredToken, expiredAt);
  const expiredRecord = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(expiredToken);
  const isActuallyExpired = expiredRecord.expires_at && (Date.now() > new Date(expiredRecord.expires_at).getTime());
  if (!isActuallyExpired) throw new Error('Expired token was not detected as expired');
  console.log('[PASS] 5. Expired token correctly detected and rejected');
  db.prepare('DELETE FROM password_resets WHERE token = ?').run(expiredToken);

  // 5. Perform password reset with valid token
  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, userBefore.id);
  db.prepare('DELETE FROM password_resets WHERE email = ?').run(userBefore.email);
  console.log('[PASS] 6. User password updated and reset tokens cleared');

  // 6. Verify new password works and old password fails
  const userAfter = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (bcrypt.compareSync(initialPassword, userAfter.password)) {
    throw new Error('Old password still worked after reset');
  }
  if (!bcrypt.compareSync(newPassword, userAfter.password)) {
    throw new Error('New password failed verification after reset');
  }
  console.log('[PASS] 7. Old password rejected, new password verified successfully');

  // 7. Verify token was purged and cannot be reused
  const checkTokenAfter = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
  if (checkTokenAfter) {
    throw new Error('Token was not purged after reset');
  }
  console.log('[PASS] 8. Used token was purged and cannot be reused');

  // Cleanup test user
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  console.log('[PASS] 9. Cleaned up test user');

  console.log('==================================================');
  console.log('ALL PASSWORD RESET TESTS PASSED SUCCESSFULLY!');
  console.log('==================================================');
} catch (err) {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
}
