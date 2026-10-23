const db = require('../src/db');
const ejs = require('ejs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing Email Verification Onboarding System ---');

// Test 1: Verify database users table schema has email_verified columns
const userCols = db.prepare("PRAGMA table_info(users)").all();
assert(userCols.some(c => c.name === 'email_verified'), 'users table must have email_verified column');
assert(userCols.some(c => c.name === 'email_verification_code'), 'users table must have email_verification_code column');
assert(userCols.some(c => c.name === 'email_verification_expires'), 'users table must have email_verification_expires column');
console.log('✓ users email verification columns validated');

// Test 2: Test render verify_email.ejs
const dummyLocals = {
  title: 'Verify Email Address',
  csrfToken: 'test_token',
  currentPath: '/verify-email',
  flash: {},
  user: { id: 1234, name: 'Test User', email: 'alex@example.com', email_verified: 0 },
  isImpersonating: false,
  visitorGeo: { country: 'United States', flag: '🇺🇸', dial: '+1' },
  safeJson: (o) => JSON.stringify(o)
};

ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'auth', 'verify_email.ejs'), dummyLocals, (err, str) => {
  if (err) {
    console.error('❌ EJS Render Error in verify_email.ejs:', err);
    process.exit(1);
  }
  console.log('✓ verify_email.ejs rendered successfully! Output length:', str.length);

  // Test 3: Simulation of user verification workflow in DB
  const testEmail = 'verify_test_' + Date.now() + '@example.com';
  const testCode = '748291';
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const insert = db.prepare(`
    INSERT INTO users (name, email, password, role, email_verified, email_verification_code, email_verification_expires, is_active)
    VALUES ('Verify Test', ?, 'testhash', 'user', 0, ?, ?, 1)
  `).run(testEmail, testCode, expires);

  const testUserId = insert.lastInsertRowid;
  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(testUserId);
  assert.strictEqual(created.email_verified, 0, 'New user must start unverified');
  assert.strictEqual(created.email_verification_code, testCode, 'Verification code must match');

  // Verify user
  db.prepare('UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL WHERE id = ?').run(testUserId);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(testUserId);
  assert.strictEqual(updated.email_verified, 1, 'User must be marked verified');
  assert.strictEqual(updated.email_verification_code, null, 'Code must be cleared after verification');

  // Cleanup test user
  db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
  console.log('✓ Verification database transaction & clearance lifecycle passed');

  console.log('--- ALL EMAIL VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
});
