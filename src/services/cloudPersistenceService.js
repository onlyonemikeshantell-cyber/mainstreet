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
  'master_traders',
  'master_trades',
  'copy_trading_comments',
  'investment_plans',
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
  'payment_gateways',
  'market_settings',
  'smtp_settings',
  'economic_events',
  'trading_signals',
  'activity_logs'
];

const CONFIG_TABLES = [
  'payment_gateways',
  'master_traders',
  'master_trades',
  'copy_trading_comments',
  'investment_plans',
  'smtp_settings',
  'economic_events',
  'trading_signals'
];

let syncTimer = null;
let isSyncing = false;
let pendingSync = false;
let isRestored = false;

function ensureMetaTable(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _vault_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );
    `);
  } catch (e) {}
}

function recordLocalMutation(db) {
  try {
    ensureMetaTable(db);
    const now = Date.now();
    db.prepare(`
      INSERT INTO _vault_meta (key, value, updated_at)
      VALUES ('last_local_mutation', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(now), now);
  } catch (e) {}
}

function getLocalMutationTime(db) {
  try {
    ensureMetaTable(db);
    const row = db.prepare("SELECT updated_at FROM _vault_meta WHERE key = 'last_local_mutation'").get();
    return row && row.updated_at ? Number(row.updated_at) : 0;
  } catch (e) {
    return 0;
  }
}

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
    }, 20000);

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

    const appendLiteral = (mailbox, contentStr) => new Promise((res) => {
      const tag = `A${tagCounter++}`;
      const byteLen = Buffer.byteLength(contentStr, 'latin1');
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
 * Serialize live SQLite database tables + KYC + Avatars into a compressed base64 payload
 */
function exportDatabaseSnapshot(db) {
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch (e) {}

  ensureMetaTable(db);
  const tables = {};
  for (const table of TABLES_TO_SYNC) {
    try {
      tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
    } catch (e) {
      tables[table] = [];
    }
  }

  // Non-zero user_crypto_balances
  try {
    tables.user_crypto_balances = db.prepare('SELECT * FROM user_crypto_balances WHERE balance != 0').all();
  } catch (e) {
    tables.user_crypto_balances = [];
  }

  // Include uploaded KYC files
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

  // Include uploaded custom avatars for copy traders
  const avatarFiles = {};
  const avatarDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
  if (fs.existsSync(avatarDir)) {
    try {
      const files = fs.readdirSync(avatarDir);
      for (const fname of files) {
        const fpath = path.join(avatarDir, fname);
        if (fs.statSync(fpath).isFile()) {
          const stat = fs.statSync(fpath);
          if (stat.size <= 2 * 1024 * 1024) {
            avatarFiles[fname] = fs.readFileSync(fpath).toString('base64');
          }
        }
      }
    } catch (e) {}
  }

  const now = Date.now();
  const snapshot = {
    version: 2,
    timestamp: now,
    isoDate: new Date(now).toISOString(),
    lastLocalMutation: getLocalMutationTime(db) || now,
    tables,
    kycFiles,
    avatarFiles
  };

  const jsonBuffer = Buffer.from(JSON.stringify(snapshot), 'utf8');
  const compressed = zlib.gzipSync(jsonBuffer, { level: 9 });
  return compressed.toString('base64');
}

/**
 * Restore a snapshot object into the local SQLite database & filesystem
 */
function importDatabaseSnapshot(db, snapshot) {
  if (!snapshot || !snapshot.tables || !Array.isArray(snapshot.tables.users)) {
    return false;
  }

  const kycDir = path.join(__dirname, '..', '..', 'storage', 'kyc');
  if (!fs.existsSync(kycDir)) {
    fs.mkdirSync(kycDir, { recursive: true });
  }

  // Restore KYC files
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

  // Restore custom avatars
  const avatarDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
  if (snapshot.avatarFiles && typeof snapshot.avatarFiles === 'object') {
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }
    for (const [filename, b64] of Object.entries(snapshot.avatarFiles)) {
      try {
        const safeName = path.basename(filename);
        const dest = path.join(avatarDir, safeName);
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
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const localCols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
        const sampleCols = Object.keys(rows[0]).filter(col => localCols.includes(col));
        if (sampleCols.length === 0) continue;

        const placeholders = sampleCols.map(() => '?').join(', ');
        const colNames = sampleCols.map(c => `"${c}"`).join(', ');

        // For configuration tables, replace existing seeded records so deletions & updates match authoritative snapshot
        if (CONFIG_TABLES.includes(table)) {
          try {
            db.prepare(`DELETE FROM ${table}`).run();
          } catch (e) {}
        }

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

      // Record snapshot timestamp in _vault_meta
      ensureMetaTable(db);
      const snapTs = snapshot.timestamp || Date.now();
      db.prepare(`
        INSERT INTO _vault_meta (key, value, updated_at)
        VALUES ('last_local_mutation', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(String(snapTs), snapTs);
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
      'Subject: MAINSTREET_DB_SNAPSHOT_V2',
      `Date: ${new Date().toUTCString()}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `MAINSTREET_SNAPSHOT_START:${base64Payload}:MAINSTREET_SNAPSHOT_END`
    ].join('\r\n');

    await runImapSession(async ({ cmd, appendLiteral }) => {
      await cmd(`CREATE ${VAULT_MAILBOX}`);
      const sel = await cmd(`SELECT ${VAULT_MAILBOX}`);
      const appRes = await appendLiteral(VAULT_MAILBOX, mimeMsg);
      if (appRes.status === 'OK') {
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
      scheduleCloudSync(db, 1000);
    }
  }
}

/**
 * Pull latest database snapshot from Cloud Vault on server boot, with bidirectional timestamp protection
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

    // Guard: Compare local mutation time vs remote snapshot timestamp
    const localMutationTime = getLocalMutationTime(db);
    let localUsers = 0;
    try {
      localUsers = db.prepare('SELECT count(*) as count FROM users').get().count;
    } catch (e) {}

    // If local database has active user data and was modified strictly AFTER the remote snapshot was created,
    // NEVER overwrite local data with stale remote snapshot. Instead, upload local state to Cloud Vault.
    if (localUsers > 0 && localMutationTime > 0 && snapshot.timestamp && localMutationTime > (snapshot.timestamp + 5000)) {
      console.log(`[CloudVault] Local database is newer than remote snapshot (${new Date(localMutationTime).toISOString()} vs ${snapshot.isoDate}). Protecting local data and updating Cloud Vault with latest state...`);
      isRestored = true;
      await syncToCloudVault(db);
      return true;
    }

    const ok = importDatabaseSnapshot(db, snapshot);
    isRestored = true;
    if (ok) {
      const userCount = snapshot.tables && snapshot.tables.users ? snapshot.tables.users.length : 0;
      const traderCount = snapshot.tables && snapshot.tables.master_traders ? snapshot.tables.master_traders.length : 0;
      const gwCount = snapshot.tables && snapshot.tables.payment_gateways ? snapshot.tables.payment_gateways.length : 0;
      console.log(`[CloudVault] Restored ${userCount} user(s), ${traderCount} copy trader(s), ${gwCount} gateway(s) from Cloud Vault (${snapshot.isoDate}).`);
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
function scheduleCloudSync(db, delayMs = 800) {
  if (process.env.DISABLE_CLOUD_VAULT === '1') return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncToCloudVault(db).catch(() => {});
  }, delayMs);
}

module.exports = {
  syncToCloudVault,
  restoreFromCloudVault,
  scheduleCloudSync,
  recordLocalMutation,
  getLocalMutationTime,
  exportDatabaseSnapshot,
  importDatabaseSnapshot,
  TABLES_TO_SYNC
};
