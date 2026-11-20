const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/routes/admin.js');
let c = fs.readFileSync(filePath, 'utf8');

const target = `router.post(['/babyoku/copy-trading/master/delete', '/admin/copy-trading/master/delete'], (req, res) => {
  const { master_id } = req.body;
  db.prepare('DELETE FROM master_trades WHERE master_id = ?').run(master_id);
  db.prepare('DELETE FROM master_traders WHERE id = ?').run(master_id);
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (e) {}
  recordLocalMutation(db);
  scheduleCloudSync(db, 100);
  req.session.flash = { success: \`Master Trader #\${master_id} and associated strategy trades removed.\` };
  res.redirect('/babyoku');
});`;

const replacement = `router.post(['/babyoku/copy-trading/master/delete', '/admin/copy-trading/master/delete'], (req, res) => {
  const { master_id } = req.body;
  db.prepare('DELETE FROM master_trades WHERE master_id = ?').run(master_id);
  db.prepare('DELETE FROM master_traders WHERE id = ?').run(master_id);
  db.prepare('DELETE FROM copy_trading_comments WHERE master_id = ?').run(master_id);
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (e) {}
  recordLocalMutation(db);
  scheduleCloudSync(db, 100);
  req.session.flash = { success: \`Master Trader #\${master_id} and associated strategy trades removed.\` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/copy-trading/comment/delete', '/admin/copy-trading/comment/delete'], (req, res) => {
  const { id } = req.body;
  if (id) {
    db.prepare('DELETE FROM copy_trading_comments WHERE id = ?').run(id);
    try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (e) {}
    recordLocalMutation(db);
    scheduleCloudSync(db, 100);
    req.session.flash = { success: 'Copy trading comment deleted.' };
  }
  res.redirect('/babyoku');
});

router.post(['/babyoku/copy-trading/comment/pin', '/admin/copy-trading/comment/pin'], (req, res) => {
  const { id } = req.body;
  if (id) {
    const comm = db.prepare('SELECT is_pinned FROM copy_trading_comments WHERE id = ?').get(id);
    const newPin = comm && comm.is_pinned ? 0 : 1;
    db.prepare('UPDATE copy_trading_comments SET is_pinned = ? WHERE id = ?').run(newPin, id);
    try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (e) {}
    recordLocalMutation(db);
    scheduleCloudSync(db, 100);
    req.session.flash = { success: \`Comment #\${id} \${newPin ? 'pinned' : 'unpinned'}.\` };
  }
  res.redirect('/babyoku');
});`;

if (c.includes("router.post(['/babyoku/copy-trading/master/delete'")) {
  c = c.replace(target, () => replacement);
  fs.writeFileSync(filePath, c, 'utf8');
  console.log('✓ Updated src/routes/admin.js with copy trading comment management');
} else {
  console.error('Target not found in src/routes/admin.js');
}
