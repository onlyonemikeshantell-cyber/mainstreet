const fs = require('fs');
const path = require('path');

const dbFilePath = path.join(__dirname, '..', 'src', 'db.js');
let content = fs.readFileSync(dbFilePath, 'utf8');

const targetStr = "if (!smtpCols.includes('provider')) db.exec(\"ALTER TABLE smtp_settings ADD COLUMN provider TEXT DEFAULT 'resend'\");";
const addition = `if (!smtpCols.includes('provider')) db.exec("ALTER TABLE smtp_settings ADD COLUMN provider TEXT DEFAULT 'resend'");

  const elCols = db.prepare('PRAGMA table_info(email_logs)').all().map(c => c.name);
  if (!elCols.includes('sender_email')) {
    try { db.exec("ALTER TABLE email_logs ADD COLUMN sender_email TEXT DEFAULT NULL"); } catch (e) {}
  }

  // Persistent Registration & Verification OTPs Table (survives restarts & multi-worker instances)
  db.exec(\`
    CREATE TABLE IF NOT EXISTS email_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email);
  \`);`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, addition);
  fs.writeFileSync(dbFilePath, content, 'utf8');
  console.log('Successfully updated src/db.js with email_otps table and sender_email migration');
} else {
  console.error('Target string not found in src/db.js');
}
