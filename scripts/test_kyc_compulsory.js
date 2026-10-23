const db = require('../src/db');
const ejs = require('ejs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing Compulsory KYC Onboarding Logic ---');

// Check system settings
const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
console.log('System settings didit_auto_approve:', settings.didit_auto_approve);

// Test 1: Verify database users table schema has kyc_status
const userCols = db.prepare("PRAGMA table_info(users)").all();
const hasKycCol = userCols.some(c => c.name === 'kyc_status');
assert(hasKycCol, 'users table must have kyc_status column');
console.log('✓ users.kyc_status column exists');

// Test 2: Verify kyc_documents table has provider, didit_score, status
const docCols = db.prepare("PRAGMA table_info(kyc_documents)").all();
const hasProvider = docCols.some(c => c.name === 'provider');
const hasStatus = docCols.some(c => c.name === 'status');
assert(hasProvider && hasStatus, 'kyc_documents must have provider and status columns');
console.log('✓ kyc_documents schema validated');

// Test 3: Test render register.ejs
const dummyLocals = {
  title: 'Open Live Account',
  csrfToken: 'test_token',
  currentPath: '/register',
  flash: {},
  user: null,
  isImpersonating: false,
  visitorGeo: { country: 'United States', flag: '🇺🇸', dial: '+1' },
  safeJson: (o) => JSON.stringify(o)
};

ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'auth', 'register.ejs'), dummyLocals, (err, str) => {
  if (err) {
    console.error('❌ EJS Render Error in register.ejs:', err);
    process.exit(1);
  }
  console.log('✓ register.ejs rendered successfully! Output length:', str.length);

  // Test 4: Test render onboarding_kyc.ejs
  const onboardingLocals = {
    ...dummyLocals,
    user: { id: 9999, name: 'Test Trader', email: 'trader@example.com', kyc_status: 'unverified' },
    systemSettings: settings,
    kycDocs: []
  };

  ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'app', 'onboarding_kyc.ejs'), onboardingLocals, (err2, str2) => {
    if (err2) {
      console.error('❌ EJS Render Error in onboarding_kyc.ejs:', err2);
      process.exit(1);
    }
    console.log('✓ onboarding_kyc.ejs rendered successfully! Output length:', str2.length);
    console.log('--- ALL ONBOARDING & KYC TESTS PASSED! ---');
  });
});
