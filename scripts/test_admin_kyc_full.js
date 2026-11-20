process.env.DISABLE_CLOUD_VAULT = '1';
const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const fs = require('fs');
const db = require('../src/db');
const { injectUser } = require('../src/middleware/auth');
const csrfMiddleware = require('../src/middleware/csrf');
const authRoutes = require('../src/routes/auth');
const adminRoutes = require('../src/routes/admin');

const app = express();
app.set('views', path.join(__dirname, '..', 'src', 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: 'test_secret_kyc',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
app.get('/__test_admin_login', (req, res) => {
  req.session.userId = admin.id;
  req.session.csrfToken = 'fixed_kyc_token_777';
  req.session.save(() => res.send('OK'));
});

app.use(csrfMiddleware);
app.use(injectUser);
app.use('/', authRoutes);
app.use('/', adminRoutes);

app.use((err, req, res, next) => {
  console.error('EXPRESS ERROR:', err);
  res.status(500).send('ERR: ' + err.message);
});

function req(port, method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  let u1 = null, k1 = null, u2 = null;
  const origAutoApprove = (db.prepare('SELECT auto_approve_kyc FROM system_settings WHERE id = 1').get() || {}).auto_approve_kyc || 0;

  try {
    // Verify x-data has no duplicate keys
    const adminEjs = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'app', 'admin.ejs'), 'utf8');
    const xDataMatch = adminEjs.match(/x-data="(\{[\s\S]*?\})"\s*\r?\n\s*x-init=/);
    if (!xDataMatch) throw new Error('x-data block not found');
    const keys = {};
    const dupes = [];
    const keyRegex = /^\s{4}([a-zA-Z0-9_]+)\s*[:(]/gm;
    let m;
    while ((m = keyRegex.exec(xDataMatch[1])) !== null) {
      if (keys[m[1]]) dupes.push(m[1]);
      keys[m[1]] = true;
    }
    if (dupes.length > 0) throw new Error('Duplicate keys in x-data: ' + dupes.join(', '));
    console.log('✓ 1. Zero duplicate keys in admin.ejs x-data');

    // Login as admin
    const rLogin = await req(port, 'GET', '/__test_admin_login');
    const cookie = (rLogin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // Create test user 1 (with KYC doc + email_verified=0) and test user 2 (without KYC doc)
    u1 = db.prepare(`INSERT INTO users (name, email, password, role, kyc_status, email_verified, is_active) VALUES ('KYC Doc Tester', ?, 'hash', 'user', 'pending', 0, 1)`).run('kyc1_' + Date.now() + '@test.local').lastInsertRowid;
    k1 = db.prepare(`INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, status, provider) VALUES (?, 'Passport', 'DOC-111', '/storage/kyc/f.jpg', '/storage/kyc/b.jpg', 'pending', 'native')`).run(u1).lastInsertRowid;
    u2 = db.prepare(`INSERT INTO users (name, email, password, role, kyc_status, email_verified, is_active) VALUES ('No Doc Tester', ?, 'hash', 'user', 'pending', 0, 1)`).run('kyc2_' + Date.now() + '@test.local').lastInsertRowid;

    // 2. GET /babyoku renders cleanly with all new KYC UI controls
    const rAdmin = await req(port, 'GET', '/babyoku', { Cookie: cookie });
    if (rAdmin.status !== 200) throw new Error('GET /babyoku failed: ' + rAdmin.status);
    if (!rAdmin.body.includes('overflow-x: auto;')) throw new Error('Missing overflow-x: auto in .cyber-table-container');
    if (!rAdmin.body.includes('window.__kycDocsById')) throw new Error('Missing window.__kycDocsById');
    if (!rAdmin.body.includes('/babyoku/user/kyc-status')) throw new Error('Missing Users tab /babyoku/user/kyc-status button');
    if (!rAdmin.body.includes('No Doc Tester')) throw new Error('Missing pendingUsersWithoutDoc display');
    console.log('✓ 2. GET /babyoku rendered 200 OK with all KYC controls present');

    // 3. POST /babyoku/kyc/review (Approve doc k1)
    const bodyApprove = new URLSearchParams({ _token: 'fixed_kyc_token_777', kyc_id: String(k1), status: 'approved' }).toString();
    const rRev = await req(port, 'POST', '/babyoku/kyc/review', { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bodyApprove) }, bodyApprove);
    if (rRev.status !== 302 || rRev.headers.location !== '/babyoku?tab=kyc') throw new Error('Unexpected review redirect: ' + rRev.status + ' ' + rRev.headers.location);
    const u1After = db.prepare('SELECT kyc_status, email_verified FROM users WHERE id = ?').get(u1);
    const k1After = db.prepare('SELECT status FROM kyc_documents WHERE id = ?').get(k1);
    if (u1After.kyc_status !== 'verified' || u1After.email_verified !== 1 || k1After.status !== 'approved') {
      throw new Error('KYC review approval did not update DB: ' + JSON.stringify({ u1After, k1After }));
    }
    console.log('✓ 3. POST /babyoku/kyc/review approved doc & verified user (kyc_status=verified, email_verified=1) -> /babyoku?tab=kyc');

    // 4. POST /babyoku/kyc/action (Reject doc k1)
    const bodyReject = new URLSearchParams({ _token: 'fixed_kyc_token_777', kyc_id: String(k1), action: 'reject', rejection_reason: 'Blurry ID' }).toString();
    const rAct = await req(port, 'POST', '/babyoku/kyc/action', { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bodyReject) }, bodyReject);
    if (rAct.status !== 302 || rAct.headers.location !== '/babyoku?tab=kyc') throw new Error('Unexpected action redirect: ' + rAct.status + ' ' + rAct.headers.location);
    const u1Rej = db.prepare('SELECT kyc_status FROM users WHERE id = ?').get(u1);
    const k1Rej = db.prepare('SELECT status, rejection_reason FROM kyc_documents WHERE id = ?').get(k1);
    if (u1Rej.kyc_status !== 'rejected' || k1Rej.status !== 'rejected' || k1Rej.rejection_reason !== 'Blurry ID') {
      throw new Error('KYC action rejection did not update DB');
    }
    console.log('✓ 4. POST /babyoku/kyc/action rejected doc & updated user cleanly');

    // 5. POST /babyoku/user/kyc-status (Approve user u2 who has NO kyc_documents row)
    const bodyDirect = new URLSearchParams({ _token: 'fixed_kyc_token_777', user_id: String(u2), kyc_status: 'verified', return_tab: 'users' }).toString();
    const rDir = await req(port, 'POST', '/babyoku/user/kyc-status', { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bodyDirect) }, bodyDirect);
    if (rDir.status !== 302 || rDir.headers.location !== '/babyoku?tab=users') throw new Error('Unexpected direct kyc-status redirect: ' + rDir.status + ' ' + rDir.headers.location);
    const u2After = db.prepare('SELECT kyc_status, email_verified FROM users WHERE id = ?').get(u2);
    if (u2After.kyc_status !== 'verified' || u2After.email_verified !== 1) {
      throw new Error('Direct user KYC approval did not update DB: ' + JSON.stringify(u2After));
    }
    console.log('✓ 5. POST /babyoku/user/kyc-status authorized user without doc row -> /babyoku?tab=users');

    // 6. POST /babyoku/settings/kyc-policy
    const bodyPol = new URLSearchParams({ _token: 'fixed_kyc_token_777', auto_approve_kyc: '1' }).toString();
    const rPol = await req(port, 'POST', '/babyoku/settings/kyc-policy', { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bodyPol) }, bodyPol);
    if (rPol.status !== 302 || rPol.headers.location !== '/babyoku?tab=settings') throw new Error('Unexpected policy redirect');
    const polAfter = db.prepare('SELECT auto_approve_kyc FROM system_settings WHERE id = 1').get();
    if (polAfter.auto_approve_kyc !== 1) throw new Error('auto_approve_kyc not saved');
    console.log('✓ 6. POST /babyoku/settings/kyc-policy saved & redirected to /babyoku?tab=settings');

    console.log('\n🎉 ALL 6 ADMIN KYC AUTHORIZATION TESTS PASSED 100%!');
  } finally {
    db.prepare('UPDATE system_settings SET auto_approve_kyc = ?, didit_auto_approve = ? WHERE id = 1').run(origAutoApprove, origAutoApprove);
    if (k1) db.prepare('DELETE FROM kyc_documents WHERE id = ?').run(k1);
    if (u1) {
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(u1);
      db.prepare('DELETE FROM users WHERE id = ?').run(u1);
    }
    if (u2) {
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(u2);
      db.prepare('DELETE FROM users WHERE id = ?').run(u2);
    }
    db.prepare("DELETE FROM activity_logs WHERE details LIKE '%@test.local%' OR details LIKE '%KYC Document #" + k1 + "%'").run();
    server.close();
    process.exit(0);
  }
})().catch(e => {
  console.error('❌ TEST FAILED:', e);
  process.exit(1);
});
