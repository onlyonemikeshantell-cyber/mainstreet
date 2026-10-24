require('dotenv').config();
const db = require('../src/db');
const { sendEmail } = require('../src/services/mailer');

async function testOtpFlow() {
  console.log('--- 1. Testing SMTP Connectivity via mailer.js with loaded .env ---');
  const testRecipient = 'support@mainstreetcapitalx.com';
  const mailResult = await sendEmail({
    to: testRecipient,
    subject: 'Automated Diagnostic - OTP Pipeline Active',
    html: '<p>Testing active SMTP configuration</p>'
  });

  console.log('Mail dispatch result:', mailResult.success ? 'SUCCESS (id=' + mailResult.id + ')' : 'FAILED (' + mailResult.error + ')');
  if (!mailResult.success) {
    throw new Error('SMTP Dispatch failed: ' + mailResult.error);
  }

  console.log('\n--- 2. Simulating User OTP Generation & Verification Logic ---');
  const testEmail = 'otp_test_' + Date.now() + '@example.com';
  const testCode = '482910';
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Create mock pending user
  const userInsert = db.prepare(`
    INSERT INTO users (name, email, password, role, balance, equity, currency, kyc_status, email_verified, email_verification_code, email_verification_expires, is_active)
    VALUES ('OTP Tester', ?, 'mockhash', 'user', 10000.00, 10000.00, 'USD', 'pending', 0, ?, ?, 1)
  `).run(testEmail, testCode, expires);

  const userId = userInsert.lastInsertRowid;
  console.log('Created test user ID:', userId, 'with code:', testCode);

  // Test code verification
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (user.email_verification_code !== testCode) {
    throw new Error('Code mismatch!');
  }

  // Simulate verify route submission with individual digits
  const d1 = '4', d2 = '8', d3 = '2', d4 = '9', d5 = '1', d6 = '0';
  const rawDigits = `${d1}${d2}${d3}${d4}${d5}${d6}`;
  const combinedCode = rawDigits.replace(/\D/g, '').trim();

  if (combinedCode === user.email_verification_code) {
    db.prepare('UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL WHERE id = ?').run(userId);
    console.log('Successfully verified OTP for user', userId);
  } else {
    throw new Error('Failed to verify matching code');
  }

  const updatedUser = db.prepare('SELECT email_verified, email_verification_code, kyc_status FROM users WHERE id = ?').get(userId);
  console.log('Updated user state:', updatedUser);

  if (updatedUser.email_verified !== 1 || updatedUser.email_verification_code !== null) {
    throw new Error('User email_verified is not 1!');
  }

  // Cleanup test user
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  console.log('Cleaned up test user.\n');
  console.log('✅ ALL OTP TESTS PASSED SUCCESSFULLY!');
}

testOtpFlow().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
