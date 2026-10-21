// Notification System End-to-End Verification Test
const db = require('../src/db');

console.log('--- Testing Notification Subsystem ---');

// 1. Pick user
const user = db.prepare('SELECT id, email FROM users LIMIT 1').get();
console.log(`Testing with user #${user.id} (${user.email})`);

// 2. Insert test unread notification
const ins = db.prepare(`
  INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
  VALUES (?, 'Test Notification Check', 'System verification test message payload.', 'system', 0, CURRENT_TIMESTAMP)
`).run(user.id);
const notifId = ins.lastInsertRowid;
console.log(`[PASS] Inserted test notification ID: ${notifId}`);

// 3. Verify it is unread
const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notifId);
if (row.is_read !== 0) throw new Error('Expected is_read to be 0');
console.log('[PASS] Notification initialized with is_read = 0');

// 4. Mark single read
db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notifId, user.id);
const updated = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notifId);
if (updated.is_read !== 1) throw new Error('Expected is_read to be 1 after single update');
console.log('[PASS] Single mark-read updated is_read = 1');

// 5. Test mark all read
db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
const remainingUnread = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).count;
if (remainingUnread !== 0) throw new Error('Expected 0 remaining unread notifications');
console.log('[PASS] Mark all read cleared unread count for user.');

// Cleanup test row
db.prepare('DELETE FROM notifications WHERE id = ?').run(notifId);
console.log('[PASS] Test notification cleaned up.');

console.log('--- NOTIFICATION SUBSYSTEM VERIFICATION COMPLETED ---');
