const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('../db');
const { distributeQuarterlyDividends } = require('../services/dripService');
const { requireAdmin } = require('../middleware/auth');

// Activity Logger helper
const logActivity = (userId, action, details, req) => {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null) : null;
    const ua = req ? (req.headers['user-agent'] || 'Admin Console') : 'Admin Console';
    db.prepare(`
      INSERT INTO activity_logs (user_id, action, ip_address, user_agent, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, ip, ua, details);
  } catch (e) {
    console.error('Failed to log admin activity:', e.message);
  }
};

const processAvatarUpload = (avatarData) => {
  if (!avatarData || typeof avatarData !== 'string') {
    return 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80';
  }

  if (avatarData.startsWith('data:image/')) {
    try {
      const matches = avatarData.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (matches) {
        let ext = matches[1].replace('+xml', '');
        if (ext === 'jpeg') ext = 'jpg';
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `avatar_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
        const dir = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const fullPath = path.join(dir, filename);
        fs.writeFileSync(fullPath, buffer);
        return `/uploads/avatars/${filename}`;
      }
    } catch (e) {
      console.error('Error saving avatar image:', e);
    }
  }

  return avatarData.trim();
};


router.use((req, res, next) => {
  if (req.path.startsWith('/babyoku') || req.path.startsWith('/admin') || req.path.startsWith('/api/admin')) {
    return requireAdmin(req, res, next);
  }
  next();
});

// Secure KYC Document Serving (Admin Full Access, User Self-Document Access)
const getKycFilePath = (filename) => {
  const safeFilename = path.basename(filename);
  const primaryPath = process.env.DATA_DIR 
    ? path.join(process.env.DATA_DIR, 'kyc', safeFilename)
    : path.join(__dirname, '..', '..', 'storage', 'kyc', safeFilename);
  if (fs.existsSync(primaryPath)) return primaryPath;
  const fallbackPath = path.join(__dirname, '..', '..', 'storage', 'kyc', safeFilename);
  if (fs.existsSync(fallbackPath)) return fallbackPath;
  return null;
};

router.get(['/babyoku/kyc/file/:filename', '/admin/kyc/file/:filename'], requireAdmin, (req, res) => {
  const filePath = getKycFilePath(req.params.filename);
  if (!filePath) {
    return res.status(404).send('KYC document not found');
  }
  res.sendFile(filePath);
});

router.get('/storage/kyc/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = getKycFilePath(safeFilename);
  if (!filePath) {
    return res.status(404).send('KYC document not found');
  }

  // Public sample assets used in UI / walkthroughs
  if (safeFilename.startsWith('default_') || safeFilename.startsWith('verified_')) {
    return res.sendFile(filePath);
  }

  // Authenticated trader access to own documents or admin
  const currentUserId = req.session.userId;
  const isAdmin = req.session.adminId || (currentUserId && db.prepare('SELECT role FROM users WHERE id = ?').get(currentUserId)?.role === 'admin');
  if (isAdmin || (currentUserId && safeFilename.includes(`_user_${currentUserId}_`))) {
    return res.sendFile(filePath);
  }

  return res.status(403).send('Access denied');
});

// Unified Mailer Service (Resend / SMTP / Sandbox)
const { sendEmail } = require('../services/mailer');

// GET /admin -> Main Master Command Center
router.get(['/babyoku', '/admin'], (req, res) => {
  if (req.path === '/admin') {
    return res.redirect('/babyoku');
  }
  const users = db.prepare('SELECT * FROM users ORDER BY id DESC').all();
  const transactions = db.prepare(`
    SELECT t.*, u.name as user_name, u.email as user_email 
    FROM transactions t 
    JOIN users u ON t.user_id = u.id 
    ORDER BY t.created_at DESC 
    LIMIT 50
  `).all();
  const openTrades = db.prepare(`
    SELECT t.*, u.name as user_name, u.email as user_email 
    FROM trades t 
    JOIN users u ON t.user_id = u.id 
    WHERE t.status = 'OPEN' 
    ORDER BY t.opened_at DESC
  `).all();
  const closedTrades = db.prepare(`
    SELECT t.*, u.name as user_name, u.email as user_email 
    FROM trades t 
    JOIN users u ON t.user_id = u.id 
    WHERE t.status = 'CLOSED' 
    ORDER BY t.closed_at DESC 
    LIMIT 30
  `).all();
  const masterTraders = db.prepare('SELECT * FROM master_traders ORDER BY total_roi DESC').all();
  const masterTrades = db.prepare(`
    SELECT mt.*, m.name as master_name, m.strategy_name, m.avatar 
    FROM master_trades mt 
    JOIN master_traders m ON mt.master_id = m.id 
    ORDER BY mt.id DESC
  `).all();
  const copySubscriptions = db.prepare(`
    SELECT cs.*, u.name as user_name, u.email as user_email, mt.name as master_name, mt.strategy_name 
    FROM copy_subscriptions cs 
    JOIN users u ON cs.user_id = u.id 
    JOIN master_traders mt ON cs.master_id = mt.id 
    ORDER BY cs.id DESC
  `).all();
  const messages = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 20').all();
  const emailLogs = db.prepare('SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT 30').all();
  const gateways = db.prepare('SELECT * FROM payment_gateways ORDER BY id ASC').all();
  const kycList = db.prepare(`
    SELECT k.*, u.name as user_name, u.email as user_email 
    FROM kyc_documents k 
    JOIN users u ON k.user_id = u.id 
    ORDER BY k.submitted_at DESC
  `).all();
  const markets = db.prepare('SELECT * FROM market_settings ORDER BY id ASC').all();
  const smtp = db.prepare('SELECT * FROM smtp_settings ORDER BY id DESC LIMIT 1').get() || {};
  const systemSettings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() || {};

  const totalDeposits = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM transactions WHERE type = 'deposit' AND status = 'completed'").get().s;
  const totalWithdrawals = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM transactions WHERE type = 'withdrawal' AND status = 'completed'").get().s;
  const totalBalance = db.prepare("SELECT COALESCE(SUM(balance), 0) as s FROM users").get().s;

  const retirementAccounts = db.prepare(`
    SELECT ra.*, u.name as user_name, u.email as user_email 
    FROM retirement_accounts ra 
    JOIN users u ON ra.user_id = u.id 
    ORDER BY ra.id DESC
  `).all().map(ra => {
    ra.holdings = db.prepare(`
      SELECT id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis 
      FROM retirement_holdings 
      WHERE account_id = ?
    `).all(ra.id);
    return ra;
  });
  const totalRetirementAum = db.prepare("SELECT COALESCE(SUM(equity), 0) as s FROM retirement_accounts").get().s;
  const totalRetirementContributions = db.prepare("SELECT COALESCE(SUM(total_contributed), 0) as s FROM retirement_accounts").get().s;
  const activeDripCount = db.prepare("SELECT COUNT(*) as cnt FROM retirement_accounts WHERE drip_enabled = 1").get().cnt;

  const totalStats = {
    totalUsers: users.length,
    totalDeposits,
    totalWithdrawals,
    netRevenue: totalDeposits - totalWithdrawals,
    totalBalance,
    activeOpenTrades: openTrades.length,
    masterTradesCount: masterTrades.length,
    pendingWithdrawals: db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE type = 'withdrawal' AND status = 'pending'").get().cnt,
    pendingKyc: db.prepare("SELECT COUNT(*) as cnt FROM kyc_documents WHERE status = 'pending'").get().cnt,
    unreadMessages: db.prepare("SELECT COUNT(*) as cnt FROM contact_messages WHERE status = 'unread'").get().cnt,
    activeCopySubscriptions: copySubscriptions.filter(s => s.status === 'active').length,
    totalEmailsSent: emailLogs.length,
    totalRetirementAum,
    totalRetirementAccounts: retirementAccounts.length,
    totalRetirementContributions,
    activeDripCount
  };

  const effectiveAdminId = req.session.adminId || req.session.userId;
  const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(effectiveAdminId);

  res.render('app/admin', {
    adminBasePath: '/babyoku',
    title: 'Executive Master Command Desk | Mainstreet Capital Exchange',
    user: currentUser,
    users,
    transactions,
    openTrades,
    closedTrades,
    masterTraders,
    masterTrades,
    copySubscriptions,
    messages,
    emailLogs,
    gateways,
    kycList,
    markets,
    smtp,
    systemSettings,
    retirementAccounts,
    totalStats
  });
});

// ==============================================================================
// 1. MASTER TRADER MANAGEMENT (Create, Edit, Delete)
// ==============================================================================
router.post(['/babyoku/copy-trading/master/save', '/admin/copy-trading/master/save'], (req, res) => {
  const { id, name, avatar, strategy_name, category, win_rate, total_roi, risk_score, copiers_count, aum_amount, min_allocation, profit_share, description, is_active } = req.body;

  const savedAvatar = processAvatarUpload(avatar);

  if (id) {
    db.prepare(`
      UPDATE master_traders 
      SET name = ?, avatar = ?, strategy_name = ?, category = ?, win_rate = ?, total_roi = ?, risk_score = ?, copiers_count = ?, aum_amount = ?, min_allocation = ?, profit_share = ?, description = ?, is_active = ?
      WHERE id = ?
    `).run(
      name.trim(),
      savedAvatar,
      strategy_name.trim(),
      category || 'Multi-Asset',
      parseFloat(win_rate) || 90.0,
      parseFloat(total_roi) || 200.0,
      parseInt(risk_score) || 2,
      parseInt(copiers_count) || 500,
      parseFloat(aum_amount) || 1000000.0,
      parseFloat(min_allocation) || 250.0,
      parseInt(profit_share) || 15,
      description || '',
      is_active === '1' ? 1 : 0,
      id
    );
    req.session.flash = { success: `Master Trader '${name}' updated successfully!` };
  } else {
    db.prepare(`
      INSERT INTO master_traders (name, avatar, strategy_name, category, win_rate, total_roi, risk_score, copiers_count, aum_amount, min_allocation, profit_share, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      savedAvatar,
      strategy_name.trim(),
      category || 'Multi-Asset',
      parseFloat(win_rate) || 90.0,
      parseFloat(total_roi) || 200.0,
      parseInt(risk_score) || 2,
      parseInt(copiers_count) || 500,
      parseFloat(aum_amount) || 1000000.0,
      parseFloat(min_allocation) || 250.0,
      parseInt(profit_share) || 15,
      description || '',
      is_active === '1' ? 1 : 0
    );
    req.session.flash = { success: `New Master Trader '${name}' added to leaderboard!` };
  }
  res.redirect('/babyoku');
});

router.post(['/babyoku/copy-trading/master/delete', '/admin/copy-trading/master/delete'], (req, res) => {
  const { master_id } = req.body;
  db.prepare('DELETE FROM master_trades WHERE master_id = ?').run(master_id);
  db.prepare('DELETE FROM master_traders WHERE id = ?').run(master_id);
  req.session.flash = { success: `Master Trader #${master_id} and associated strategy trades removed.` };
  res.redirect('/babyoku');
});

// ==============================================================================
// 2. MASTER STRATEGY TRADES (Create, Edit P&L, Delete)
// ==============================================================================
router.post(['/babyoku/copy-trading/trade/create', '/admin/copy-trading/trade/create'], (req, res) => {
  const { master_id, symbol, type, lot_size, open_price, current_price, profit_loss, status, replicate_copiers } = req.body;
  const master = db.prepare('SELECT * FROM master_traders WHERE id = ?').get(master_id);

  if (!master) {
    req.session.flash = { error: 'Master Trader not found.' };
    return res.redirect('/babyoku');
  }

  const pnlNum = parseFloat(profit_loss) || 0.00;
  const openPriceNum = parseFloat(open_price) || 64000.0;
  const currentPriceNum = parseFloat(current_price) || openPriceNum;
  const lotNum = parseFloat(lot_size) || 1.0;
  const tradeStatus = status || 'OPEN';

  db.prepare(`
    INSERT INTO master_trades (master_id, symbol, type, lot_size, open_price, current_price, close_price, profit_loss, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    master.id,
    symbol || 'BTC/USD',
    (type || 'BUY').toUpperCase(),
    lotNum,
    openPriceNum,
    currentPriceNum,
    tradeStatus === 'CLOSED' ? currentPriceNum : null,
    pnlNum,
    tradeStatus
  );

  // If replicate to copiers is checked, distribute proportional profit to active subscriptions
  if (replicate_copiers === '1' && pnlNum !== 0) {
    const subs = db.prepare("SELECT * FROM copy_subscriptions WHERE master_id = ? AND status = 'active'").all(master.id);
    if (subs.length > 0) {
      const updateSubStmt = db.prepare('UPDATE copy_subscriptions SET current_profit = current_profit + ? WHERE id = ?');
      subs.forEach(sub => {
        // Distribute proportional micro-profit based on allocation
        const share = (pnlNum * (sub.allocated_amount / (master.aum_amount || 1000000)));
        const gain = Math.max(10.0, +share.toFixed(2));
        updateSubStmt.run(gain, sub.id);
      });
    }
  }

  req.session.flash = { success: `Successfully created ${symbol} trade for ${master.name} with P&L: $${pnlNum.toFixed(2)}!` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/copy-trading/trade/edit', '/admin/copy-trading/trade/edit'], (req, res) => {
  const { trade_id, symbol, type, lot_size, open_price, current_price, profit_loss, close_price, status } = req.body;
  const trade = db.prepare('SELECT * FROM master_trades WHERE id = ?').get(trade_id);

  if (!trade) {
    req.session.flash = { error: 'Master Trade not found.' };
    return res.redirect('/babyoku');
  }

  const pnlNum = parseFloat(profit_loss) || 0.00;
  const openPriceNum = parseFloat(open_price) || trade.open_price;
  const currentPriceNum = parseFloat(current_price) || trade.current_price;
  const closePriceNum = close_price ? parseFloat(close_price) : (status === 'CLOSED' ? currentPriceNum : null);
  const lotNum = parseFloat(lot_size) || trade.lot_size;

  db.prepare(`
    UPDATE master_trades 
    SET symbol = ?, type = ?, lot_size = ?, open_price = ?, current_price = ?, profit_loss = ?, close_price = ?, status = ?
    WHERE id = ?
  `).run(
    symbol || trade.symbol,
    (type || trade.type).toUpperCase(),
    lotNum,
    openPriceNum,
    currentPriceNum,
    pnlNum,
    closePriceNum,
    status || trade.status,
    trade.id
  );

  req.session.flash = { success: `Updated Master Trade #${trade.id} P&L to $${pnlNum.toFixed(2)}!` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/copy-trading/trade/delete', '/admin/copy-trading/trade/delete'], (req, res) => {
  const { trade_id } = req.body;
  db.prepare('DELETE FROM master_trades WHERE id = ?').run(trade_id);
  req.session.flash = { success: `Master Trade #${trade_id} deleted permanently.` };
  res.redirect('/babyoku');
});

// ==============================================================================
// 3. COPIER SUBSCRIPTIONS & DIRECT P&L MANIPULATION
// ==============================================================================
router.post(['/babyoku/copy-trading/subscription/create', '/admin/copy-trading/subscription/create'], (req, res) => {
  const { user_id, master_id, amount, initial_profit } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  const master = db.prepare('SELECT * FROM master_traders WHERE id = ?').get(master_id);

  if (!user || !master) {
    req.session.flash = { error: 'User or Master Trader not found.' };
    return res.redirect('/babyoku');
  }

  const alloc = parseFloat(amount) || master.min_allocation || 500.0;
  const initPnl = parseFloat(initial_profit) || 0.00;

  db.prepare(`
    INSERT INTO copy_subscriptions (user_id, master_id, allocated_amount, current_profit, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(user.id, master.id, alloc, initPnl);

  req.session.flash = { success: `Assigned ${user.name} to copy ${master.name} with $${alloc.toLocaleString()} capital and $${initPnl} initial P&L!` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/copy-trading/subscription/profit', '/admin/copy-trading/subscription/profit'], (req, res) => {
  const { subscription_id, current_profit } = req.body;
  const profitNum = parseFloat(current_profit) || 0.0;

  db.prepare('UPDATE copy_subscriptions SET current_profit = ? WHERE id = ?').run(profitNum, subscription_id);

  req.session.flash = { success: `Copied profit for Subscription #${subscription_id} updated to $${profitNum.toFixed(2)}!` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/copy-trading/subscription/settle', '/admin/copy-trading/subscription/settle'], (req, res) => {
  const { subscription_id } = req.body;
  const sub = db.prepare('SELECT * FROM copy_subscriptions WHERE id = ?').get(subscription_id);

  if (!sub) {
    req.session.flash = { error: 'Subscription not found.' };
    return res.redirect('/babyoku');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(sub.user_id);
  const returnTotal = sub.allocated_amount + sub.current_profit;
  const newBal = user.balance + returnTotal;

  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newBal, user.id);
  db.prepare("UPDATE copy_subscriptions SET status = 'stopped', stopped_at = CURRENT_TIMESTAMP WHERE id = ?").run(sub.id);

  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
    VALUES (?, 'copy_settle', ?, 'USD', 'completed', 'Admin Settle', ?, ?)
  `).run(user.id, returnTotal, 'CPY-SET-ADM-' + Date.now(), `Admin force-settled copy strategy: Capital ($${sub.allocated_amount}) + PnL ($${sub.current_profit})`);

  req.session.flash = { success: `Settled Subscription #${sub.id}. Returned $${returnTotal.toFixed(2)} directly to ${user.name}'s balance.` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/copy-trading/subscription/delete', '/admin/copy-trading/subscription/delete'], (req, res) => {
  const { subscription_id } = req.body;
  db.prepare('DELETE FROM copy_subscriptions WHERE id = ?').run(subscription_id);
  req.session.flash = { success: `Copy Subscription #${subscription_id} removed.` };
  res.redirect('/babyoku');
});

// ==============================================================================
// 4. USER TRADES & BALANCE OVERRIDE
// ==============================================================================
router.post(['/babyoku/trade/edit', '/admin/trade/edit'], (req, res) => {
  const { trade_id, symbol, type, lot_size, open_price, current_price, profit_loss, close_price, status } = req.body;
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(trade_id);
  if (!trade) {
    req.session.flash = { error: 'Trade not found.' };
    return res.redirect('/babyoku');
  }

  const pnlNum = parseFloat(profit_loss) || 0.00;
  const openPriceNum = parseFloat(open_price) || trade.open_price;
  const currentPriceNum = parseFloat(current_price) || trade.current_price;
  const closePriceNum = close_price ? parseFloat(close_price) : (status === 'CLOSED' ? currentPriceNum : null);
  const lotNum = parseFloat(lot_size) || trade.lot_size;

  db.prepare(`
    UPDATE trades 
    SET symbol = ?, type = ?, lot_size = ?, open_price = ?, current_price = ?, profit_loss = ?, close_price = ?, status = ?
    WHERE id = ?
  `).run(symbol || trade.symbol, (type || trade.type).toUpperCase(), lotNum, openPriceNum, currentPriceNum, pnlNum, closePriceNum, status || trade.status, trade.id);

  if (status === 'CLOSED' && trade.status !== 'CLOSED') {
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(trade.user_id);
    const newBal = user.balance + pnlNum;
    db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newBal, trade.user_id);
  }

  req.session.flash = { success: `Successfully updated Trade #${trade.id} P&L to $${pnlNum.toFixed(2)}!` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/trade/create', '/admin/trade/create'], (req, res) => {
  const { user_id, symbol, type, lot_size, open_price, current_price, profit_loss, status } = req.body;
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!targetUser) {
    req.session.flash = { error: 'User not found.' };
    return res.redirect('/babyoku');
  }

  const pnlNum = parseFloat(profit_loss) || 0.00;
  const openPriceNum = parseFloat(open_price) || 65000.0;
  const currentPriceNum = parseFloat(current_price) || openPriceNum;
  const lotNum = parseFloat(lot_size) || 0.5;
  const tradeStatus = status || 'OPEN';

  db.prepare(`
    INSERT INTO trades (user_id, symbol, type, lot_size, open_price, current_price, close_price, profit_loss, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    targetUser.id,
    symbol || 'BTC/USD',
    (type || 'BUY').toUpperCase(),
    lotNum,
    openPriceNum,
    currentPriceNum,
    tradeStatus === 'CLOSED' ? currentPriceNum : null,
    pnlNum,
    tradeStatus
  );

  if (tradeStatus === 'CLOSED' && pnlNum !== 0) {
    const newBal = targetUser.balance + pnlNum;
    db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newBal, targetUser.id);
  }

  req.session.flash = { success: `Successfully injected custom ${symbol} trade for ${targetUser.name} with P&L: $${pnlNum}!` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/trade/delete', '/admin/trade/delete'], (req, res) => {
  const { trade_id } = req.body;
  db.prepare('DELETE FROM trades WHERE id = ?').run(trade_id);
  req.session.flash = { success: `Trade #${trade_id} deleted permanently.` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/user/set-balance', '/admin/user/set-balance'], (req, res) => {
  const { 
    user_id, 
    exact_balance, 
    exact_equity,
    btc_balance,
    eth_balance,
    usdt_balance,
    sol_balance,
    bnb_balance,
    xrp_balance,
    ada_balance,
    doge_balance,
    avax_balance,
    link_balance,
    sui_balance,
    ton_balance,
    pepe_balance
  } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) {
    req.session.flash = { error: 'User not found.' };
    return res.redirect('/babyoku');
  }

  const newBal = parseFloat(exact_balance) || 0.00;
  const newEq = exact_equity !== undefined && exact_equity !== '' ? parseFloat(exact_equity) : newBal;

  // 1. Update cash balance & equity in users table
  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newEq, user.id);

  // 2. Helper to upsert crypto assets in user_crypto_balances
  const upsertAsset = (symbol, name, balanceVal, icon, rate) => {
    const bal = parseFloat(balanceVal) || 0;
    db.prepare(`
      INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, asset_symbol) DO UPDATE SET 
        balance = excluded.balance,
        icon = excluded.icon,
        rate_usd = excluded.rate_usd,
        updated_at = CURRENT_TIMESTAMP
    `).run(user.id, symbol, name, bal, icon, rate);
  };

  upsertAsset('BTC', 'Bitcoin', btc_balance, '₿', 64800.00);
  upsertAsset('ETH', 'Ethereum', eth_balance, 'Ξ', 3540.00);
  upsertAsset('USDT', 'Tether USD', usdt_balance, '₮', 1.00);
  upsertAsset('SOL', 'Solana', sol_balance, '☀️', 148.50);
  upsertAsset('BNB', 'BNB Chain', bnb_balance, '🟡', 582.00);
  upsertAsset('XRP', 'Ripple', xrp_balance, '✕', 0.58);
  upsertAsset('ADA', 'Cardano', ada_balance, '₳', 0.38);
  upsertAsset('DOGE', 'Dogecoin', doge_balance, '🐕', 0.10);
  upsertAsset('AVAX', 'Avalanche', avax_balance, '🔺', 24.50);
  upsertAsset('LINK', 'Chainlink', link_balance, '🔗', 11.80);
  upsertAsset('SUI', 'Sui', sui_balance, '🌊', 0.88);
  upsertAsset('TON', 'Toncoin', ton_balance, '💎', 5.60);
  upsertAsset('PEPE', 'Pepe', pepe_balance, '🐸', 0.0000085);

  // 3. Record transaction & activity log
  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
    VALUES (?, 'transfer', ?, 'USD', 'completed', 'Master Balance Override', ?, ?)
  `).run(user.id, newBal, 'BAL-SET-' + Date.now(), `Admin configured cash ($${newBal}) and multi-crypto balances`);

  db.prepare(`
    INSERT INTO activity_logs (user_id, action, ip_address, details)
    VALUES (?, 'ADMIN_SET_MULTI_BALANCES', ?, ?)
  `).run(user.id, req.ip, `Set Cash $${newBal}, Equity $${newEq}, BTC ${btc_balance || 0}, ETH ${eth_balance || 0}, USDT ${usdt_balance || 0}`);

  req.session.flash = { success: `Successfully updated multi-asset balances for ${user.email} (Cash: $${newBal.toLocaleString(undefined, {minimumFractionDigits: 2})})` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/user/trade-mode', '/admin/user/trade-mode'], (req, res) => {
  const { user_id, trade_mode } = req.body;
  db.prepare('UPDATE users SET trade_mode = ? WHERE id = ?').run(trade_mode || 'normal', user_id);
  req.session.flash = { success: `Trade mode for User #${user_id} updated to '${trade_mode.toUpperCase()}'!` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/user/status', '/admin/user/status'], (req, res) => {
  const { user_id, is_active } = req.body;
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(parseInt(is_active) || 1, user_id);
  req.session.flash = { success: `User status updated.` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/user/kyc-status', '/admin/user/kyc-status'], async (req, res) => {
  const { user_id, kyc_status } = req.body;
  const validStatus = ['verified', 'pending', 'rejected', 'unverified'].includes(kyc_status) ? kyc_status : 'verified';
  db.prepare('UPDATE users SET kyc_status = ? WHERE id = ?').run(validStatus, user_id);
  const targetUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(user_id);
  if (validStatus === 'verified') {
    db.prepare("UPDATE kyc_documents SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'pending'").run(user_id);
    try {
      db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'kyc')")
        .run(user_id, 'Compliance Verification Confirmed', 'Administrator has approved your account for Tier-1 Verified status.');
    } catch(e) {}
    if (targetUser && targetUser.email) {
      sendEmail({
        to: targetUser.email,
        subject: 'KYC Approved — Your Mainstreet Capital Exchange Account Is Now Unlocked',
        message: `Hello ${targetUser.name || 'Trader'},\n\nCongratulations! Your KYC identity verification has been reviewed and approved by our Compliance Desk.\n\nYour live trading account is now fully unlocked. You can now access your dashboard, fund your account, and trade across all institutional markets at https://mainstreetcapitalx.com/dashboard.`,
        recipientType: 'user'
      }).catch(() => {});
    }
  } else if (validStatus === 'rejected') {
    db.prepare("UPDATE kyc_documents SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'pending'").run(user_id);
  }
  req.session.flash = { success: `KYC status for User #${user_id} updated to ${validStatus.toUpperCase()}!` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/user/reset-password', '/admin/user/reset-password'], (req, res) => {
  const { user_id, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    req.session.flash = { error: 'Password must be at least 6 characters.' };
    return res.redirect('/babyoku');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user_id);
  req.session.flash = { success: `Password for User #${user_id} successfully reset.` };
  res.redirect('/babyoku');
});

// DELETE User & Cascade cleanup
router.post(['/babyoku/user/delete', '/admin/user/delete'], requireAdmin, (req, res) => {
  const { user_id } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) {
    req.session.flash = { error: 'User not found.' };
    return res.redirect('/babyoku');
  }

  const effectiveAdminId = req.session.adminId || req.session.userId;
  if (user.id === effectiveAdminId) {
    req.session.flash = { error: 'Cannot delete your own active administrator account.' };
    return res.redirect('/babyoku');
  }

  const deleteTransaction = db.transaction(() => {
    try {
      const accts = db.prepare('SELECT id FROM retirement_accounts WHERE user_id = ?').all(user_id);
      for (const a of accts) {
        db.prepare('DELETE FROM retirement_holdings WHERE account_id = ?').run(a.id);
        db.prepare('DELETE FROM retirement_contributions WHERE account_id = ?').run(a.id);
      }
      db.prepare('DELETE FROM retirement_accounts WHERE user_id = ?').run(user_id);
      db.prepare('DELETE FROM retirement_contributions WHERE user_id = ?').run(user_id);
    } catch (e) {}
    try { db.prepare('DELETE FROM user_saved_wallets WHERE user_id = ?').run(user_id); } catch (e) {}
    try { db.prepare('DELETE FROM user_connected_wallets WHERE user_id = ?').run(user_id); } catch (e) {}
    db.prepare('DELETE FROM trades WHERE user_id = ?').run(user_id);
    db.prepare('DELETE FROM transactions WHERE user_id = ?').run(user_id);
    db.prepare('DELETE FROM kyc_documents WHERE user_id = ?').run(user_id);
    db.prepare('DELETE FROM copy_subscriptions WHERE user_id = ?').run(user_id);
    db.prepare('DELETE FROM activity_logs WHERE user_id = ?').run(user_id);
    db.prepare('DELETE FROM support_chat_messages WHERE user_id = ?').run(user_id);
    db.prepare('DELETE FROM user_crypto_balances WHERE user_id = ?').run(user_id);
    db.prepare('DELETE FROM user_investments WHERE user_id = ?').run(user_id);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(user_id);
    try { db.prepare('DELETE FROM referrals WHERE referee_id = ? OR referrer_id = ?').run(user_id, user_id); } catch (e) {}
    db.prepare('DELETE FROM users WHERE id = ?').run(user_id);
  });

  try {
    deleteTransaction();
    req.session.flash = { success: `User #${user_id} (${user.name} - ${user.email}) permanently deleted.` };
  } catch (err) {
    console.error('Delete User Error:', err.message);
    req.session.flash = { error: 'Failed to delete user: ' + err.message };
  }

  res.redirect('/babyoku');
});

router.all(['/babyoku/user/impersonate/:id', '/admin/user/impersonate/:id'], (req, res) => {
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!targetUser) {
    req.session.flash = { error: 'User not found.' };
    return res.redirect('/babyoku');
  }

  // Strictly verify originating session possesses active administrator privileges
  const adminIdToKeep = req.session.adminId || req.session.userId;
  const adminUser = db.prepare('SELECT * FROM users WHERE id = ?').get(adminIdToKeep);
  if (!adminUser || adminUser.role !== 'admin') {
    req.session.flash = { error: 'Access denied: Administrator privileges required.' };
    return res.redirect('/dashboard');
  }

  req.session.adminId = adminIdToKeep;
  req.session.userId = targetUser.id;
  logActivity(adminIdToKeep, 'ADMIN_IMPERSONATE', `Admin #${adminIdToKeep} impersonating user #${targetUser.id} (${targetUser.email})`, req);
  req.session.flash = { success: `Now impersonating ${targetUser.name} (${targetUser.email}).` };
  res.redirect('/dashboard');
});

router.all(['/babyoku/switch-back', '/admin/switch-back'], (req, res) => {
  if (req.session.adminId) {
    req.session.userId = req.session.adminId;
    req.session.adminId = null;
    req.session.flash = { success: 'Returned to Administrator Control Center.' };
  }
  res.redirect('/babyoku');
});

router.post(['/babyoku/gateways/delete', '/admin/gateways/delete'], (req, res) => {
  const { id } = req.body;
  if (id) {
    db.prepare('DELETE FROM payment_gateways WHERE id = ?').run(id);
    req.session.flash = { success: 'Payment gateway deleted successfully.' };
  }
  res.redirect('/babyoku');
});

router.post(['/babyoku/gateways/save', '/admin/gateways/save'], (req, res) => {
  const { id, name, currency, network, address, instructions, min_deposit, is_active } = req.body;
  if (id) {
    db.prepare(`
      UPDATE payment_gateways 
      SET name = ?, currency = ?, network = ?, address = ?, instructions = ?, min_deposit = ?, is_active = ?
      WHERE id = ?
    `).run(name, currency, network, address, instructions, parseFloat(min_deposit) || 50.0, is_active === '1' ? 1 : 0, id);
    req.session.flash = { success: `Payment gateway '${name}' updated successfully.` };
  } else {
    db.prepare(`
      INSERT INTO payment_gateways (name, currency, network, address, instructions, min_deposit, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, currency, network, address, instructions, parseFloat(min_deposit) || 50.0, is_active === '1' ? 1 : 0);
    req.session.flash = { success: `New payment gateway '${name}' added.` };
  }
  res.redirect('/babyoku');
});

router.post(['/babyoku/kyc/action', '/admin/kyc/action'], (req, res) => {
  const { kyc_id, action, rejection_reason } = req.body;
  const status = (action === 'approve' || action === 'approved') ? 'approved' : 'rejected';
  const doc = db.prepare('SELECT * FROM kyc_documents WHERE id = ?').get(kyc_id);
  if (!doc) {
    req.session.flash = { error: 'Document not found.' };
    return res.redirect('/babyoku');
  }

  db.prepare(`
    UPDATE kyc_documents 
    SET status = ?, rejection_reason = ?, reviewed_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(status, rejection_reason || null, doc.id);

  // Sync user's global KYC status
  const userKycStatus = (status === 'approved') ? 'verified' : 'rejected';
  db.prepare('UPDATE users SET kyc_status = ? WHERE id = ?').run(userKycStatus, doc.user_id);
  const targetUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(doc.user_id);

  try {
    const isApp = (status === 'approved');
    const notifTitle = isApp ? 'Identity Verification Approved' : 'Identity Verification Declined';
    const notifMsg = isApp 
      ? 'Your compliance identity verification has been approved. Full institutional trading and withdrawal limits are now unlocked.'
      : `Your KYC document submission was declined. Reason: ${rejection_reason || 'Incomplete documentation. Please resubmit clear photos.'}`;
    db.prepare('INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)')
      .run(doc.user_id, notifTitle, notifMsg, 'kyc');
    if (targetUser && targetUser.email) {
      sendEmail({
        to: targetUser.email,
        subject: isApp
          ? 'KYC Approved — Your Mainstreet Capital Exchange Account Is Now Unlocked'
          : 'Action Required: KYC Verification Update — Mainstreet Capital Exchange',
        message: isApp
          ? `Hello ${targetUser.name || 'Trader'},\n\nCongratulations! Your KYC identity verification has been reviewed and approved by our Compliance Desk.\n\nYour live trading account is now fully unlocked. You can access your trading dashboard at https://mainstreetcapitalx.com/dashboard.`
          : `Hello ${targetUser.name || 'Trader'},\n\nYour recent KYC document submission could not be approved. Reason: ${rejection_reason || 'Please submit clear, unobstructed identification photos.'}\n\nPlease sign in at https://mainstreetcapitalx.com/onboarding/kyc to resubmit your verification documents.`,
        recipientType: 'user'
      }).catch(() => {});
    }
  } catch(ne) {}

  req.session.flash = { success: `KYC Document #${doc.id} successfully marked as ${status.toUpperCase()} (Trader KYC updated to ${userKycStatus}).` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/kyc/review', '/admin/kyc/review'], (req, res) => {
  const { kyc_id, status, rejection_reason } = req.body;
  const doc = db.prepare('SELECT * FROM kyc_documents WHERE id = ?').get(kyc_id);
  if (!doc) {
    req.session.flash = { error: 'Document not found.' };
    return res.redirect('/babyoku');
  }

  db.prepare(`
    UPDATE kyc_documents 
    SET status = ?, rejection_reason = ?, reviewed_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(status, rejection_reason || null, doc.id);

  // Sync user's global KYC status
  const userKycStatus = (status === 'approved') ? 'verified' : (status === 'rejected' ? 'rejected' : 'pending');
  db.prepare('UPDATE users SET kyc_status = ? WHERE id = ?').run(userKycStatus, doc.user_id);
  const targetUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(doc.user_id);

  try {
    const isApp = (status === 'approved');
    const notifTitle = isApp ? 'Identity Verification Approved' : 'Identity Verification Declined';
    const notifMsg = isApp 
      ? 'Your compliance identity verification has been approved. Full institutional trading and withdrawal limits are now unlocked.'
      : `Your KYC document submission was declined. Reason: ${rejection_reason || 'Incomplete documentation. Please resubmit clear photos.'}`;
    db.prepare('INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)')
      .run(doc.user_id, notifTitle, notifMsg, 'kyc');
    if (targetUser && targetUser.email && (status === 'approved' || status === 'rejected')) {
      sendEmail({
        to: targetUser.email,
        subject: isApp
          ? 'KYC Approved — Your Mainstreet Capital Exchange Account Is Now Unlocked'
          : 'Action Required: KYC Verification Update — Mainstreet Capital Exchange',
        message: isApp
          ? `Hello ${targetUser.name || 'Trader'},\n\nCongratulations! Your KYC identity verification has been reviewed and approved by our Compliance Desk.\n\nYour live trading account is now fully unlocked. You can access your trading dashboard at https://mainstreetcapitalx.com/dashboard.`
          : `Hello ${targetUser.name || 'Trader'},\n\nYour recent KYC document submission could not be approved. Reason: ${rejection_reason || 'Please submit clear, unobstructed identification photos.'}\n\nPlease sign in at https://mainstreetcapitalx.com/onboarding/kyc to resubmit your verification documents.`,
        recipientType: 'user'
      }).catch(() => {});
    }
  } catch(ne) {}

  req.session.flash = { success: `KYC Document #${doc.id} marked as ${status} (Trader KYC updated to ${userKycStatus}).` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/markets/save', '/admin/markets/save'], (req, res) => {
  const { id, symbol, name, category, spread, leverage, min_lot, max_lot, is_tradable } = req.body;
  const sym = (symbol || '').trim().toUpperCase();
  const n = (name || sym).trim();
  const cat = category || 'reit';
  const spr = parseFloat(spread) || 0.08;
  const lev = parseInt(leverage) || 20;
  const minL = parseFloat(min_lot) || 0.01;
  const maxL = parseFloat(max_lot) || 50.0;
  const tradable = is_tradable === '1' || is_tradable === 1 ? 1 : 0;

  if (id) {
    db.prepare(`
      UPDATE market_settings 
      SET symbol = ?, name = ?, category = ?, spread = ?, leverage = ?, min_lot = ?, max_lot = ?, is_tradable = ?
      WHERE id = ?
    `).run(sym, n, cat, spr, lev, minL, maxL, tradable, id);
    req.session.flash = { success: `Market instrument '${sym}' updated successfully.` };
  } else {
    const exists = db.prepare('SELECT id FROM market_settings WHERE symbol = ?').get(sym);
    if (exists) {
      db.prepare(`
        UPDATE market_settings 
        SET name = ?, category = ?, spread = ?, leverage = ?, min_lot = ?, max_lot = ?, is_tradable = ?
        WHERE id = ?
      `).run(n, cat, spr, lev, minL, maxL, tradable, exists.id);
      req.session.flash = { success: `Market instrument '${sym}' updated.` };
    } else {
      db.prepare(`
        INSERT INTO market_settings (symbol, name, category, spread, leverage, min_lot, max_lot, is_tradable)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sym, n, cat, spr, lev, minL, maxL, tradable);
      req.session.flash = { success: `New instrument '${sym}' added to market desk.` };
    }
  }
  res.redirect('/babyoku');
});

router.get(['/babyoku/export/:type', '/admin/export/:type'], (req, res) => {
  const type = req.params.type;
  let filename = `mainstreet_${type}_${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  if (type === 'users') {
    const data = db.prepare('SELECT * FROM users').all();
    let csv = 'ID,Name,Email,Currency,Role,Balance,Equity,IsActive,TradeMode,CreatedAt\n';
    data.forEach(r => {
      csv += `"${r.id}","${r.name || ''}","${r.email || ''}","${r.currency || 'USD'}","${r.role || 'user'}",${r.balance || 0},${r.equity || 0},${r.is_active || 1},"${r.trade_mode || 'normal'}","${r.created_at || ''}"\n`;
    });
    return res.send(csv);
  } else if (type === 'trades') {
    const data = db.prepare('SELECT * FROM trades').all();
    let csv = 'ID,UserID,Symbol,Type,Lots,OpenPrice,CurrentPrice,ProfitLoss,Status,OpenedAt\n';
    data.forEach(r => {
      csv += `"${r.id}",${r.user_id},"${r.symbol}","${r.type}",${r.lot_size},${r.open_price},${r.current_price},${r.profit_loss},"${r.status}","${r.opened_at || ''}"\n`;
    });
    return res.send(csv);
  } else {
    const data = db.prepare('SELECT * FROM transactions').all();
    let csv = 'ID,UserID,Type,Amount,Currency,Method,Reference,Status,CreatedAt\n';
    data.forEach(r => {
      csv += `"${r.id}",${r.user_id},"${r.type}",${r.amount},"${r.currency}","${r.method}","${r.reference}","${r.status}","${r.created_at || ''}"\n`;
    });
    return res.send(csv);
  }
});

router.post(['/babyoku/transaction/create', '/admin/transaction/create'], (req, res) => {
  const { user_id, type, amount, method, description } = req.body;
  const numAmount = Math.abs(parseFloat(amount) || 0);

  if (!user_id || numAmount <= 0) {
    req.session.flash = { error: 'Invalid user or amount for transaction creation.' };
    return res.redirect('/babyoku');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) {
    req.session.flash = { error: 'Target user not found.' };
    return res.redirect('/babyoku');
  }

  const ref = 'TXE-MAN-' + user.id + '-' + Date.now();
  const txType = type || 'deposit';
  const finalDesc = description || ('Manual ' + txType + ' by Administration');

  // Insert transaction
  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
    VALUES (?, ?, ?, 'USD', 'completed', ?, ?, ?)
  `).run(user.id, txType, numAmount, method || 'Direct Adjustment', ref, finalDesc);

  // Update user balance and equity
  let newBalance = user.balance;
  let newEquity = user.equity;

  if (txType === 'deposit' || txType === 'bonus') {
    newBalance += numAmount;
    newEquity += numAmount;
  } else if (txType === 'withdrawal' || txType === 'fee') {
    newBalance = Math.max(0, newBalance - numAmount);
    newEquity = Math.max(0, newEquity - numAmount);
  }

  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBalance, newEquity, user.id);

  req.session.flash = { success: `Successfully posted ${txType.toUpperCase()} of $${numAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} for ${user.email} (New Balance: $${newBalance.toLocaleString(undefined, {minimumFractionDigits: 2})})` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/transaction/delete', '/admin/transaction/delete'], (req, res) => {
  const { transaction_id } = req.body;
  if (transaction_id) {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(transaction_id);
    req.session.flash = { success: `Transaction #${transaction_id} deleted successfully.` };
  }
  res.redirect('/babyoku');
});

router.post(['/babyoku/transaction/status', '/admin/transaction/status'], (req, res) => {
  const { transaction_id, status } = req.body;
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transaction_id);
  if (!tx) {
    req.session.flash = { error: 'Transaction not found.' };
    return res.redirect('/babyoku');
  }

  db.prepare('UPDATE transactions SET status = ? WHERE id = ?').run(status, transaction_id);

  // If approving deposit, credit user balance
  if (status === 'completed' && tx.type === 'deposit' && tx.status !== 'completed') {
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(tx.user_id);
    const newBal = user.balance + tx.amount;
    db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newBal, user.id);
  }

  // Notify user of transaction status change
  try {
    const formattedAmt = `${tx.amount.toLocaleString()} ${tx.currency || 'USD'}`;
    const txRef = tx.reference || `#${tx.id}`;
    let notifTitle = 'Transaction Status Updated';
    let notifMsg = `Transaction ${txRef} (${formattedAmt}) status changed to ${status}.`;
    let notifType = 'system';

    if (tx.type === 'deposit') {
      notifType = 'deposit';
      if (status === 'completed') {
        notifTitle = 'Deposit Approved & Credited';
        notifMsg = `Your deposit ${txRef} for $${formattedAmt} has been confirmed and credited to your trading capital.`;
      } else if (status === 'rejected') {
        notifTitle = 'Deposit Declined';
        notifMsg = `Your deposit ${txRef} for $${formattedAmt} was declined by institutional compliance.`;
      }
    } else if (tx.type === 'withdrawal') {
      notifType = 'trade';
      if (status === 'completed') {
        notifTitle = 'Withdrawal Approved & Dispatched';
        notifMsg = `Your withdrawal ${txRef} for $${formattedAmt} has been approved and processed to your receiving account.`;
      } else if (status === 'rejected') {
        notifType = 'security';
        notifTitle = 'Withdrawal Declined';
        notifMsg = `Your withdrawal ${txRef} for $${formattedAmt} was declined. Funds remain in your account equity.`;
      }
    }
    db.prepare('INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)')
      .run(tx.user_id, notifTitle, notifMsg, notifType);
  } catch(e) {
    console.error('Failed to dispatch user transaction notification:', e);
  }

  req.session.flash = { success: `Transaction #${transaction_id} marked as ${status}.` };
  res.redirect('/babyoku');
});

router.post(['/babyoku/mailer/send', '/admin/mailer/send'], async (req, res) => {
  const { recipient_target, custom_email, subject, message } = req.body;
  if (!subject || !message) {
    req.session.flash = { error: 'Subject and message body are required.' };
    return res.redirect('/babyoku');
  }

  let finalRecipients = [];
  let recipientType = 'direct';

  if (recipient_target === 'all') {
    const allUsers = db.prepare('SELECT email FROM users').all();
    finalRecipients = allUsers.map(u => u.email);
    recipientType = 'all';
  } else if (recipient_target === 'custom') {
    if (!custom_email || !custom_email.includes('@')) {
      req.session.flash = { error: 'Please enter a valid recipient email address.' };
      return res.redirect('/babyoku');
    }
    finalRecipients = [custom_email.trim()];
    recipientType = 'custom';
  } else {
    finalRecipients = [recipient_target.trim()];
    recipientType = 'direct';
  }

  try {
    for (const recipient of finalRecipients) {
      await sendEmail({
        to: recipient,
        subject: subject.trim(),
        message: message.trim(),
        recipientType
      });
    }
    req.session.flash = { success: `Email successfully dispatched to ${finalRecipients.length} recipient(s)!` };
  } catch (err) {
    req.session.flash = { error: 'Failed to send emails: ' + err.message };
  }

  res.redirect('/babyoku');
});


router.post(['/babyoku/notifications/send', '/admin/notifications/send'], (req, res) => {
  const { recipient_target, title, message, type } = req.body;
  if (!title || !message) {
    req.session.flash = { error: 'Notification title and message body are required.' };
    return res.redirect('/babyoku');
  }
  const notifType = type || 'system';
  let targetCount = 0;
  if (recipient_target === 'all') {
    const allUsers = db.prepare('SELECT id FROM users').all();
    const insert = db.prepare('INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)');
    for (const u of allUsers) {
      insert.run(u.id, title.trim(), message.trim(), notifType);
    }
    targetCount = allUsers.length;
  } else {
    const userId = parseInt(recipient_target);
    if (userId) {
      db.prepare('INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)').run(userId, title.trim(), message.trim(), notifType);
      targetCount = 1;
    }
  }
  req.session.flash = { success: 'Pop-up notification successfully dispatched to ' + targetCount + ' trader(s)!' };
  res.redirect('/babyoku');
});

router.post(['/babyoku/mailer/smtp', '/admin/mailer/smtp'], (req, res) => {
  const { host, port, user, pass, from_name, from_email, is_active, resend_api_key, provider } = req.body;
  db.prepare(`
    UPDATE smtp_settings 
    SET host = ?, port = ?, user = ?, pass = ?, from_name = ?, from_email = ?, is_active = ?, resend_api_key = ?, provider = ?
    WHERE id = 1
  `).run(
    host || 'gaganyaan.gfireservers.in',
    parseInt(port) || 465,
    user || 'support@mainstreetcapitalx.com',
    pass || '',
    from_name || 'Mainstreet Capital Exchange',
    from_email || 'support@mainstreetcapitalx.com',
    is_active === '1' || is_active === 'on' || is_active === 1 ? 1 : 0,
    (resend_api_key || '').trim(),
    provider || (resend_api_key ? 'resend' : 'smtp')
  );

  req.session.flash = { success: 'Mailer configuration (cPanel Webmail HTTPS, Resend & SMTP) updated successfully.' };
  res.redirect('/babyoku');
});

// ==============================================================================
// 5. ALGORITHMIC P&L & TRADE RESULT GENERATOR
// ==============================================================================
router.post(['/babyoku/pnl-generator/execute', '/admin/pnl-generator/execute'], (req, res) => {
  const { 
    target_type, user_id, master_id, outcome_mode, target_amount, 
    asset_symbol, execution_type, trades_count 
  } = req.body;

  const rawAmount = Math.abs(parseFloat(target_amount) || 500.0);
  const finalFigure = (outcome_mode === 'LOSS') ? -rawAmount : rawAmount;
  const numTrades = Math.max(1, Math.min(10, parseInt(trades_count) || 1));
  const symbol = asset_symbol || 'BTC/USD';

  // Asset base price reference
  let basePrice = 64250.0;
  if (symbol.includes('ETH')) basePrice = 3480.0;
  else if (symbol.includes('XAU') || symbol.includes('Gold')) basePrice = 2385.0;
  else if (symbol.includes('EUR')) basePrice = 1.0850;
  else if (symbol.includes('US30')) basePrice = 39800.0;

  if (target_type === 'user') {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
    if (!user) {
      req.session.flash = { error: 'Target user account not found.' };
      return res.redirect('/babyoku');
    }

    if (execution_type === 'COPY_PORTFOLIO') {
      // Update copy subscriptions for this user
      const subs = db.prepare("SELECT * FROM copy_subscriptions WHERE user_id = ? AND status = 'active'").all(user.id);
      if (subs.length > 0) {
        db.prepare('UPDATE copy_subscriptions SET current_profit = ? WHERE id = ?').run(finalFigure, subs[0].id);
      } else {
        const defaultMaster = db.prepare('SELECT id FROM master_traders LIMIT 1').get();
        if (defaultMaster) {
          db.prepare(`
            INSERT INTO copy_subscriptions (user_id, master_id, allocated_amount, current_profit, status)
            VALUES (?, ?, 2500, ?, 'active')
          `).run(user.id, defaultMaster.id, finalFigure);
        }
      }
      req.session.flash = { success: `Successfully generated ${outcome_mode === 'PROFIT' ? '+$' : '-$'}${rawAmount.toFixed(2)} copy trading result for ${user.name}!` };
      return res.redirect('/babyoku');
    }

    // Distribute figure across numTrades
    const tradePnlSlice = +(finalFigure / numTrades).toFixed(2);
    const isClosed = (execution_type === 'SETTLED_HISTORY');
    const orderDirection = (outcome_mode === 'PROFIT') ? 'BUY' : 'SELL';

    for (let i = 0; i < numTrades; i++) {
      const lot = 0.5 + (i * 0.2);
      const priceDrift = (outcome_mode === 'PROFIT') ? (tradePnlSlice / (lot * 10)) : -(Math.abs(tradePnlSlice) / (lot * 10));
      const entryPrice = +(basePrice - priceDrift).toFixed(2);
      const livePrice = +basePrice.toFixed(2);

      db.prepare(`
        INSERT INTO trades (user_id, symbol, type, lot_size, open_price, current_price, close_price, profit_loss, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        symbol,
        orderDirection,
        lot,
        entryPrice,
        livePrice,
        isClosed ? livePrice : null,
        tradePnlSlice,
        isClosed ? 'CLOSED' : 'OPEN'
      );
    }

    if (isClosed && finalFigure !== 0) {
      const newBal = user.balance + finalFigure;
      db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newBal, user.id);
      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
        VALUES (?, 'trade_pnl', ?, 'USD', 'completed', 'P&L Generator', ?, ?)
      `).run(user.id, finalFigure, 'GEN-PNL-' + Date.now(), `Algorithmic Result Generator: ${outcome_mode} of $${rawAmount.toFixed(2)} (${numTrades} trades)`);
    }

    req.session.flash = { 
      success: `Generated ${numTrades} matching trade(s) for ${user.name} totaling exact ${outcome_mode === 'PROFIT' ? '+$' : '-$'}${rawAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} in ${execution_type === 'SETTLED_HISTORY' ? 'settled cash' : 'live floating P&L'}!` 
    };
  } else if (target_type === 'master_strategy') {
    const master = db.prepare('SELECT * FROM master_traders WHERE id = ?').get(master_id);
    if (!master) {
      req.session.flash = { error: 'Master Trader strategy not found.' };
      return res.redirect('/babyoku');
    }

    const tradePnlSlice = +(finalFigure / numTrades).toFixed(2);
    const orderDirection = (outcome_mode === 'PROFIT') ? 'BUY' : 'SELL';

    for (let i = 0; i < numTrades; i++) {
      const lot = 1.0 + (i * 0.5);
      const entryPrice = +(basePrice * 0.98).toFixed(2);
      const livePrice = +basePrice.toFixed(2);

      db.prepare(`
        INSERT INTO master_trades (master_id, symbol, type, lot_size, open_price, current_price, close_price, profit_loss, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
      `).run(
        master.id,
        symbol,
        orderDirection,
        lot,
        entryPrice,
        livePrice,
        livePrice,
        tradePnlSlice
      );
    }

    // Distribute to all active copiers of this master
    const subs = db.prepare("SELECT * FROM copy_subscriptions WHERE master_id = ? AND status = 'active'").all(master.id);
    if (subs.length > 0) {
      const updateSubStmt = db.prepare('UPDATE copy_subscriptions SET current_profit = current_profit + ? WHERE id = ?');
      subs.forEach(sub => {
        updateSubStmt.run(finalFigure, sub.id);
      });
    }

    req.session.flash = { 
      success: `Generated ${numTrades} strategy trade(s) for ${master.name} with exact ${outcome_mode === 'PROFIT' ? '+$' : '-$'}${rawAmount.toLocaleString()} P&L replicated to ${subs.length} copier(s)!` 
    };
  } else {
    // All Users
    const allUsers = db.prepare("SELECT * FROM users WHERE role = 'user'").all();
    const isClosed = (execution_type === 'SETTLED_HISTORY');
    const orderDirection = (outcome_mode === 'PROFIT') ? 'BUY' : 'SELL';

    allUsers.forEach(u => {
      db.prepare(`
        INSERT INTO trades (user_id, symbol, type, lot_size, open_price, current_price, close_price, profit_loss, status)
        VALUES (?, ?, ?, 1.0, ?, ?, ?, ?, ?)
      `).run(
        u.id,
        symbol,
        orderDirection,
        basePrice * 0.98,
        basePrice,
        isClosed ? basePrice : null,
        finalFigure,
        isClosed ? 'CLOSED' : 'OPEN'
      );

      if (isClosed) {
        const newBal = u.balance + finalFigure;
        db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newBal, u.id);
      }
    });

    req.session.flash = { 
      success: `Mass generated ${outcome_mode === 'PROFIT' ? '+$' : '-$'}${rawAmount.toLocaleString()} matching results across all ${allUsers.length} trading accounts!` 
    };
  }

  res.redirect('/babyoku');
});

// ==============================================================================
// 6. ADMIN SYSTEM SETTINGS ENDPOINTS
// ==============================================================================

// Direct GET /admin/settings route
router.get(['/babyoku/settings', '/admin/settings'], (req, res) => {
  res.redirect('/babyoku#settings');
});

// Update Platform Branding & Contact Settings
router.post(['/babyoku/settings/general', '/admin/settings/general'], (req, res) => {
  const { site_name, site_title, support_email, support_phone, office_address, primary_currency, maintenance_mode } = req.body;

  db.prepare(`
    UPDATE system_settings 
    SET site_name = ?, site_title = ?, support_email = ?, support_phone = ?, office_address = ?, primary_currency = ?, maintenance_mode = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    site_name.trim(),
    site_title.trim(),
    support_email.trim(),
    support_phone.trim(),
    office_address.trim(),
    primary_currency || 'USD',
    maintenance_mode === '1' ? 1 : 0
  );

  req.session.flash = { success: 'Platform branding & contact information updated successfully!' };
  res.redirect('/babyoku');
});

// Update Trading Engine & Risk Settings
router.post(['/babyoku/settings/trading', '/admin/settings/trading'], (req, res) => {
  const { default_leverage, default_welcome_bonus, margin_call_level, stop_out_level, copy_profit_interval } = req.body;
  const parsedBonus = parseFloat(default_welcome_bonus);

  db.prepare(`
    UPDATE system_settings 
    SET default_leverage = ?, default_welcome_bonus = ?, margin_call_level = ?, stop_out_level = ?, copy_profit_interval = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    parseInt(default_leverage) || 100,
    Number.isFinite(parsedBonus) ? parsedBonus : 0.00,
    parseFloat(margin_call_level) || 50.0,
    parseFloat(stop_out_level) || 20.0,
    parseInt(copy_profit_interval) || 45
  );

  req.session.flash = { success: 'Trading engine & risk policy settings saved!' };
  res.redirect('/babyoku');
});

// Update Financial & Treasury Settings
router.post(['/babyoku/settings/financial', '/admin/settings/financial'], (req, res) => {
  const { min_deposit, min_withdrawal, max_withdrawal, auto_credit_deposit, crypto_verification_mode } = req.body;

  db.prepare(`
    UPDATE system_settings 
    SET min_deposit = ?, min_withdrawal = ?, max_withdrawal = ?, auto_credit_deposit = ?, crypto_verification_mode = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    parseFloat(min_deposit) || 50.00,
    parseFloat(min_withdrawal) || 100.00,
    parseFloat(max_withdrawal) || 50000.00,
    auto_credit_deposit === '1' ? 1 : 0,
    crypto_verification_mode || 'live_blockchain'
  );

  req.session.flash = { success: 'Financial & treasury parameters saved successfully!' };
  res.redirect('/babyoku');
});

// Update Administrator Master Credentials & Password
router.post(['/babyoku/settings/security', '/admin/settings/security'], (req, res) => {
  const { admin_email, current_password, new_password, admin_2fa_required } = req.body;
  const currentAdmin = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!currentAdmin) {
    req.session.flash = { error: 'Administrator account not found.' };
    return res.redirect('/babyoku');
  }

  // If changing password, verify current
  if (new_password) {
    if (!bcrypt.compareSync(current_password, currentAdmin.password)) {
      req.session.flash = { error: 'Current administrator password is incorrect.' };
      return res.redirect('/babyoku');
    }
    if (new_password.length < 6) {
      req.session.flash = { error: 'New password must be at least 6 characters.' };
      return res.redirect('/babyoku');
    }
    const newHash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, currentAdmin.id);
  }

  if (admin_email && admin_email !== currentAdmin.email) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(admin_email.trim(), currentAdmin.id);
  }

  db.prepare('UPDATE system_settings SET admin_2fa_required = ? WHERE id = 1').run(admin_2fa_required === '1' ? 1 : 0);

  req.session.flash = { success: 'Admin security settings and credentials updated successfully!' };
  res.redirect('/babyoku');
});

// Update Institutional KYC Protocol Configuration
router.post(['/babyoku/settings/kyc-policy', '/babyoku/settings/didit', '/admin/settings/kyc-policy', '/admin/settings/didit'], (req, res) => {
  const autoApprove = (req.body.auto_approve_kyc === '1' || req.body.didit_auto_approve === '1') ? 1 : 0;
  
  db.prepare(`
    UPDATE system_settings
    SET auto_approve_kyc = ?, didit_auto_approve = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(autoApprove, autoApprove);

  req.session.flash = { success: 'Institutional KYC policy settings updated successfully!' };
  res.redirect('/babyoku');
});

// Send Live Test Email from Admin Settings
router.post(['/babyoku/settings/test-email', '/admin/settings/test-email'], async (req, res) => {
  const { test_recipient } = req.body;
  if (!test_recipient || !test_recipient.includes('@')) {
    req.session.flash = { error: 'Please provide a valid test recipient email address.' };
    return res.redirect('/babyoku');
  }

  const result = await sendEmail({
    to: test_recipient.trim(),
    subject: 'Mainstreet Capital Exchange SMTP Server Test Diagnostic',
    message: `<div style="font-family: sans-serif; padding: 20px; background: #0f131a; color: #fff; border-radius: 12px;">
      <h2 style="color: #d4a038;">Mainstreet Capital Exchange SMTP Server Diagnostic</h2>
      <p>This is an automated test confirming that your live SMTP server dispatch engine is operational.</p>
      <p style="color: #10b981; font-weight: bold;">Status: 200 OK (Connection Verified)</p>
      <p style="color: #888; font-size: 11px;">Timestamp: ${new Date().toUTCString()}</p>
    </div>`,
    recipientType: 'diagnostic'
  });

  if (result.success) {
    if (result.localOnly) {
      req.session.flash = { success: `Diagnostic logged locally in sandbox for ${test_recipient}. (Configure cPanel SMTP or Resend API Key above to dispatch to live inbox).` };
    } else {
      const providerLabel = result.provider === 'webmail-https'
        ? 'cPanel Webmail HTTPS Relay (Port 2096)'
        : (result.provider === 'resend' ? 'Resend Cloud API' : 'SMTP');
      req.session.flash = { success: `Live test email successfully dispatched to ${test_recipient} via ${providerLabel}!` };
    }
  } else {
    req.session.flash = { error: `Dispatch Failed: ${result.error}` };
  }

  res.redirect('/babyoku');
});

// 1-Click SQLite Database Backup Download
router.get(['/babyoku/settings/backup-db', '/admin/settings/backup-db'], (req, res) => {
  const dbFile = path.resolve(__dirname, '../../data/tradexedge.db');
  if (fs.existsSync(dbFile)) {
    const filename = `mainstreet_capital_exchange_backup_${Date.now()}.db`;
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(dbFile);
    stream.pipe(res);
  } else {
    req.session.flash = { error: 'Database file not found.' };
    res.redirect('/babyoku');
  }
});

// Admin Live Chat API
router.get('/api/admin/chat/conversations', requireAdmin, (req, res) => {
  const threads = db.prepare(`
    SELECT scm.user_id, 
           COALESCE(u.name, 'Guest #' || ABS(scm.user_id)) as user_name,
           COALESCE(u.email, 'Direct Live Visitor') as user_email,
           COUNT(CASE WHEN scm.sender_role = 'user' AND scm.is_read = 0 THEN 1 END) as unread_count,
           MAX(scm.created_at) as last_message_at,
           (SELECT message FROM support_chat_messages WHERE user_id = scm.user_id ORDER BY id DESC LIMIT 1) as last_message
    FROM support_chat_messages scm
    LEFT JOIN users u ON scm.user_id = u.id
    GROUP BY scm.user_id
    ORDER BY unread_count DESC, last_message_at DESC
  `).all();
  res.json({ conversations: threads });
});

router.get('/api/admin/chat/messages/:userId', requireAdmin, (req, res) => {
  const uid = req.params.userId;
  // Mark user messages as read by admin
  db.prepare("UPDATE support_chat_messages SET is_read = 1 WHERE user_id = ? AND sender_role = 'user'").run(uid);
  const messages = db.prepare('SELECT * FROM support_chat_messages WHERE user_id = ? ORDER BY id ASC').all(uid);
  res.json({ messages });
});

router.post('/api/admin/chat/reply', requireAdmin, (req, res) => {
  const { user_id, message } = req.body;
  if (!user_id || !message || !message.trim()) return res.json({ success: false });

  db.prepare('INSERT INTO support_chat_messages (user_id, sender_role, message) VALUES (?, ?, ?)')
    .run(user_id, 'admin', message.trim());

  res.json({ success: true });
});

// Set Specific Crypto Asset Balance for User
router.post(['/babyoku/user/set-crypto-balance', '/admin/user/set-crypto-balance'], (req, res) => {
  const { user_id, asset_symbol, exact_balance } = req.body;
  const bal = parseFloat(exact_balance);

  if (!user_id || !asset_symbol || isNaN(bal)) {
    req.session.flash = { error: 'Invalid crypto balance values provided.' };
    return res.redirect('/babyoku');
  }

  db.prepare(`
    UPDATE user_crypto_balances 
    SET balance = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE user_id = ? AND asset_symbol = ?
  `).run(bal, user_id, asset_symbol);

  req.session.flash = { success: `Updated ${asset_symbol} balance to ${bal} for User #${user_id}!` };
  res.redirect('/babyoku');
});

// Get User Crypto Balances as JSON for modal prefill
router.get(['/babyoku/user/crypto-balances/:userId', '/admin/user/crypto-balances/:userId'], requireAdmin, (req, res) => {
  const userId = req.params.userId;
  const user = db.prepare('SELECT id, name, email, balance, equity FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const cryptoBalances = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ?').all(userId);
  const balancesObj = {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    cashBalance: Number(user.balance || 0),
    equity: Number(user.equity || user.balance || 0),
    btc: 0,
    eth: 0,
    usdt: 0,
    sol: 0,
    bnb: 0,
    xrp: 0,
    ada: 0,
    doge: 0,
    avax: 0,
    link: 0,
    sui: 0,
    ton: 0,
    pepe: 0
  };

  cryptoBalances.forEach(cb => {
    const sym = cb.asset_symbol.toLowerCase();
    if (balancesObj[sym] !== undefined) {
      balancesObj[sym] = Number(cb.balance || 0);
    }
  });

  res.json({ success: true, balances: balancesObj });
});

// Set Multi-Asset Balances (Cash + Crypto simultaneously)
router.post(['/babyoku/user/set-multi-balances', '/admin/user/set-multi-balances'], requireAdmin, (req, res) => {
  const { 
    user_id, 
    cash_balance, 
    btc_balance, 
    eth_balance, 
    usdt_balance, 
    sol_balance, 
    bnb_balance, 
    xrp_balance 
  } = req.body;

  const targetUser = db.prepare('SELECT id, name, balance FROM users WHERE id = ?').get(user_id);
  if (!targetUser) return res.status(404).send('User not found');

  const cash = parseFloat(req.body.cash_balance !== undefined ? req.body.cash_balance : req.body.cash) || 0;
  const btc = parseFloat(req.body.btc_balance !== undefined ? req.body.btc_balance : req.body.btc) || 0;
  const eth = parseFloat(req.body.eth_balance !== undefined ? req.body.eth_balance : req.body.eth) || 0;
  const usdt = parseFloat(req.body.usdt_balance !== undefined ? req.body.usdt_balance : req.body.usdt) || 0;
  const sol = parseFloat(req.body.sol_balance !== undefined ? req.body.sol_balance : req.body.sol) || 0;
  const bnb = parseFloat(req.body.bnb_balance !== undefined ? req.body.bnb_balance : req.body.bnb) || 0;
  const xrp = parseFloat(req.body.xrp_balance !== undefined ? req.body.xrp_balance : req.body.xrp) || 0;

  // 1. Update Cash Balance & Base Equity in users table
  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(cash, cash, user_id);

  // 2. Helper to upsert crypto asset balance
  const upsertAsset = (symbol, name, balance, icon, rate) => {
    db.prepare(`
      INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, asset_symbol) DO UPDATE SET 
        balance = excluded.balance,
        icon = excluded.icon,
        rate_usd = excluded.rate_usd,
        updated_at = CURRENT_TIMESTAMP
    `).run(user_id, symbol, name, balance, icon, rate);
  };

  upsertAsset('BTC', 'Bitcoin', btc, '₿', 64800.00);
  upsertAsset('ETH', 'Ethereum', eth, 'Ξ', 3540.00);
  upsertAsset('USDT', 'Tether USD', usdt, '₮', 1.00);
  upsertAsset('SOL', 'Solana', sol, '☀️', 148.50);
  upsertAsset('BNB', 'BNB Chain', bnb, '🟡', 582.00);
  upsertAsset('XRP', 'Ripple', xrp, '✕', 0.58);

  // 3. Log action
  db.prepare(`
    INSERT INTO activity_logs (user_id, action, ip_address, details)
    VALUES (?, 'ADMIN_SET_MULTI_BALANCES', ?, ?)
  `).run(
    user_id, 
    req.ip, 
    `Configured balances: Cash: $${cash}, BTC: ${btc}, ETH: ${eth}, USDT: ${usdt}, SOL: ${sol}, BNB: ${bnb}, XRP: ${xrp}`
  );

  console.log(`[Admin Balance Engine] Updated multi-balances for User #${user_id} (${targetUser.name}): Cash $${cash}, BTC ${btc}, ETH ${eth}, USDT ${usdt}`);
  res.redirect('/babyoku');
});


// ==============================================================================
// 10. RETIREMENT & CUSTODIAL VAULT ADMINISTRATION (Babyoku Portal)
// ==============================================================================

// POST /babyoku/retirement/adjust-balance (Credit/Debit/Rollover Retirement Account)
router.post(['/babyoku/retirement/adjust-balance', '/admin/retirement/adjust-balance', '/api/admin/retirement/adjust-balance'], (req, res) => {
  try {
    const { account_id, amount, action_type, notes } = req.body;
    const numAmount = parseFloat(amount);

    if (!account_id || isNaN(numAmount) || numAmount <= 0) {
      req.session.flash = { error: 'Please specify a valid retirement account and positive amount.' };
      return res.redirect('/babyoku#retirement-tab');
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE id = ?').get(account_id);
    if (!account) {
      req.session.flash = { error: 'Retirement account not found.' };
      return res.redirect('/babyoku#retirement-tab');
    }

    if (action_type === 'debit' && account.balance < numAmount) {
      req.session.flash = { error: `Cannot debit $${numAmount}. Available balance is only $${account.balance}.` };
      return res.redirect('/babyoku#retirement-tab');
    }

    if (action_type === 'credit' || action_type === 'rollover_grant') {
      db.prepare(`
        UPDATE retirement_accounts 
        SET balance = balance + ?, equity = equity + ?, total_contributed = total_contributed + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(numAmount, numAmount, numAmount, account_id);

      db.prepare(`
        INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
        VALUES (?, ?, ?, ?, 2026, ?)
      `).run(account_id, account.user_id, numAmount, action_type === 'rollover_grant' ? 'rollover_transfer' : 'admin_credit', notes || `Admin adjustment (${action_type})`);
    } else {
      // Debit
      db.prepare(`
        UPDATE retirement_accounts 
        SET balance = balance - ?, equity = equity - ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(numAmount, numAmount, account_id);

      db.prepare(`
        INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
        VALUES (?, ?, ?, 'admin_debit', 2026, ?)
      `).run(account_id, account.user_id, -numAmount, notes || 'Admin debit adjustment');
    }

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, message: `Successfully executed ${action_type} of $${numAmount} for account ${account.account_number}.` });
    }

    req.session.flash = { success: `Successfully executed ${action_type} of $${numAmount.toLocaleString()} on ${account.account_number}.` };
    res.redirect('/babyoku#retirement-tab');
  } catch (err) {
    console.error('Error adjusting retirement balance:', err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, error: 'Database error adjusting retirement account.' });
    }
    req.session.flash = { error: 'Failed to adjust retirement balance.' };
    res.redirect('/babyoku#retirement-tab');
  }
});

// POST /babyoku/retirement/trigger-drip & /distribute-dividend (Execute DRIP & Custom Dividend Figures)
router.post([
  '/babyoku/retirement/trigger-drip', 
  '/admin/retirement/trigger-drip', 
  '/api/admin/retirement/trigger-drip',
  '/babyoku/retirement/distribute-dividend',
  '/admin/retirement/distribute-dividend',
  '/api/admin/retirement/distribute-dividend'
], (req, res) => {
  try {
    const {
      target_account_id,
      account_id,
      custom_amount,
      custom_yield_percent,
      distribution_mode,
      mode,
      target_holding_id,
      tax_year,
      notes
    } = req.body;

    const chosenAccountId = (target_account_id && target_account_id !== 'all') ? target_account_id : (account_id || null);
    const chosenMode = distribution_mode || mode || 'auto';

    const results = distributeQuarterlyDividends({
      targetAccountId: chosenAccountId,
      customAmount: custom_amount,
      customYieldPercent: custom_yield_percent,
      mode: chosenMode,
      targetHoldingId: target_holding_id,
      taxYear: tax_year,
      notes: notes
    });

    const totalAccountsProcessed = results.length;
    const totalDividendsDistributed = results.reduce((s, r) => s + (r.totalDividends || 0), 0);

    let msg;
    if (chosenAccountId && results.length > 0) {
      msg = `Custom dividend successfully distributed to Account #${results[0].accountNumber}: $${totalDividendsDistributed.toFixed(2)} USD (${results[0].actions.length} allocation actions executed).`;
    } else {
      msg = `System-wide DRIP cycle executed across ${totalAccountsProcessed} accounts. Total dividends distributed & reinvested: $${totalDividendsDistributed.toFixed(2)} USD.`;
    }

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, message: msg, results, totalDividendsDistributed });
    }

    req.session.flash = { success: msg };
    res.redirect('/babyoku#retirement-tab');
  } catch (err) {
    console.error('Error running dividend distribution / DRIP cycle:', err);
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, error: 'Failed to execute dividend distribution cycle.' });
    }
    req.session.flash = { error: 'Failed to execute dividend distribution cycle.' };
    res.redirect('/babyoku#retirement-tab');
  }
});

// POST /babyoku/retirement/update-account (Update status, annual limit, drip mode)
router.post(['/babyoku/retirement/update-account', '/admin/retirement/update-account', '/api/admin/retirement/update-account'], (req, res) => {
  try {
    const { account_id, account_type, status, annual_limit, drip_enabled } = req.body;
    if (!account_id) {
      return res.status(400).json({ success: false, error: 'Account ID required' });
    }

    db.prepare(`
      UPDATE retirement_accounts 
      SET account_type = COALESCE(?, account_type),
          status = COALESCE(?, status),
          annual_limit = COALESCE(?, annual_limit),
          drip_enabled = COALESCE(?, drip_enabled),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(account_type || null, status || null, annual_limit ? parseFloat(annual_limit) : null, drip_enabled !== undefined ? parseInt(drip_enabled) : null, account_id);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, message: 'Retirement account settings updated successfully.' });
    }

    req.session.flash = { success: 'Retirement account updated successfully.' };
    res.redirect('/babyoku#retirement-tab');
  } catch (err) {
    console.error('Error updating retirement account:', err);
    res.status(500).json({ success: false, error: 'Failed to update retirement account.' });
  }
});

module.exports = router;
