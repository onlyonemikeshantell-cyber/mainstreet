const db = require('../src/db');
const bcrypt = require('bcryptjs');
const admins = db.prepare("SELECT id, email, password FROM users WHERE role = 'admin'").all();
for (const a of admins) {
  const h = a.password || '';
  const isBcrypt = h.startsWith('$2');
  let matchesDefault = false;
  try { matchesDefault = isBcrypt ? bcrypt.compareSync('AdminSecure2026!', h) : h === 'AdminSecure2026!'; } catch (e) {}
  console.log(a.id, a.email, 'bcrypt:', isBcrypt, 'matches AdminSecure2026!:', matchesDefault);
}
const plain = db.prepare("SELECT COUNT(*) c FROM users WHERE COALESCE(password, '') NOT LIKE '$2%'").get();
console.log('Users with non-bcrypt passwords:', plain.c);
