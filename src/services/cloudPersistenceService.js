const tls = require('tls');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const IMAP_HOST = process.env.SMTP_HOST || 'gaganyaan.gfireservers.in';
const IMAP_PORT = 993;
const IMAP_USER = process.env.SMTP_USER || 'support@mainstreetcapitalx.com';
const IMAP_PASS = process.env.SMTP_PASS || Buffer.from('UmVuYWlzc2FuY2UyMDI2IQ==', 'base64').toString('utf8');
const VAULT_MAILBOX = 'INBOX.MainstreetDBVault';

const TABLES_TO_SYNC = [
  'users',
  'kyc_documents',
  'transactions',
  'trades',
  'copy_subscriptions',
  'user_investments',
  'retirement_accounts',
  'retirement_contributions',
  'retirement_holdings',
  'user_saved_wallets',
  'user_connected_wallets',
  'notifications',
  'support_chat_messages',
  'contact_messages',
  'referrals',
  'password_resets',
  'system_settings',
  'payment_gateways'
];

let syncTimer = null;
let isSyncing = false;
let pendingSync = false;
let isRestored = false;

/**
 * Low-level promise-based IMAP client over TLS (zero external dependencies)
 */
function runImapSession(handler) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(IMAP_PORT, IMAP_HOST, { rejectUnauthorized: false });
    let buffer = '';
    let currentResolve = null;
    let currentTag = null;
    let tagCounter = 1;
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { socket.destroy(); } catch (e) {}
        reject(new Error('IMAP session timeout'));
      }
    }, 25000);

    const cleanup = () => {
      clearTimeout(timeout);
      try { socket.end(); } catch (e) {}
    };

    const checkBuffer = () => {
      if (!currentResolve) return;
      if (currentTag === 'GREETING') {
        if (buffer.includes('* OK')) {
          const out = buffer;
          buffer = '';
          const r = currentResolve;
          currentResolve = null;
          r(out);
        }
        return;
      }
      if (currentTag === 'CONTINUATION') {
        if (buffer.includes('\r\n+ ') || buffer.startsWith('+ ') || buffer.includes('\n+')) {
          const out = buffer;
          buffer = '';
          const r = currentResolve;
          currentResolve = null;
          r(out);
        }
        return;
      }
      // Look for tagged completion line: e.g. "A1 OK ...", "A1 NO ...", "A1 BAD ..."
      const regex = new RegExp(`(^|\\r?\\n)${currentTag} (OK|NO|BAD) [^\\r\\n]*\\r?\\n`);
      const match = regex.exec(buffer);
      if (match) {
        const out = buffer;
        buffer = '';
        const r = currentResolve;
        const status = match[2];
        currentResolve = null;
        r({ status, raw: out });
      }
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      checkBuffer();
    });

    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });

    const waitGreeting = () => new Promise((res) => {
      currentTag = 'GREETING';
      currentResolve = res;
      checkBuffer();
    });

    const cmd = (commandStr) => new Promise((res) => {
      const tag = `A${tagCounter++}`;
      currentTag = tag;
      currentResolve = res;
      socket.write(`${tag} ${commandStr}\r\n`, 'latin1');
    });

    const appendLiteral = (mailbox, contentStr) => new Promise((res, rej) => {
      const tag = `A${tagCounter++}`;
      const byteLen = Buffer.byteLength(contentStr, 'latin1');
      // Dovecot supports LITERAL+ ({size+}\r\n) or standard continuation
      currentTag = tag;
      currentResolve = res;
      socket.write(`${tag} APPEND ${mailbox} (\\Seen) {${byteLen}+}\r\n${contentStr}\r\n`, 'latin1');
    });

    (async () => {
      try {
        await waitGreeting();
        const quotedPass = `"${IMAP_PASS.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        const loginRes = await cmd(`LOGIN ${IMAP_USER} ${quotedPass}`);
        if (loginRes.status !== 'OK') {
          throw new Error('IMAP login failed');
        }
        const result = await handler({ cmd, appendLiteral });
        await cmd('LOGOUT').catch(() => {});
        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      }
    })();
  });
}

/**
 * Serialize live SQLite database tables + KYC files into a compressed base64 payload
 */
function exportDatabaseSnapshot(db) {
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch (e) {}

  const tables = {};
  for (const table of TABLES_TO_SYNC) {
    try {
      tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
    } catch (e) {
      tables[table] = [];
    }
  }

  // Only store non-zero user_crypto_balances to keep payload compact; 0-balance rows are auto-seeded
  try {
    tables.user_crypto_balances = db.prepare('SELECT * FROM user_crypto_balances WHERE balance != 0').all();
  } catch (e) {
    tables.user_crypto_balances = [];
  }

  // Include uploaded KYC files from storage/kyc referenced by kyc_documents
  const kycFiles = {};
  const kycDir = path.join(__dirname, '..', '..', 'storage', 'kyc');
  if (fs.existsSync(kycDir) && Array.isArray(tables.kyc_documents)) {
    for (const doc of tables.kyc_documents) {
      for (const field of ['front_image', 'back_image', 'video_path']) {
        const fname = doc[field];
        if (fname && typeof fname === 'string' && !fname.startsWith('data:')) {
          const fpath = path.join(kycDir, path.basename(fname));
          if (fs.existsSync(fpath)) {
            try {
              const stat = fs.statSync(fpath);
              if (stat.size <= 4 * 1024 * 1024) {
                kycFiles[path.basename(fname)] = fs.readFileSync(fpath).toString('base64');
              }
            } catch (e) {}
          }
        }
      }
    }
  }

  const snapshot = {
    version: 1,
    timestamp: Date.now(),
    isoDate: new Date().toISOString(),
    tables,
    kycFiles
  };

  const jsonBuffer = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const compressed = zlib.gzipSync(jsonBuffer, { level: 9 });
  return compressed.toString('base64');
}

/**
 * Restore a snapshot object into the local SQLite database & storage/kyc directory
 */
function importDatabaseSnapshot(db, snapshot) {
  if (!snapshot || !snapshot.tables || !Array.isArray(snapshot.tables.users)) {
    return false;
  }

  const kycDir = path.join(__dirname, '..', '..', 'storage', 'kyc');
  if (!fs.existsSync(kycDir)) {
    fs.mkdirSync(kycDir, { recursive: true });
  }

  // Restore KYC files first
  if (snapshot.kycFiles && typeof snapshot.kycFiles === 'object') {
    for (const [filename, b64] of Object.entries(snapshot.kycFiles)) {
      try {
        const safeName = path.basename(filename);
        const dest = path.join(kycDir, safeName);
        if (!fs.existsSync(dest)) {
          fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
        }
      } catch (e) {}
    }
  }

  db.pragma('foreign_keys = OFF');
  try {
    const restoreTx = db.transaction(() => {
      for (const table of TABLES_TO_SYNC) {
        const rows = snapshot.tables[table];
        if (!Array.isArray(rows)) continue;

        // Clear current table rows so deleted records stay deleted
        db.prepare(`DELETE FROM ${table}`).run();

        if (rows.length === 0) continue;

        // Get valid columns in local schema for forward/backward compatibility
        const localCols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
        const sampleCols = Object.keys(rows[0]).filter(col => localCols.includes(col));
        if (sampleCols.length === 0) continue;

        const placeholders = sampleCols.map(() => '?').join(', ');
        const colNames = sampleCols.map(c => `"${c}"`).join(', ');
        const insertStmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${colNames}) VALUES (${placeholders})`);

        for (const row of rows) {
          insertStmt.run(...sampleCols.map(c => row[c]));
        }
      }

      // Restore non-zero crypto balances and clean up removed users
      db.prepare('DELETE FROM user_crypto_balances WHERE user_id NOT IN (SELECT id FROM users)').run();
      db.prepare('UPDATE user_crypto_balances SET balance = 0').run();
      if (typeof db.ensureUserCryptoBalances === 'function') {
        for (const u of snapshot.tables.users) {
          db.ensureUserCryptoBalances(u.id);
        }
      }
      if (Array.isArray(snapshot.tables.user_crypto_balances)) {
        const updateBal = db.prepare('UPDATE user_crypto_balances SET balance = ? WHERE user_id = ? AND asset_symbol = ?');
        for (const row of snapshot.tables.user_crypto_balances) {
          updateBal.run(row.balance, row.user_id, row.asset_symbol);
        }
      }
    });

    restoreTx();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.pragma('foreign_keys = ON');
  }

  return true;
}

/**
 * Push current database state to the Cloud Vault
 */
async function syncToCloudVault(db) {
  if (process.env.DISABLE_CLOUD_VAULT === '1') return false;
  if (isSyncing) {
    pendingSync = true;
    return false;
  }

  isSyncing = true;
  try {
    const base64Payload = exportDatabaseSnapshot(db);
    const mimeMsg = [
      'From: Mainstreet Vault <support@mainstreetcapitalx.com>',
      'Subject: MAINSTREET_DB_SNAPSHOT_V1',
      `Date: ${new Date().toUTCString()}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `MAINSTREET_SNAPSHOT_START:${base64Payload}:MAINSTREET_SNAPSHOT_END`
    ].join('\r\n');

    await runImapSession(async ({ cmd, appendLiteral }) => {
      await cmd(`CREATE ${VAULT_MAILBOX}`);
      const sel = await cmd(`SELECT ${VAULT_MAILBOX}`);
      // Append the new snapshot first before deleting older ones
      const appRes = await appendLiteral(VAULT_MAILBOX, mimeMsg);
      if (appRes.status === 'OK') {
        // Check message count and purge older snapshots if > 1
        const existsMatch = /\* (\d+) EXISTS/.exec(sel.raw + '\r\n' + appRes.raw);
        // Re-select to get latest message count
        const selAfter = await cmd(`SELECT ${VAULT_MAILBOX}`);
        const countMatch = /\* (\d+) EXISTS/.exec(selAfter.raw);
        const total = countMatch ? parseInt(countMatch[1], 10) : 1;
        if (total > 1) {
          await cmd(`STORE 1:${total - 1} +FLAGS (\\Deleted)`);
          await cmd('EXPUNGE');
        }
      }
    });

    return true;
  } catch (err) {
    console.error('[CloudVault] Sync warning:', err.message);
    return false;
  } finally {
    isSyncing = false;
    if (pendingSync) {
      pendingSync = false;
      scheduleCloudSync(db, 1500);
    }
  }
}

/**
 * Pull latest database snapshot from the Cloud Vault on server boot
 */
async function restoreFromCloudVault(db) {
  if (process.env.DISABLE_CLOUD_VAULT === '1') return false;
  try {
    const payload = await runImapSession(async ({ cmd }) => {
      await cmd(`CREATE ${VAULT_MAILBOX}`);
      const sel = await cmd(`SELECT ${VAULT_MAILBOX}`);
      if (sel.status !== 'OK') return null;

      const countMatch = /\* (\d+) EXISTS/.exec(sel.raw);
      const total = countMatch ? parseInt(countMatch[1], 10) : 0;
      if (total === 0) return null;

      const fetchRes = await cmd(`FETCH ${total} BODY.PEEK[TEXT]`);
      if (fetchRes.status !== 'OK') return null;

      const markerMatch = /MAINSTREET_SNAPSHOT_START:([A-Za-z0-9+/=\r\n]+):MAINSTREET_SNAPSHOT_END/.exec(fetchRes.raw);
      if (!markerMatch) return null;
      return markerMatch[1].replace(/[\r\n\s]/g, '');
    });

    if (!payload) {
      console.log('[CloudVault] No existing remote snapshot found; initializing Cloud Vault from local mainstreet.db...');
      isRestored = true;
      await syncToCloudVault(db);
      return false;
    }

    const decompressed = zlib.gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
    const snapshot = JSON.parse(decompressed);
    const ok = importDatabaseSnapshot(db, snapshot);
    isRestored = true;
    if (ok) {
      console.log(`[CloudVault] Restored ${snapshot.tables.users.length} live user(s) from permanent Cloud Vault (${snapshot.isoDate}).`);
    }
    return ok;
  } catch (err) {
    console.error('[CloudVault] Restore warning:', err.message);
    isRestored = true;
    return false;
  }
}

/**
 * Debounced trigger to sync database changes after any write operation
 */
function scheduleCloudSync(db, delayMs = 1200) {
  if (process.env.DISABLE_CLOUD_VAULT === '1') return;
  if (!isRestored) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncToCloudVault(db).catch(() => {});
  }, delayMs);
}

module.exports = {
  syncToCloudVault,
  restoreFromCloudVault,
  scheduleCloudSync
};
