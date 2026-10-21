const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'tradexedge.db'));
db.pragma('journal_mode = WAL');

// Migration to ensure users table has kyc_status, phone, country
try {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('kyc_status')) db.exec("ALTER TABLE users ADD COLUMN kyc_status TEXT DEFAULT 'pending'");
  if (!userCols.includes('phone')) db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL");
  if (!userCols.includes('country')) db.exec("ALTER TABLE users ADD COLUMN country TEXT DEFAULT NULL");

  const retCols = db.prepare('PRAGMA table_info(retirement_accounts)').all().map(c => c.name);
  if (!retCols.includes('updated_at')) db.exec("ALTER TABLE retirement_accounts ADD COLUMN updated_at DATETIME DEFAULT NULL");

  const sysCols = db.prepare('PRAGMA table_info(system_settings)').all().map(c => c.name);
  if (!sysCols.includes('crypto_verification_mode')) db.exec("ALTER TABLE system_settings ADD COLUMN crypto_verification_mode TEXT DEFAULT 'live_blockchain'");
  if (!sysCols.includes('crypto_webhook_secret')) db.exec("ALTER TABLE system_settings ADD COLUMN crypto_webhook_secret TEXT DEFAULT 'wh_sec_mainstreet_2026_live'");

  const smtpCols = db.prepare('PRAGMA table_info(smtp_settings)').all().map(c => c.name);
  if (!smtpCols.includes('resend_api_key')) db.exec("ALTER TABLE smtp_settings ADD COLUMN resend_api_key TEXT DEFAULT ''");
  if (!smtpCols.includes('provider')) db.exec("ALTER TABLE smtp_settings ADD COLUMN provider TEXT DEFAULT 'resend'");

  // User Connected External Web3 Wallets Table
  db.exec("CREATE TABLE IF NOT EXISTS user_connected_wallets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, wallet_address TEXT NOT NULL, wallet_type TEXT DEFAULT 'walletconnect', chain_id TEXT DEFAULT '0x1', network_name TEXT DEFAULT 'Ethereum Mainnet', balance_cache REAL DEFAULT 0.0, currency_symbol TEXT DEFAULT 'ETH', is_active INTEGER DEFAULT 1, last_connected_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));");
  const cwCols = db.prepare('PRAGMA table_info(user_connected_wallets)').all().map(c => c.name);
  if (!cwCols.includes('token_balances')) db.exec("ALTER TABLE user_connected_wallets ADD COLUMN token_balances TEXT DEFAULT '{}'");

  // Ensure major ETFs exist in market_settings
  const etfInsert = db.prepare(`
    INSERT OR IGNORE INTO market_settings (symbol, name, category, spread, leverage, min_lot, max_lot, is_tradable)
    VALUES (?, ?, 'etf', ?, 20, 0.01, 50.0, 1)
  `);
  const majorEtfs = [
    ['SPY', 'SPDR S&P 500 ETF Trust', 0.05],
    ['QQQ', 'Invesco QQQ Trust (Nasdaq 100)', 0.05],
    ['VOO', 'Vanguard S&P 500 ETF', 0.04],
    ['VTI', 'Vanguard Total Stock Market ETF', 0.05],
    ['DIA', 'SPDR Dow Jones Industrial ETF', 0.06],
    ['IWM', 'iShares Russell 2000 ETF', 0.08],
    ['SMH', 'VanEck Semiconductor ETF', 0.10],
    ['SOXX', 'iShares Semiconductor ETF', 0.10],
    ['XLK', 'Technology Select Sector SPDR', 0.08],
    ['XLF', 'Financial Select Sector SPDR', 0.05],
    ['XLE', 'Energy Select Sector SPDR', 0.06],
    ['ARKK', 'ARK Innovation ETF', 0.12],
    ['GLD', 'SPDR Gold Shares ETF', 0.08],
    ['SLV', 'iShares Silver Trust ETF', 0.10],
    ['TLT', 'iShares 20+ Year Treasury Bond ETF', 0.06],
    ['BND', 'Vanguard Total Bond Market ETF', 0.05],
    ['IBIT', 'iShares Bitcoin Trust ETF', 0.10],
    ['ETHA', 'iShares Ethereum Trust ETF', 0.12]
  ];
  for (const [sym, name, spr] of majorEtfs) {
    const existing = db.prepare('SELECT id FROM market_settings WHERE symbol = ?').get(sym);
    if (!existing) {
      etfInsert.run(sym, name, spr);
    } else {
      db.prepare('UPDATE market_settings SET category = ? WHERE symbol = ?').run('etf', sym);
    }
  }

  // Ensure comprehensive Global Blue-Chip Stocks exist in market_settings
  const stockInsert = db.prepare(`
    INSERT OR IGNORE INTO market_settings (symbol, name, category, spread, leverage, min_lot, max_lot, is_tradable)
    VALUES (?, ?, 'stocks', ?, 20, 0.01, 100.0, 1)
  `);
  const majorStocks = [
    ['AVGO', 'Broadcom Inc.', 0.08],
    ['ORCL', 'Oracle Corporation', 0.06],
    ['CRM', 'Salesforce, Inc.', 0.08],
    ['INTC', 'Intel Corporation', 0.04],
    ['QCOM', 'QUALCOMM Incorporated', 0.06],
    ['ARM', 'Arm Holdings plc', 0.10],
    ['MU', 'Micron Technology, Inc.', 0.06],
    ['ASML', 'ASML Holding N.V.', 0.15],
    ['MA', 'Mastercard Incorporated', 0.08],
    ['BAC', 'Bank of America Corp', 0.04],
    ['GS', 'Goldman Sachs Group', 0.10],
    ['MS', 'Morgan Stanley', 0.06],
    ['WMT', 'Walmart Inc.', 0.04],
    ['COST', 'Costco Wholesale Corp', 0.12],
    ['HD', 'The Home Depot, Inc.', 0.08],
    ['KO', 'The Coca-Cola Company', 0.04],
    ['PEP', 'PepsiCo, Inc.', 0.06],
    ['PG', 'Procter & Gamble Co.', 0.06],
    ['MCD', 'McDonald\'s Corporation', 0.08],
    ['NKE', 'NIKE, Inc.', 0.05],
    ['JNJ', 'Johnson & Johnson', 0.06],
    ['UNH', 'UnitedHealth Group Inc.', 0.12],
    ['ABBV', 'AbbVie Inc.', 0.06],
    ['MRK', 'Merck & Co., Inc.', 0.05],
    ['PFE', 'Pfizer Inc.', 0.04],
    ['ISRG', 'Intuitive Surgical, Inc.', 0.12],
    ['VRTX', 'Vertex Pharmaceuticals', 0.12],
    ['REGN', 'Regeneron Pharmaceuticals', 0.15],
    ['XOM', 'Exxon Mobil Corporation', 0.05],
    ['CVX', 'Chevron Corporation', 0.06],
    ['NEE', 'NextEra Energy, Inc.', 0.05],
    ['ENPH', 'Enphase Energy, Inc.', 0.10],
    ['FSLR', 'First Solar, Inc.', 0.10],
    ['CAT', 'Caterpillar Inc.', 0.10],
    ['BA', 'The Boeing Company', 0.08],
    ['LMT', 'Lockheed Martin Corp', 0.12],
    ['GE', 'GE Aerospace', 0.06]
  ];
  for (const [sym, name, spr] of majorStocks) {
    const existing = db.prepare('SELECT id FROM market_settings WHERE symbol = ?').get(sym);
    if (!existing) {
      stockInsert.run(sym, name, spr);
    } else {
      db.prepare('UPDATE market_settings SET category = ? WHERE symbol = ?').run('stocks', sym);
    }
  }
} catch(e) {}


// 1. Users Table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    balance REAL DEFAULT 0.00,
    equity REAL DEFAULT 0.00,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    two_factor_enabled INTEGER DEFAULT 0,
    two_factor_secret TEXT DEFAULT NULL,
    trade_mode TEXT DEFAULT 'normal',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 2. Transactions Table
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    method TEXT DEFAULT 'crypto',
    reference TEXT UNIQUE,
    tx_hash TEXT DEFAULT NULL,
    receipt_url TEXT DEFAULT NULL,
    proof_image TEXT DEFAULT NULL,
    status TEXT DEFAULT 'pending',
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

const txCols = db.prepare('PRAGMA table_info(transactions)').all().map(c => c.name);
if (!txCols.includes('proof_image')) {
  db.exec("ALTER TABLE transactions ADD COLUMN proof_image TEXT DEFAULT NULL");
}

// 3. Trades Table
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL,
    lot_size REAL NOT NULL,
    open_price REAL NOT NULL,
    current_price REAL NOT NULL,
    close_price REAL DEFAULT NULL,
    take_profit REAL DEFAULT NULL,
    stop_loss REAL DEFAULT NULL,
    profit_loss REAL DEFAULT 0.00,
    status TEXT DEFAULT 'OPEN',
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// 4. Contact Messages Table
db.exec(`
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'unread',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 5. Email Logs Table
db.exec(`
  CREATE TABLE IF NOT EXISTS email_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    recipient_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 6. SMTP Settings Table
db.exec(`
  CREATE TABLE IF NOT EXISTS smtp_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT DEFAULT 'smtp.gmail.com',
    port INTEGER DEFAULT 587,
    user TEXT DEFAULT '',
    pass TEXT DEFAULT '',
    from_name TEXT DEFAULT 'Mainstreet Capital Exchange Desk',
    from_email TEXT DEFAULT 'support@mainstreetcapital.exchange',
    is_active INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 7. Payment Gateways Table
db.exec(`
  CREATE TABLE IF NOT EXISTS payment_gateways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    currency TEXT NOT NULL,
    network TEXT DEFAULT 'Mainnet',
    address TEXT NOT NULL,
    min_deposit REAL DEFAULT 50.00,
    instructions TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Ensure storage directories exist (outside public)
const kycDir = path.join(__dirname, '..', 'storage', 'kyc');
if (!fs.existsSync(kycDir)) {
  fs.mkdirSync(kycDir, { recursive: true });
}

// 8. KYC Documents Table
db.exec(`
  CREATE TABLE IF NOT EXISTS kyc_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    doc_number TEXT NOT NULL,
    front_image TEXT DEFAULT NULL,
    back_image TEXT DEFAULT NULL,
    video_path TEXT DEFAULT NULL,
    rejection_reason TEXT DEFAULT NULL,
    status TEXT DEFAULT 'pending',
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// 9. Market Settings Table
db.exec(`
  CREATE TABLE IF NOT EXISTS market_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    spread REAL DEFAULT 1.2,
    leverage INTEGER DEFAULT 100,
    min_lot REAL DEFAULT 0.01,
    max_lot REAL DEFAULT 50.00,
    is_tradable INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 10. Master Traders Table
db.exec(`
  CREATE TABLE IF NOT EXISTS master_traders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    strategy_name TEXT NOT NULL,
    category TEXT DEFAULT 'Multi-Asset',
    avatar TEXT DEFAULT '/images/avatars/trader1.jpg',
    total_roi REAL DEFAULT 340.5,
    win_rate REAL DEFAULT 94.2,
    copiers_count INTEGER DEFAULT 1240,
    aum_amount REAL DEFAULT 4800000.00,
    min_allocation REAL DEFAULT 250.00,
    profit_share REAL DEFAULT 15.0,
    risk_score INTEGER DEFAULT 2,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 11. Copy Subscriptions Table
db.exec(`
  CREATE TABLE IF NOT EXISTS copy_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    master_id INTEGER NOT NULL,
    allocated_amount REAL NOT NULL,
    current_profit REAL DEFAULT 0.00,
    status TEXT DEFAULT 'active',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    stopped_at DATETIME DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(master_id) REFERENCES master_traders(id)
  );
`);


// 14. Master Strategy Trades Table
db.exec(`
  CREATE TABLE IF NOT EXISTS master_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    master_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL,
    lot_size REAL NOT NULL,
    open_price REAL NOT NULL,
    current_price REAL NOT NULL,
    close_price REAL DEFAULT NULL,
    profit_loss REAL DEFAULT 0.00,
    status TEXT DEFAULT 'OPEN',
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME DEFAULT NULL,
    FOREIGN KEY(master_id) REFERENCES master_traders(id)
  );
`);

// 13. Password Resets Table
db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 12. Activity & Security Audit Logs Table
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed Default Gateways if empty
const gwCount = db.prepare('SELECT COUNT(*) as count FROM payment_gateways').get().count;
if (gwCount === 0) {
  const seedGw = db.prepare(`
    INSERT INTO payment_gateways (name, currency, network, address, min_deposit, instructions, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  seedGw.run('Bitcoin Direct', 'BTC', 'Bitcoin Network', 'bc1q9x3d0gq94z4y28r46v72e6m8k2a095jldk9a74', 100.0, 'Send only BTC on Bitcoin Native Network.');
  seedGw.run('Ethereum / USDT (ERC-20)', 'ETH / USDT', 'Ethereum (ERC-20)', '0x71C8366420A09271E59b208F38992D8f0019C45F', 100.0, 'Supports ETH and USDT ERC-20 transfers.');
  seedGw.run('Tether USDT (TRC-20)', 'USDT', 'Tron (TRC-20)', 'TYb9p85Y4Zg48d2mGf2K82J451A08X9D3E', 50.0, 'Fast settlement with lowest network fees.');
  seedGw.run('Institutional Bank Wire', 'USD', 'SWIFT / FedWire', 'Mainstreet Capital Exchange Liquidity Custody Inc - IBAN: US89CITI20001984285728 - BIC: CITIUS33', 1000.0, 'Direct wire transfer. Attach payment wire receipt below.');
}

// 15. Platform & System Settings Table
db.exec(`
  CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY,
    site_name TEXT DEFAULT 'Mainstreet Capital Exchange',
    site_title TEXT DEFAULT 'Institutional Multi-Asset Trading & Prime Execution',
    support_email TEXT DEFAULT 'support@mainstreetcapital.exchange',
    support_phone TEXT DEFAULT '+1 (800) 892-3401',
    office_address TEXT DEFAULT '100 Wall Street, 24th Floor, New York, NY 10005',
    primary_currency TEXT DEFAULT 'USD',
    default_leverage INTEGER DEFAULT 100,
    default_welcome_bonus REAL DEFAULT 10000.00,
    min_deposit REAL DEFAULT 50.00,
    min_withdrawal REAL DEFAULT 100.00,
    max_withdrawal REAL DEFAULT 50000.00,
    margin_call_level REAL DEFAULT 50.0,
    stop_out_level REAL DEFAULT 20.0,
    copy_profit_interval INTEGER DEFAULT 45,
    maintenance_mode INTEGER DEFAULT 0,
    auto_credit_deposit INTEGER DEFAULT 1,
    admin_2fa_required INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed System Settings row 1 if empty or update to Mainstreet Capital Exchange
const sysCount = db.prepare('SELECT COUNT(*) as count FROM system_settings').get().count;
if (sysCount === 0) {
  db.prepare(`
    INSERT INTO system_settings (id, site_name, site_title, support_email, support_phone, office_address, primary_currency, default_leverage, default_welcome_bonus, min_deposit, min_withdrawal, max_withdrawal, margin_call_level, stop_out_level, copy_profit_interval, maintenance_mode, auto_credit_deposit, admin_2fa_required)
    VALUES (1, 'Mainstreet Capital Exchange', 'Institutional Multi-Asset Trading & Prime Execution', 'support@mainstreetcapital.exchange', '+1 (800) 892-3401', '100 Wall Street, 24th Floor, New York, NY 10005', 'USD', 100, 10000.00, 50.00, 100.00, 50000.00, 50.0, 20.0, 45, 0, 1, 0)
  `).run();
} else {
  db.prepare(`
    UPDATE system_settings 
    SET site_name = 'Mainstreet Capital Exchange', 
        site_title = 'Institutional Multi-Asset Trading & Prime Execution', 
        support_email = 'support@mainstreetcapital.exchange'
    WHERE id = 1
  `).run();
}

// 16. Support Chat Messages Table
db.exec(`
  CREATE TABLE IF NOT EXISTS support_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    sender_role TEXT NOT NULL, -- 'user' | 'admin'
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// 17. User Multi-Asset Crypto Balances Table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_crypto_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    asset_symbol TEXT NOT NULL,
    asset_name TEXT NOT NULL,
    balance REAL DEFAULT 0.0,
    icon TEXT DEFAULT '🪙',
    rate_usd REAL DEFAULT 1.0,
    asset_type TEXT DEFAULT 'crypto',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, asset_symbol),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Helper to seed or verify crypto and stock balances for a user
const defaultSpotAssets = [
  { symbol: 'BTC', name: 'Bitcoin', icon: '₿', balance: 0.1250, rate: 64800.00, type: 'crypto' },
  { symbol: 'ETH', name: 'Ethereum', icon: 'Ξ', balance: 1.7500, rate: 3540.00, type: 'crypto' },
  { symbol: 'USDT', name: 'Tether USD', icon: '₮', balance: 5000.00, rate: 1.00, type: 'crypto' },
  { symbol: 'SOL', name: 'Solana', icon: '◎', balance: 18.5000, rate: 148.50, type: 'crypto' },
  { symbol: 'BNB', name: 'BNB Chain', icon: '🔶', balance: 4.2000, rate: 580.00, type: 'crypto' },
  { symbol: 'USD', name: 'US Dollar (Fiat)', icon: '$', balance: 10000.00, rate: 1.00, type: 'fiat' },
  // Blue-Chip Stocks to Buy and Hold
  { symbol: 'AAPL', name: 'Apple Inc.', icon: '🍏', balance: 15.0000, rate: 224.20, type: 'stock' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', icon: '🪟', balance: 8.0000, rate: 418.50, type: 'stock' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', icon: '🟢', balance: 25.0000, rate: 128.50, type: 'stock' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', icon: '⚡', balance: 12.0000, rate: 218.40, type: 'stock' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', icon: '📦', balance: 18.0000, rate: 178.60, type: 'stock' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. (Google)', icon: '🔍', balance: 14.0000, rate: 164.80, type: 'stock' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', icon: '♾️', balance: 6.0000, rate: 512.30, type: 'stock' },
  { symbol: 'PLTR', name: 'Palantir Technologies', icon: '👁️', balance: 80.0000, rate: 31.80, type: 'stock' },
  // Expanded Global Blue-Chip Equities Catalog
  { symbol: 'AMD', name: 'Advanced Micro Devices', icon: '🏛️', balance: 0.0, rate: 152.40, type: 'stock' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', icon: '🏛️', balance: 0.0, rate: 684.20, type: 'stock' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', icon: '🏛️', balance: 0.0, rate: 176.80, type: 'stock' },
  { symbol: 'ORCL', name: 'Oracle Corporation', icon: '🏛️', balance: 0.0, rate: 168.40, type: 'stock' },
  { symbol: 'CRM', name: 'Salesforce, Inc.', icon: '🏛️', balance: 0.0, rate: 288.50, type: 'stock' },
  { symbol: 'INTC', name: 'Intel Corporation', icon: '🏛️', balance: 0.0, rate: 24.60, type: 'stock' },
  { symbol: 'QCOM', name: 'QUALCOMM Incorporated', icon: '🏛️', balance: 0.0, rate: 172.30, type: 'stock' },
  { symbol: 'ARM', name: 'Arm Holdings plc', icon: '🏛️', balance: 0.0, rate: 144.80, type: 'stock' },
  { symbol: 'MU', name: 'Micron Technology, Inc.', icon: '🏛️', balance: 0.0, rate: 108.40, type: 'stock' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Mfg', icon: '🏛️', balance: 0.0, rate: 168.40, type: 'stock' },
  { symbol: 'ASML', name: 'ASML Holding N.V.', icon: '🏛️', balance: 0.0, rate: 842.50, type: 'stock' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', icon: '🏛️', balance: 0.0, rate: 214.50, type: 'stock' },
  { symbol: 'V', name: 'Visa Inc.', icon: '🏛️', balance: 0.0, rate: 268.90, type: 'stock' },
  { symbol: 'MA', name: 'Mastercard Incorporated', icon: '🏛️', balance: 0.0, rate: 492.40, type: 'stock' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', icon: '🏛️', balance: 0.0, rate: 448.20, type: 'stock' },
  { symbol: 'BAC', name: 'Bank of America Corp', icon: '🏛️', balance: 0.0, rate: 41.80, type: 'stock' },
  { symbol: 'GS', name: 'Goldman Sachs Group', icon: '🏛️', balance: 0.0, rate: 512.60, type: 'stock' },
  { symbol: 'MS', name: 'Morgan Stanley', icon: '🏛️', balance: 0.0, rate: 114.20, type: 'stock' },
  { symbol: 'COIN', name: 'Coinbase Global, Inc.', icon: '🏛️', balance: 0.0, rate: 218.50, type: 'stock' },
  { symbol: 'MSTR', name: 'MicroStrategy Inc.', icon: '🏛️', balance: 0.0, rate: 194.80, type: 'stock' },
  { symbol: 'WMT', name: 'Walmart Inc.', icon: '🏛️', balance: 0.0, rate: 80.40, type: 'stock' },
  { symbol: 'COST', name: 'Costco Wholesale Corp', icon: '🏛️', balance: 0.0, rate: 892.30, type: 'stock' },
  { symbol: 'HD', name: 'The Home Depot, Inc.', icon: '🏛️', balance: 0.0, rate: 394.50, type: 'stock' },
  { symbol: 'KO', name: 'The Coca-Cola Company', icon: '🏛️', balance: 0.0, rate: 69.80, type: 'stock' },
  { symbol: 'PEP', name: 'PepsiCo, Inc.', icon: '🏛️', balance: 0.0, rate: 172.40, type: 'stock' },
  { symbol: 'PG', name: 'Procter & Gamble Co.', icon: '🏛️', balance: 0.0, rate: 174.20, type: 'stock' },
  { symbol: 'MCD', name: 'McDonald\'s Corporation', icon: '🏛️', balance: 0.0, rate: 298.60, type: 'stock' },
  { symbol: 'NKE', name: 'NIKE, Inc.', icon: '🏛️', balance: 0.0, rate: 82.40, type: 'stock' },
  { symbol: 'DIS', name: 'The Walt Disney Company', icon: '🏛️', balance: 0.0, rate: 92.40, type: 'stock' },
  { symbol: 'UBER', name: 'Uber Technologies, Inc.', icon: '🏛️', balance: 0.0, rate: 72.80, type: 'stock' },
  { symbol: 'BABA', name: 'Alibaba Group Holding', icon: '🏛️', balance: 0.0, rate: 82.50, type: 'stock' },
  { symbol: 'LLY', name: 'Eli Lilly and Company', icon: '🏛️', balance: 0.0, rate: 942.50, type: 'stock' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', icon: '🏛️', balance: 0.0, rate: 162.80, type: 'stock' },
  { symbol: 'UNH', name: 'UnitedHealth Group Inc.', icon: '🏛️', balance: 0.0, rate: 584.20, type: 'stock' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', icon: '🏛️', balance: 0.0, rate: 194.60, type: 'stock' },
  { symbol: 'MRK', name: 'Merck & Co., Inc.', icon: '🏛️', balance: 0.0, rate: 114.80, type: 'stock' },
  { symbol: 'PFE', name: 'Pfizer Inc.', icon: '🏛️', balance: 0.0, rate: 28.90, type: 'stock' },
  { symbol: 'ISRG', name: 'Intuitive Surgical, Inc.', icon: '🏛️', balance: 0.0, rate: 486.40, type: 'stock' },
  { symbol: 'VRTX', name: 'Vertex Pharmaceuticals', icon: '🏛️', balance: 0.0, rate: 472.80, type: 'stock' },
  { symbol: 'REGN', name: 'Regeneron Pharmaceuticals', icon: '🏛️', balance: 0.0, rate: 998.50, type: 'stock' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', icon: '🏛️', balance: 0.0, rate: 121.40, type: 'stock' },
  { symbol: 'CVX', name: 'Chevron Corporation', icon: '🏛️', balance: 0.0, rate: 152.80, type: 'stock' },
  { symbol: 'NEE', name: 'NextEra Energy, Inc.', icon: '🏛️', balance: 0.0, rate: 84.20, type: 'stock' },
  { symbol: 'ENPH', name: 'Enphase Energy, Inc.', icon: '🏛️', balance: 0.0, rate: 96.40, type: 'stock' },
  { symbol: 'FSLR', name: 'First Solar, Inc.', icon: '🏛️', balance: 0.0, rate: 218.60, type: 'stock' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', icon: '🏛️', balance: 0.0, rate: 384.20, type: 'stock' },
  { symbol: 'BA', name: 'The Boeing Company', icon: '🏛️', balance: 0.0, rate: 156.40, type: 'stock' },
  { symbol: 'LMT', name: 'Lockheed Martin Corp', icon: '🏛️', balance: 0.0, rate: 586.40, type: 'stock' },
  { symbol: 'GE', name: 'GE Aerospace', icon: '🏛️', balance: 0.0, rate: 188.60, type: 'stock' }
];

const ensureUserCryptoBalances = (userId) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM user_crypto_balances WHERE user_id = ?').get(userId).count;
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  if (count === 0) {
    defaultSpotAssets.forEach(a => {
      insertStmt.run(userId, a.symbol, a.name, a.balance, a.icon, a.rate, a.type);
    });
  } else {
    // Ensure any newly added catalog stocks exist with 0.0 balance for existing users
    defaultSpotAssets.filter(a => a.type === 'stock').forEach(a => {
      insertStmt.run(userId, a.symbol, a.name, 0.0, a.icon, a.rate, a.type);
    });
  }
};

// Auto-seed for existing users in database
const allExistingUsers = db.prepare('SELECT id FROM users').all();
allExistingUsers.forEach(u => ensureUserCryptoBalances(u.id));

// 18. Investment Plans & Subscriptions Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS investment_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tier_badge TEXT NOT NULL,
    min_deposit REAL NOT NULL,
    max_deposit REAL NOT NULL,
    daily_roi REAL NOT NULL,
    weekly_roi REAL NOT NULL,
    duration_days INTEGER NOT NULL,
    risk_level TEXT DEFAULT 'Low-Medium',
    description TEXT,
    is_featured INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    invested_amount REAL NOT NULL,
    accrued_profit REAL DEFAULT 0.0,
    status TEXT DEFAULT 'active',
    start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_date DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(plan_id) REFERENCES investment_plans(id)
  );
`);

// Seed default plans if empty
const planCount = db.prepare('SELECT COUNT(*) as count FROM investment_plans').get().count;
if (planCount === 0) {
  const insertPlan = db.prepare(`
    INSERT INTO investment_plans (name, tier_badge, min_deposit, max_deposit, daily_roi, weekly_roi, duration_days, risk_level, description, is_featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertPlan.run('Bronze Starter', 'Starter Tier', 500, 4999, 1.78, 12.5, 7, 'Low Risk', 'Ideal for introductory quantitative portfolio growth with guaranteed principal protection.', 0);
  insertPlan.run('Silver Pro', 'Most Popular', 5000, 19999, 3.57, 25.0, 14, 'Balanced Alpha', 'High-frequency algorithmic market-making with automated risk hedging and priority withdrawals.', 1);
  insertPlan.run('Gold Executive', 'VIP Strategy', 20000, 99999, 6.42, 45.0, 30, 'Institutional Growth', 'Multi-asset quant allocation with dedicated portfolio manager and direct STP liquidity bridge.', 0);
  insertPlan.run('Diamond Institutional', 'Elite Tier', 100000, 10000000, 9.28, 65.0, 60, 'Prime Custody', 'Bespoke hedge fund yield strategy with segregated cold custody and customized yield structures.', 0);
}

// 19. Referrals, Economic Events & Trading Signals Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referee_id INTEGER NOT NULL,
    commission_earned REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(referrer_id) REFERENCES users(id),
    FOREIGN KEY(referee_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS economic_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    country TEXT NOT NULL,
    flag TEXT NOT NULL,
    impact TEXT NOT NULL, -- 'HIGH', 'MEDIUM', 'LOW'
    forecast TEXT,
    previous TEXT,
    event_time TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trading_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL, -- 'BUY', 'SELL'
    timeframe TEXT DEFAULT '1H',
    entry_price REAL NOT NULL,
    take_profit REAL NOT NULL,
    stop_loss REAL NOT NULL,
    confidence_score INTEGER DEFAULT 88,
    rationale TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed Economic Events if empty
const eventCount = db.prepare('SELECT COUNT(*) as count FROM economic_events').get().count;
if (eventCount === 0) {
  const insertEvent = db.prepare(`
    INSERT INTO economic_events (title, country, flag, impact, forecast, previous, event_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertEvent.run('US Core CPI (YoY) Inflation Data', 'United States', '🇺🇸', 'HIGH', '3.1%', '3.3%', 'Today 12:30 GMT');
  insertEvent.run('FOMC Interest Rate Decision & Statement', 'United States', '🇺🇸', 'HIGH', '5.25%', '5.50%', 'Tomorrow 18:00 GMT');
  insertEvent.run('US Non-Farm Payrolls (NFP) Employment', 'United States', '🇺🇸', 'HIGH', '185K', '206K', 'Friday 12:30 GMT');
  insertEvent.run('ECB Monetary Policy Rate Decision', 'Eurozone', '🇪🇺', 'HIGH', '3.75%', '4.00%', 'Thursday 13:15 GMT');
  insertEvent.run('UK Gross Domestic Product (QoQ)', 'United Kingdom', '🇬🇧', 'MEDIUM', '0.6%', '0.7%', 'Thursday 07:00 GMT');
  insertEvent.run('Crude Oil EIA Inventory Report', 'United States', '🇺🇸', 'MEDIUM', '-1.8M', '-4.8M', 'Wednesday 14:30 GMT');
}

// Seed Trading Signals if empty
const signalCount = db.prepare('SELECT COUNT(*) as count FROM trading_signals').get().count;
if (signalCount === 0) {
  const insertSignal = db.prepare(`
    INSERT INTO trading_signals (symbol, type, timeframe, entry_price, take_profit, stop_loss, confidence_score, rationale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSignal.run('BTC/USD', 'BUY', '4H', 64820.00, 68500.00, 62400.00, 94, 'Bullish Wyckoff accumulation breakout with heavy institutional volume on Equinix NY4.');
  insertSignal.run('ETH/USD', 'BUY', '1H', 3540.00, 3850.00, 3380.00, 89, 'Ascending triangle retest confirmed above 50-EMA support.');
  insertSignal.run('XAU/USD', 'BUY', '1D', 2418.50, 2480.00, 2385.00, 92, 'Geopolitical safe-haven demand breaking key daily resistance at $2,410.');
  insertSignal.run('EUR/USD', 'SELL', '1H', 1.0854, 1.0780, 1.0910, 86, 'Bearish divergence on 4-hour RSI with USD strength into CPI announcement.');
}

// Seed Market Settings Table if empty
const mktCount = db.prepare('SELECT COUNT(*) as count FROM market_settings').get().count;
if (mktCount === 0) {
  const insertMkt = db.prepare(`
    INSERT OR IGNORE INTO market_settings (symbol, name, category, spread, leverage, min_lot, max_lot, is_tradable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const initialInstruments = [('BTC/USD', 'Bitcoin Spot', 'crypto', 0.1, 100, 0.01, 50.0, 1), ('ETH/USD', 'Ethereum Spot', 'crypto', 0.2, 100, 0.01, 50.0, 1), ('SOL/USD', 'Solana High-Speed', 'crypto', 0.3, 100, 0.01, 50.0, 1), ('BNB/USD', 'BNB Chain Ecosystem', 'crypto', 0.4, 100, 0.01, 50.0, 1), ('XRP/USD', 'Ripple Institutional', 'crypto', 0.2, 100, 0.1, 100.0, 1), ('ADA/USD', 'Cardano Proof-of-Stake', 'crypto', 0.2, 100, 0.1, 100.0, 1), ('AVAX/USD', 'Avalanche Subnet', 'crypto', 0.3, 100, 0.01, 50.0, 1), ('DOGE/USD', 'Dogecoin Protocol', 'crypto', 0.1, 100, 1.0, 500.0, 1), ('DOT/USD', 'Polkadot Interoperability', 'crypto', 0.3, 100, 0.1, 100.0, 1), ('LINK/USD', 'Chainlink Oracle Network', 'crypto', 0.3, 100, 0.1, 100.0, 1), ('NEAR/USD', 'Near Protocol Sharding', 'crypto', 0.3, 100, 0.1, 100.0, 1), ('SUI/USD', 'Sui High-Throughput', 'crypto', 0.4, 100, 0.1, 100.0, 1), ('LTC/USD', 'Litecoin Decentralized', 'crypto', 0.2, 100, 0.01, 50.0, 1), ('MATIC/USD', 'Polygon PoS Scaling', 'crypto', 0.3, 100, 0.1, 100.0, 1), ('EUR/USD', 'Euro / US Dollar', 'forex', 0.0, 200, 0.01, 50.0, 1), ('GBP/USD', 'British Pound / US Dollar', 'forex', 0.2, 200, 0.01, 50.0, 1), ('USD/JPY', 'US Dollar / Japanese Yen', 'forex', 0.1, 200, 0.01, 50.0, 1), ('USD/CHF', 'US Dollar / Swiss Franc', 'forex', 0.2, 200, 0.01, 50.0, 1), ('AUD/USD', 'Australian Dollar / USD', 'forex', 0.2, 200, 0.01, 50.0, 1), ('USD/CAD', 'US Dollar / Canadian Dollar', 'forex', 0.2, 200, 0.01, 50.0, 1), ('NZD/USD', 'New Zealand Dollar / USD', 'forex', 0.3, 200, 0.01, 50.0, 1), ('EUR/GBP', 'Euro / British Pound', 'forex', 0.3, 200, 0.01, 50.0, 1), ('EUR/JPY', 'Euro / Japanese Yen', 'forex', 0.3, 200, 0.01, 50.0, 1), ('GBP/JPY', 'British Pound / Japanese Yen', 'forex', 0.4, 200, 0.01, 50.0, 1), ('USD/SGD', 'US Dollar / Singapore Dollar', 'forex', 0.4, 200, 0.01, 50.0, 1), ('XAU/USD', 'Spot Gold Bullion', 'commodities', 0.8, 100, 0.01, 20.0, 1), ('XAG/USD', 'Spot Silver Bullion', 'commodities', 1.2, 100, 0.01, 20.0, 1), ('USOIL', 'WTI Crude Oil Spot', 'commodities', 1.5, 100, 0.1, 50.0, 1), ('UKOIL', 'Brent North Sea Crude', 'commodities', 1.6, 100, 0.1, 50.0, 1), ('NATGAS', 'US Natural Gas', 'commodities', 2.0, 100, 0.1, 50.0, 1), ('XPT/USD', 'Spot Platinum Bullion', 'commodities', 1.8, 100, 0.01, 20.0, 1), ('US30', 'Wall Street 30 (Dow Jones)', 'indices', 1.0, 100, 0.01, 10.0, 1), ('NAS100', 'US Tech 100 (Nasdaq)', 'indices', 0.8, 100, 0.01, 10.0, 1), ('SPX500', 'US 500 Index (S&P 500)', 'indices', 0.5, 100, 0.01, 10.0, 1), ('GER40', 'German DAX 40 Index', 'indices', 1.2, 100, 0.01, 10.0, 1), ('UK100', 'FTSE 100 Index (London)', 'indices', 1.0, 100, 0.01, 10.0, 1), ('JPN225', 'Nikkei 225 (Tokyo)', 'indices', 1.4, 100, 0.01, 10.0, 1), ('NVDA', 'NVIDIA Corporation', 'indices', 0.5, 50, 0.01, 10.0, 1), ('AAPL', 'Apple Inc', 'indices', 0.4, 50, 0.01, 10.0, 1), ('TSLA', 'Tesla Motors Inc', 'indices', 0.6, 50, 0.01, 10.0, 1)];
  initialInstruments.forEach(i => insertMkt.run(...i));
}

// 20. Retirement Investment Accounts & Wealth Building Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS retirement_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_type TEXT NOT NULL, -- 'roth_ira' | 'traditional_ira' | 'sep_ira' | 'rollover_401k'
    account_number TEXT UNIQUE NOT NULL,
    balance REAL DEFAULT 0.00,
    equity REAL DEFAULT 0.00,
    total_contributed REAL DEFAULT 0.00,
    annual_limit REAL DEFAULT 7000.00,
    drip_enabled INTEGER DEFAULT 1,
    beneficiary_name TEXT DEFAULT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS retirement_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    source_type TEXT NOT NULL, -- 'cash_balance' | 'rollover' | 'deposit'
    tax_year INTEGER NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(account_id) REFERENCES retirement_accounts(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS retirement_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    asset_symbol TEXT NOT NULL,
    asset_name TEXT NOT NULL,
    asset_type TEXT NOT NULL, -- 'stock' | 'crypto' | 'basket'
    shares_or_units REAL NOT NULL,
    cost_basis REAL NOT NULL,
    icon TEXT DEFAULT '📈',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(account_id) REFERENCES retirement_accounts(id)
  );
`);

// Auto-provision initial retirement account for existing demo user
const ensureUserRetirementAccount = (userId) => {
  const existing = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
  if (!existing) {
    const accNum = 'IRA-' + (80000 + Number(userId)) + '-' + Math.floor(1000 + Math.random() * 9000);
    const result = db.prepare(`
      INSERT INTO retirement_accounts (user_id, account_type, account_number, balance, equity, total_contributed, annual_limit, drip_enabled, status)
      VALUES (?, 'roth_ira', ?, 3500.00, 3500.00, 3500.00, 7000.00, 1, 'active')
    `).run(userId, accNum);
    const accId = result.lastInsertRowid;

    // Record initial 2026 tax-year contribution
    db.prepare(`
      INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
      VALUES (?, ?, 3500.00, 'cash_balance', 2026, 'Initial Tax-Advantaged Allocation')
    `).run(accId, userId);

    // Seed starter long-term retirement holdings
    const insertHolding = db.prepare(`
      INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertHolding.run(accId, 'AAPL', 'Apple Inc.', 'stock', 5.0, 1121.00, '🍏');
    insertHolding.run(accId, 'MSFT', 'Microsoft Corporation', 'stock', 2.0, 837.00, '🪟');
    insertHolding.run(accId, 'NVDA', 'NVIDIA Corporation', 'stock', 4.0, 514.00, '🟢');
    insertHolding.run(accId, 'BTC', 'Bitcoin Cold IRA Vault', 'crypto', 0.015, 972.00, '₿');
  }
};

// 21. User Saved External Crypto Wallets (Address Book & Whitelist)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_saved_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    asset_symbol TEXT NOT NULL,
    network TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    is_whitelisted INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Helper to seed demo saved wallets for users if none exist
const ensureUserSavedWallets = (userId) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM user_saved_wallets WHERE user_id = ?').get(userId).count;
  if (count === 0) {
    const insertWallet = db.prepare(`
      INSERT INTO user_saved_wallets (user_id, label, asset_symbol, network, wallet_address, is_whitelisted)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    insertWallet.run(userId, 'Ledger Nano X (Cold Vault)', 'BTC', 'Bitcoin Native SegWit', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    insertWallet.run(userId, 'Trezor Vault (ERC-20)', 'USDT', 'Ethereum (ERC-20)', '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7');
    insertWallet.run(userId, 'Binance Corporate Payout', 'USDT', 'Tron (TRC-20)', 'TW1Rj1V8r15HkR8mP2eR8z9Yk1T5X8M3Q1');
  }
};

allExistingUsers.forEach(u => ensureUserSavedWallets(u.id));

module.exports = db;


// Seed SMTP row if empty
const smtpCount = db.prepare('SELECT COUNT(*) as count FROM smtp_settings').get().count;
if (smtpCount === 0) {
  db.prepare(`
    INSERT INTO smtp_settings (id, host, port, user, pass, from_name, from_email, is_active)
    VALUES (1, 'smtp.gmail.com', 587, '', '', 'Mainstreet Capital Exchange Broker Support', 'support@mainstreetcapitalexchange.com', 0)
  `).run();
}
