const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { distributeQuarterlyDividends } = require('../services/dripService');
const { STOCK_BASKETS } = require('../services/stockBasketService');


// Live spot price quotes reference
const spotPrices = {
  'AAPL': 224.20,
  'MSFT': 418.50,
  'NVDA': 128.50,
  'TSLA': 218.40,
  'AMZN': 178.60,
  'GOOGL': 164.80,
  'META': 512.30,
  'PLTR': 31.80,
  'AMD': 152.40,
  'NFLX': 684.20,
  'AVGO': 176.80,
  'ORCL': 168.40,
  'CRM': 288.50,
  'INTC': 24.60,
  'QCOM': 172.30,
  'ARM': 144.80,
  'MU': 108.40,
  'TSM': 168.40,
  'ASML': 842.50,
  'JPM': 214.50,
  'V': 268.90,
  'MA': 492.40,
  'BRK.B': 448.20,
  'BAC': 41.80,
  'GS': 512.60,
  'MS': 114.20,
  'WMT': 80.40,
  'COST': 892.30,
  'HD': 394.50,
  'KO': 69.80,
  'PEP': 172.40,
  'PG': 174.20,
  'MCD': 298.60,
  'NKE': 82.40,
  'DIS': 92.40,
  'UBER': 72.80,
  'BABA': 82.50,
  'LLY': 942.50,
  'JNJ': 162.80,
  'UNH': 584.20,
  'ABBV': 194.60,
  'MRK': 114.80,
  'PFE': 28.90,
  'ISRG': 486.40,
  'VRTX': 472.80,
  'REGN': 998.50,
  'XOM': 121.40,
  'CVX': 152.80,
  'NEE': 84.20,
  'ENPH': 96.40,
  'FSLR': 218.60,
  'CAT': 384.20,
  'BA': 156.40,
  'LMT': 586.40,
  'GE': 188.60,
  'BTC': 68650.00,
  'ETH': 3645.00,
  'SOL': 156.20
};

// GET /retirement (Public Showcase & Interactive Nest-Egg Calculator)
router.get('/retirement', (req, res) => {
  res.render('public/retirement', {
    title: 'Institutional Retirement Accounts (IRAs & 401k) | Mainstreet Capital Exchange',
    user: res.locals.user || null
  });
});

// GET /api/retirement/account (Fetch active user's retirement portfolio)
router.get('/api/retirement/account', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    let account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);

    if (!account) {
      // Auto-provision if none exists
      const accNum = 'IRA-' + (80000 + Number(userId)) + '-' + Math.floor(1000 + Math.random() * 9000);
      db.prepare(`
        INSERT INTO retirement_accounts (user_id, account_type, account_number, balance, equity, total_contributed, annual_limit, drip_enabled, status)
        VALUES (?, 'roth_ira', ?, 0.00, 0.00, 0.00, 7000.00, 1, 'active')
      `).run(userId, accNum);
      account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    }

    const contributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY created_at DESC').all(account.id);
    const rawHoldings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);

    // Calculate live valuations
    let totalHoldingsValuation = 0;
    const holdings = rawHoldings.map(h => {
      const liveRate = spotPrices[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      const marketVal = Number((h.shares_or_units * liveRate).toFixed(2));
      const pnlDollar = Number((marketVal - h.cost_basis).toFixed(2));
      const pnlPercent = h.cost_basis > 0 ? Number(((pnlDollar / h.cost_basis) * 100).toFixed(2)) : 0;
      totalHoldingsValuation += marketVal;

      return {
        ...h,
        liveRate,
        marketVal,
        pnlDollar,
        pnlPercent
      };
    });

    const totalEquity = Number((account.balance + totalHoldingsValuation).toFixed(2));

    // Update equity in DB
    db.prepare('UPDATE retirement_accounts SET equity = ? WHERE id = ?').run(totalEquity, account.id);

    res.json({
      success: true,
      account: {
        ...account,
        equity: totalEquity
      },
      holdings,
      contributions,
      spotPrices
    });
  } catch (err) {
    console.error('Error fetching retirement account:', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve retirement portfolio.' });
  }
});

// POST /api/retirement/open (Open a new retirement account)
router.post('/api/retirement/open', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { account_type, beneficiary_name } = req.body;

    const allowedTypes = ['roth_ira', 'traditional_ira', 'sep_ira', 'rollover_401k'];
    const type = allowedTypes.includes(account_type) ? account_type : 'roth_ira';

    const accNum = 'IRA-' + (80000 + Number(userId)) + '-' + Math.floor(1000 + Math.random() * 9000);
    const annualLimit = (type === 'sep_ira') ? 69000.00 : 7000.00;

    const result = db.prepare(`
      INSERT INTO retirement_accounts (user_id, account_type, account_number, balance, equity, total_contributed, annual_limit, drip_enabled, beneficiary_name, status)
      VALUES (?, ?, ?, 0.00, 0.00, 0.00, ?, 1, ?, 'active')
    `).run(userId, type, accNum, annualLimit, beneficiary_name || null);

    res.json({
      success: true,
      accountId: result.lastInsertRowid,
      accountNumber: accNum,
      message: `Successfully opened your ${type.replace('_', ' ').toUpperCase()} Account (#${accNum}).`
    });
  } catch (err) {
    console.error('Error opening retirement account:', err);
    res.status(500).json({ success: false, error: 'Failed to create retirement account.' });
  }
});

// POST /api/retirement/contribute (Contribute funds from main USD balance into IRA)
router.post('/api/retirement/contribute', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { amount, source_type } = req.body;
    const contributeAmount = parseFloat(amount);

    if (isNaN(contributeAmount) || contributeAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please specify a valid contribution amount.' });
    }

    const executeContribution = db.transaction(() => {
      const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
      if (!account) {
        throw new Error('Retirement account not found.');
      }

      // Check IRS Annual Contribution Cap
      const remainingLimit = account.annual_limit - account.total_contributed;
      if (contributeAmount > remainingLimit) {
        throw new Error(`Contribution of $${contributeAmount.toLocaleString()} exceeds your remaining 2026 tax-year limit ($${remainingLimit.toLocaleString()}).`);
      }

      // Check main balance
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      if (!user || user.balance < contributeAmount) {
        throw new Error(`Insufficient available cash ($${user ? user.balance.toFixed(2) : 0} USD). Please fund your trading balance first.`);
      }

      // Execute atomic transfer
      db.prepare('UPDATE users SET balance = balance - ?, equity = equity - ? WHERE id = ?').run(contributeAmount, contributeAmount, userId);
      db.prepare('UPDATE retirement_accounts SET balance = balance + ?, equity = equity + ?, total_contributed = total_contributed + ? WHERE id = ?').run(contributeAmount, contributeAmount, contributeAmount, account.id);

      // Record contribution ledger
      db.prepare(`
        INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
        VALUES (?, ?, ?, ?, 2026, 'Annual IRA Contribution')
      `).run(account.id, userId, contributeAmount, source_type || 'cash_balance');

      // Record user transaction
      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
        VALUES (?, 'transfer', ?, 'USD', 'completed', 'Internal Transfer', ?, ?)
      `).run(userId, contributeAmount, 'TXE-IRA-' + Date.now(), `Contribution to Retirement Account #${account.account_number}`);

      return {
        accountNumber: account.account_number,
        newRetirementBalance: account.balance + contributeAmount,
        newTotalContributed: account.total_contributed + contributeAmount
      };
    });

    const result = executeContribution();

    res.json({
      success: true,
      message: `Successfully contributed $${contributeAmount.toLocaleString()} USD to your Retirement Account (#${result.accountNumber}).`,
      newRetirementBalance: result.newRetirementBalance,
      newTotalContributed: result.newTotalContributed
    });
  } catch (err) {
    console.error('Error contributing to retirement:', err.message);
    res.status(400).json({ success: false, error: err.message || 'Internal error processing retirement contribution.' });
  }
});

// POST /api/retirement/transfer (Bi-directional Subaccount Internal Transfer)
router.post('/api/retirement/transfer', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { direction, amount } = req.body;
    const transferAmount = parseFloat(amount);

    if (isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid transfer amount.' });
    }

    const executeTransfer = db.transaction(() => {
      let account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
      if (!account) {
        const accNum = 'IRA-' + (80000 + Number(userId)) + '-' + Math.floor(1000 + Math.random() * 9000);
        db.prepare(`
          INSERT INTO retirement_accounts (user_id, account_type, account_number, balance, equity, total_contributed, annual_limit, drip_enabled, status)
          VALUES (?, 'roth_ira', ?, 0.00, 0.00, 0.00, 7000.00, 1, 'active')
        `).run(userId, accNum);
        account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
      }

      const user = db.prepare('SELECT balance, equity FROM users WHERE id = ?').get(userId);
      if (!user) throw new Error('User record not found.');

      if (direction === 'retirement_to_primary') {
        if (account.balance < transferAmount) {
          throw new Error('Insufficient unallocated retirement cash (
router.post('/api/retirement/invest', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { asset_symbol, asset_name, asset_type, amount, icon } = req.body;
    const investAmount = parseFloat(amount);

    if (isNaN(investAmount) || investAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid allocation amount.' });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account || account.balance < investAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient unallocated retirement cash ($${account ? account.balance.toFixed(2) : 0} USD). Please contribute funds first.`
      });
    }

    const price = spotPrices[asset_symbol] || 100.0;
    const units = investAmount / price;

    // Deduct retirement cash
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(investAmount, account.id);

    // Insert or update holding
    const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, asset_symbol);
    if (existingHolding) {
      db.prepare(`
        UPDATE retirement_holdings 
        SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(units, investAmount, existingHolding.id);
    } else {
      db.prepare(`
        INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(account.id, asset_symbol, asset_name || asset_symbol, asset_type || 'stock', units, investAmount, icon || '📈');
    }

    res.json({
      success: true,
      message: `Successfully allocated $${investAmount.toLocaleString()} USD into ${asset_name || asset_symbol} for your Retirement Account.`
    });
  } catch (err) {
    console.error('Error allocating retirement capital:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate retirement investment.' });
  }
});

// POST /api/retirement/toggle-drip (Toggle Dividend Reinvestment Program)
router.post('/api/retirement/toggle-drip', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const newStatus = account.drip_enabled ? 0 : 1;
    db.prepare('UPDATE retirement_accounts SET drip_enabled = ? WHERE id = ?').run(newStatus, account.id);

    res.json({
      success: true,
      drip_enabled: newStatus,
      message: newStatus ? 'Dividend Reinvestment (DRIP) activated: all payouts automatically buy fractional shares.' : 'DRIP deactivated: dividends credited as unallocated cash.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle DRIP setting.' });
  }
});


// POST /api/retirement/invest-basket (Allocate retirement cash into Thematic Baskets)
router.post('/api/retirement/invest-basket', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { basket_id, amount } = req.body;
    const numAmount = parseFloat(amount);

    const basket = STOCK_BASKETS[basket_id];
    if (!basket) {
      return res.status(400).json({ success: false, error: 'Thematic basket not found.' });
    }

    if (isNaN(numAmount) || numAmount < basket.minInvestment) {
      return res.status(400).json({ success: false, error: `Minimum allocation for this basket is $${basket.minInvestment}.` });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Retirement account not found.' });
    }

    if (account.balance < numAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient unallocated retirement cash balance ($${account.balance.toLocaleString()} available). Please contribute funds first.` 
      });
    }

    // Deduct cash balance
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(numAmount, account.id);

    // Allocate across constituent holdings according to their weights
    basket.holdings.forEach(holding => {
      const stockAlloc = Number((numAmount * holding.weight).toFixed(2));
      const stockPrice = spotPrices[holding.symbol] || 150.0;
      const shares = Number((stockAlloc / stockPrice).toFixed(4));

      const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, holding.symbol);
      if (existingHolding) {
        db.prepare(`
          UPDATE retirement_holdings 
          SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shares, stockAlloc, existingHolding.id);
      } else {
        db.prepare(`
          INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
          VALUES (?, ?, ?, 'stock', ?, ?, '🧺')
        `).run(account.id, holding.symbol, holding.name, shares, stockAlloc);
      }
    });

    // Record activity
    db.prepare(`
      INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
      VALUES (?, ?, ?, 'basket_allocation', 2026, ?)
    `).run(account.id, userId, numAmount, `Allocated $${numAmount.toLocaleString()} into ${basket.name} thematic basket`);

    res.json({
      success: true,
      message: `Successfully allocated $${numAmount.toLocaleString()} USD across ${basket.holdings.length} stocks in the ${basket.name} basket.`,
      basketName: basket.name
    });
  } catch (err) {
    console.error('Error allocating retirement basket:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate thematic basket inside retirement account.' });
  }
});

// GET /api/retirement/statement (Generate official Tax-Year 2026 / Form 5498 Custodial Report)
router.get('/api/retirement/statement', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, name, email, country FROM users WHERE id = ?').get(userId);
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const contributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY created_at ASC').all(account.id);
    const holdings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);

    let totalHoldingsValuation = 0;
    const evaluatedHoldings = holdings.map(h => {
      const liveRate = spotPrices[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      const marketVal = Number((h.shares_or_units * liveRate).toFixed(2));
      const unrealizedPnl = Number((marketVal - h.cost_basis).toFixed(2));
      totalHoldingsValuation += marketVal;
      return {
        symbol: h.asset_symbol,
        name: h.asset_name,
        shares: h.shares_or_units,
        costBasis: h.cost_basis,
        marketValue: marketVal,
        unrealizedPnl
      };
    });

    const fmv = Number((account.balance + totalHoldingsValuation).toFixed(2));
    const totalDripReinvested = contributions
      .filter(c => c.source_type === 'drip_reinvest')
      .reduce((sum, c) => sum + c.amount, 0);

    const statement = {
      institution: 'Mainstreet Capital Exchange Prime Custody Ltd',
      regulatoryJurisdiction: 'Institutional Segregated Custodial Depository',
      custodianCode: 'MCE-IRA-SEC-5498',
      statementDate: new Date().toISOString().split('T')[0],
      taxYear: 2026,
      accountInfo: {
        accountNumber: account.account_number,
        accountType: account.account_type.toUpperCase().replace('_', ' '),
        beneficiary: user.name,
        beneficiaryEmail: user.email,
        country: user.country || 'United States',
        status: account.status.toUpperCase(),
        dripActive: Boolean(account.drip_enabled)
      },
      valuationSummary: {
        unallocatedCashBalance: account.balance,
        investedHoldingsFairMarketValue: totalHoldingsValuation,
        totalAccountFairMarketValue: fmv,
        totalLifetimeContributions: account.total_contributed,
        totalDripDividendsReinvested: Number(totalDripReinvested.toFixed(2)),
        annualLimit2026: account.annual_limit,
        remaining2026ContributionRoom: Math.max(0, account.annual_limit - account.total_contributed)
      },
      irsForm5498Simulation: {
        box1_IraContributions: account.total_contributed,
        box2_RolloverContributions: contributions.filter(c => c.source_type === 'rollover_transfer').reduce((s, c) => s + c.amount, 0),
        box3_RothConversion: 0.00,
        box4_RecharacterizedContribs: 0.00,
        box5_FairMarketValueDec31: fmv,
        taxExemptionNotice: 'All earnings and capital gains within this custodial account qualify for 100% tax-free compounding under IRS Section 408A.'
      },
      portfolioHoldings: evaluatedHoldings,
      transactionHistory: contributions
    };

    res.json({ success: true, statement });
  } catch (err) {
    console.error('Error generating retirement statement:', err);
    res.status(500).json({ success: false, error: 'Failed to generate custodial statement.' });
  }
});

// POST /api/retirement/drip/trigger (Admin Only - Trigger quarterly dividend accrual and automated DRIP)
router.post('/api/retirement/drip/trigger', requireAdmin, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const results = distributeQuarterlyDividends(account.id);
    const accountResult = results[0] || {};

    res.json({
      success: true,
      message: `Quarterly dividend cycle executed. Total dividends accrued: $${(accountResult.totalDividends || 0).toFixed(2)} USD.`,
      details: accountResult
    });
  } catch (err) {
    console.error('Error executing DRIP cycle:', err);
    res.status(500).json({ success: false, error: 'Failed to execute dividend cycle.' });
  }
});

// GET /api/retirement/dividends (Fetch dividend accrual history)
router.get('/api/retirement/dividends', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const dividends = db.prepare(`
      SELECT * FROM retirement_contributions 
      WHERE account_id = ? AND source_type IN ('drip_reinvest', 'dividend_cash')
      ORDER BY created_at DESC
    `).all(account.id);

    const totalDividendsAccrued = dividends.reduce((s, d) => s + d.amount, 0);

    res.json({
      success: true,
      dripEnabled: Boolean(account.drip_enabled),
      totalDividendsAccrued: Number(totalDividendsAccrued.toFixed(2)),
      dividends
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch dividend records.' });
  }
});

module.exports = router;
 + account.balance.toFixed(2) + ' USD).');
        }

        db.prepare('UPDATE retirement_accounts SET balance = balance - ?, equity = equity - ? WHERE id = ?').run(transferAmount, transferAmount, account.id);
        db.prepare('UPDATE users SET balance = balance + ?, equity = equity + ? WHERE id = ?').run(transferAmount, transferAmount, userId);

        db.prepare(`
          INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
          VALUES (?, 'transfer', ?, 'USD', 'completed', 'Subaccount Transfer', ?, ?)
        `).run(userId, transferAmount, 'TXE-SUB-' + Date.now(), 'Internal Transfer from Retirement #' + account.account_number + ' to Primary Brokerage');

        return {
          direction: 'retirement_to_primary',
          accountNumber: account.account_number,
          newPrimaryBalance: user.balance + transferAmount,
          newRetirementBalance: account.balance - transferAmount,
          message: 'Transferred 
router.post('/api/retirement/invest', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { asset_symbol, asset_name, asset_type, amount, icon } = req.body;
    const investAmount = parseFloat(amount);

    if (isNaN(investAmount) || investAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid allocation amount.' });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account || account.balance < investAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient unallocated retirement cash ($${account ? account.balance.toFixed(2) : 0} USD). Please contribute funds first.`
      });
    }

    const price = spotPrices[asset_symbol] || 100.0;
    const units = investAmount / price;

    // Deduct retirement cash
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(investAmount, account.id);

    // Insert or update holding
    const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, asset_symbol);
    if (existingHolding) {
      db.prepare(`
        UPDATE retirement_holdings 
        SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(units, investAmount, existingHolding.id);
    } else {
      db.prepare(`
        INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(account.id, asset_symbol, asset_name || asset_symbol, asset_type || 'stock', units, investAmount, icon || '📈');
    }

    res.json({
      success: true,
      message: `Successfully allocated $${investAmount.toLocaleString()} USD into ${asset_name || asset_symbol} for your Retirement Account.`
    });
  } catch (err) {
    console.error('Error allocating retirement capital:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate retirement investment.' });
  }
});

// POST /api/retirement/toggle-drip (Toggle Dividend Reinvestment Program)
router.post('/api/retirement/toggle-drip', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const newStatus = account.drip_enabled ? 0 : 1;
    db.prepare('UPDATE retirement_accounts SET drip_enabled = ? WHERE id = ?').run(newStatus, account.id);

    res.json({
      success: true,
      drip_enabled: newStatus,
      message: newStatus ? 'Dividend Reinvestment (DRIP) activated: all payouts automatically buy fractional shares.' : 'DRIP deactivated: dividends credited as unallocated cash.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle DRIP setting.' });
  }
});


// POST /api/retirement/invest-basket (Allocate retirement cash into Thematic Baskets)
router.post('/api/retirement/invest-basket', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { basket_id, amount } = req.body;
    const numAmount = parseFloat(amount);

    const basket = STOCK_BASKETS[basket_id];
    if (!basket) {
      return res.status(400).json({ success: false, error: 'Thematic basket not found.' });
    }

    if (isNaN(numAmount) || numAmount < basket.minInvestment) {
      return res.status(400).json({ success: false, error: `Minimum allocation for this basket is $${basket.minInvestment}.` });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Retirement account not found.' });
    }

    if (account.balance < numAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient unallocated retirement cash balance ($${account.balance.toLocaleString()} available). Please contribute funds first.` 
      });
    }

    // Deduct cash balance
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(numAmount, account.id);

    // Allocate across constituent holdings according to their weights
    basket.holdings.forEach(holding => {
      const stockAlloc = Number((numAmount * holding.weight).toFixed(2));
      const stockPrice = spotPrices[holding.symbol] || 150.0;
      const shares = Number((stockAlloc / stockPrice).toFixed(4));

      const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, holding.symbol);
      if (existingHolding) {
        db.prepare(`
          UPDATE retirement_holdings 
          SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shares, stockAlloc, existingHolding.id);
      } else {
        db.prepare(`
          INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
          VALUES (?, ?, ?, 'stock', ?, ?, '🧺')
        `).run(account.id, holding.symbol, holding.name, shares, stockAlloc);
      }
    });

    // Record activity
    db.prepare(`
      INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
      VALUES (?, ?, ?, 'basket_allocation', 2026, ?)
    `).run(account.id, userId, numAmount, `Allocated $${numAmount.toLocaleString()} into ${basket.name} thematic basket`);

    res.json({
      success: true,
      message: `Successfully allocated $${numAmount.toLocaleString()} USD across ${basket.holdings.length} stocks in the ${basket.name} basket.`,
      basketName: basket.name
    });
  } catch (err) {
    console.error('Error allocating retirement basket:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate thematic basket inside retirement account.' });
  }
});

// GET /api/retirement/statement (Generate official Tax-Year 2026 / Form 5498 Custodial Report)
router.get('/api/retirement/statement', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, name, email, country FROM users WHERE id = ?').get(userId);
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const contributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY created_at ASC').all(account.id);
    const holdings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);

    let totalHoldingsValuation = 0;
    const evaluatedHoldings = holdings.map(h => {
      const liveRate = spotPrices[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      const marketVal = Number((h.shares_or_units * liveRate).toFixed(2));
      const unrealizedPnl = Number((marketVal - h.cost_basis).toFixed(2));
      totalHoldingsValuation += marketVal;
      return {
        symbol: h.asset_symbol,
        name: h.asset_name,
        shares: h.shares_or_units,
        costBasis: h.cost_basis,
        marketValue: marketVal,
        unrealizedPnl
      };
    });

    const fmv = Number((account.balance + totalHoldingsValuation).toFixed(2));
    const totalDripReinvested = contributions
      .filter(c => c.source_type === 'drip_reinvest')
      .reduce((sum, c) => sum + c.amount, 0);

    const statement = {
      institution: 'Mainstreet Capital Exchange Prime Custody Ltd',
      regulatoryJurisdiction: 'Institutional Segregated Custodial Depository',
      custodianCode: 'MCE-IRA-SEC-5498',
      statementDate: new Date().toISOString().split('T')[0],
      taxYear: 2026,
      accountInfo: {
        accountNumber: account.account_number,
        accountType: account.account_type.toUpperCase().replace('_', ' '),
        beneficiary: user.name,
        beneficiaryEmail: user.email,
        country: user.country || 'United States',
        status: account.status.toUpperCase(),
        dripActive: Boolean(account.drip_enabled)
      },
      valuationSummary: {
        unallocatedCashBalance: account.balance,
        investedHoldingsFairMarketValue: totalHoldingsValuation,
        totalAccountFairMarketValue: fmv,
        totalLifetimeContributions: account.total_contributed,
        totalDripDividendsReinvested: Number(totalDripReinvested.toFixed(2)),
        annualLimit2026: account.annual_limit,
        remaining2026ContributionRoom: Math.max(0, account.annual_limit - account.total_contributed)
      },
      irsForm5498Simulation: {
        box1_IraContributions: account.total_contributed,
        box2_RolloverContributions: contributions.filter(c => c.source_type === 'rollover_transfer').reduce((s, c) => s + c.amount, 0),
        box3_RothConversion: 0.00,
        box4_RecharacterizedContribs: 0.00,
        box5_FairMarketValueDec31: fmv,
        taxExemptionNotice: 'All earnings and capital gains within this custodial account qualify for 100% tax-free compounding under IRS Section 408A.'
      },
      portfolioHoldings: evaluatedHoldings,
      transactionHistory: contributions
    };

    res.json({ success: true, statement });
  } catch (err) {
    console.error('Error generating retirement statement:', err);
    res.status(500).json({ success: false, error: 'Failed to generate custodial statement.' });
  }
});

// POST /api/retirement/drip/trigger (Admin Only - Trigger quarterly dividend accrual and automated DRIP)
router.post('/api/retirement/drip/trigger', requireAdmin, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const results = distributeQuarterlyDividends(account.id);
    const accountResult = results[0] || {};

    res.json({
      success: true,
      message: `Quarterly dividend cycle executed. Total dividends accrued: $${(accountResult.totalDividends || 0).toFixed(2)} USD.`,
      details: accountResult
    });
  } catch (err) {
    console.error('Error executing DRIP cycle:', err);
    res.status(500).json({ success: false, error: 'Failed to execute dividend cycle.' });
  }
});

// GET /api/retirement/dividends (Fetch dividend accrual history)
router.get('/api/retirement/dividends', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const dividends = db.prepare(`
      SELECT * FROM retirement_contributions 
      WHERE account_id = ? AND source_type IN ('drip_reinvest', 'dividend_cash')
      ORDER BY created_at DESC
    `).all(account.id);

    const totalDividendsAccrued = dividends.reduce((s, d) => s + d.amount, 0);

    res.json({
      success: true,
      dripEnabled: Boolean(account.drip_enabled),
      totalDividendsAccrued: Number(totalDividendsAccrued.toFixed(2)),
      dividends
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch dividend records.' });
  }
});

module.exports = router;
 + transferAmount.toLocaleString(undefined, {minimumFractionDigits: 2}) + ' from Retirement (#' + account.account_number + ') to Primary Brokerage Account.'
        };
      } else {
        const remainingLimit = account.annual_limit - account.total_contributed;
        if (transferAmount > remainingLimit) {
          throw new Error('Contribution of 
router.post('/api/retirement/invest', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { asset_symbol, asset_name, asset_type, amount, icon } = req.body;
    const investAmount = parseFloat(amount);

    if (isNaN(investAmount) || investAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid allocation amount.' });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account || account.balance < investAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient unallocated retirement cash ($${account ? account.balance.toFixed(2) : 0} USD). Please contribute funds first.`
      });
    }

    const price = spotPrices[asset_symbol] || 100.0;
    const units = investAmount / price;

    // Deduct retirement cash
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(investAmount, account.id);

    // Insert or update holding
    const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, asset_symbol);
    if (existingHolding) {
      db.prepare(`
        UPDATE retirement_holdings 
        SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(units, investAmount, existingHolding.id);
    } else {
      db.prepare(`
        INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(account.id, asset_symbol, asset_name || asset_symbol, asset_type || 'stock', units, investAmount, icon || '📈');
    }

    res.json({
      success: true,
      message: `Successfully allocated $${investAmount.toLocaleString()} USD into ${asset_name || asset_symbol} for your Retirement Account.`
    });
  } catch (err) {
    console.error('Error allocating retirement capital:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate retirement investment.' });
  }
});

// POST /api/retirement/toggle-drip (Toggle Dividend Reinvestment Program)
router.post('/api/retirement/toggle-drip', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const newStatus = account.drip_enabled ? 0 : 1;
    db.prepare('UPDATE retirement_accounts SET drip_enabled = ? WHERE id = ?').run(newStatus, account.id);

    res.json({
      success: true,
      drip_enabled: newStatus,
      message: newStatus ? 'Dividend Reinvestment (DRIP) activated: all payouts automatically buy fractional shares.' : 'DRIP deactivated: dividends credited as unallocated cash.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle DRIP setting.' });
  }
});


// POST /api/retirement/invest-basket (Allocate retirement cash into Thematic Baskets)
router.post('/api/retirement/invest-basket', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { basket_id, amount } = req.body;
    const numAmount = parseFloat(amount);

    const basket = STOCK_BASKETS[basket_id];
    if (!basket) {
      return res.status(400).json({ success: false, error: 'Thematic basket not found.' });
    }

    if (isNaN(numAmount) || numAmount < basket.minInvestment) {
      return res.status(400).json({ success: false, error: `Minimum allocation for this basket is $${basket.minInvestment}.` });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Retirement account not found.' });
    }

    if (account.balance < numAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient unallocated retirement cash balance ($${account.balance.toLocaleString()} available). Please contribute funds first.` 
      });
    }

    // Deduct cash balance
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(numAmount, account.id);

    // Allocate across constituent holdings according to their weights
    basket.holdings.forEach(holding => {
      const stockAlloc = Number((numAmount * holding.weight).toFixed(2));
      const stockPrice = spotPrices[holding.symbol] || 150.0;
      const shares = Number((stockAlloc / stockPrice).toFixed(4));

      const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, holding.symbol);
      if (existingHolding) {
        db.prepare(`
          UPDATE retirement_holdings 
          SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shares, stockAlloc, existingHolding.id);
      } else {
        db.prepare(`
          INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
          VALUES (?, ?, ?, 'stock', ?, ?, '🧺')
        `).run(account.id, holding.symbol, holding.name, shares, stockAlloc);
      }
    });

    // Record activity
    db.prepare(`
      INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
      VALUES (?, ?, ?, 'basket_allocation', 2026, ?)
    `).run(account.id, userId, numAmount, `Allocated $${numAmount.toLocaleString()} into ${basket.name} thematic basket`);

    res.json({
      success: true,
      message: `Successfully allocated $${numAmount.toLocaleString()} USD across ${basket.holdings.length} stocks in the ${basket.name} basket.`,
      basketName: basket.name
    });
  } catch (err) {
    console.error('Error allocating retirement basket:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate thematic basket inside retirement account.' });
  }
});

// GET /api/retirement/statement (Generate official Tax-Year 2026 / Form 5498 Custodial Report)
router.get('/api/retirement/statement', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, name, email, country FROM users WHERE id = ?').get(userId);
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const contributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY created_at ASC').all(account.id);
    const holdings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);

    let totalHoldingsValuation = 0;
    const evaluatedHoldings = holdings.map(h => {
      const liveRate = spotPrices[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      const marketVal = Number((h.shares_or_units * liveRate).toFixed(2));
      const unrealizedPnl = Number((marketVal - h.cost_basis).toFixed(2));
      totalHoldingsValuation += marketVal;
      return {
        symbol: h.asset_symbol,
        name: h.asset_name,
        shares: h.shares_or_units,
        costBasis: h.cost_basis,
        marketValue: marketVal,
        unrealizedPnl
      };
    });

    const fmv = Number((account.balance + totalHoldingsValuation).toFixed(2));
    const totalDripReinvested = contributions
      .filter(c => c.source_type === 'drip_reinvest')
      .reduce((sum, c) => sum + c.amount, 0);

    const statement = {
      institution: 'Mainstreet Capital Exchange Prime Custody Ltd',
      regulatoryJurisdiction: 'Institutional Segregated Custodial Depository',
      custodianCode: 'MCE-IRA-SEC-5498',
      statementDate: new Date().toISOString().split('T')[0],
      taxYear: 2026,
      accountInfo: {
        accountNumber: account.account_number,
        accountType: account.account_type.toUpperCase().replace('_', ' '),
        beneficiary: user.name,
        beneficiaryEmail: user.email,
        country: user.country || 'United States',
        status: account.status.toUpperCase(),
        dripActive: Boolean(account.drip_enabled)
      },
      valuationSummary: {
        unallocatedCashBalance: account.balance,
        investedHoldingsFairMarketValue: totalHoldingsValuation,
        totalAccountFairMarketValue: fmv,
        totalLifetimeContributions: account.total_contributed,
        totalDripDividendsReinvested: Number(totalDripReinvested.toFixed(2)),
        annualLimit2026: account.annual_limit,
        remaining2026ContributionRoom: Math.max(0, account.annual_limit - account.total_contributed)
      },
      irsForm5498Simulation: {
        box1_IraContributions: account.total_contributed,
        box2_RolloverContributions: contributions.filter(c => c.source_type === 'rollover_transfer').reduce((s, c) => s + c.amount, 0),
        box3_RothConversion: 0.00,
        box4_RecharacterizedContribs: 0.00,
        box5_FairMarketValueDec31: fmv,
        taxExemptionNotice: 'All earnings and capital gains within this custodial account qualify for 100% tax-free compounding under IRS Section 408A.'
      },
      portfolioHoldings: evaluatedHoldings,
      transactionHistory: contributions
    };

    res.json({ success: true, statement });
  } catch (err) {
    console.error('Error generating retirement statement:', err);
    res.status(500).json({ success: false, error: 'Failed to generate custodial statement.' });
  }
});

// POST /api/retirement/drip/trigger (Admin Only - Trigger quarterly dividend accrual and automated DRIP)
router.post('/api/retirement/drip/trigger', requireAdmin, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const results = distributeQuarterlyDividends(account.id);
    const accountResult = results[0] || {};

    res.json({
      success: true,
      message: `Quarterly dividend cycle executed. Total dividends accrued: $${(accountResult.totalDividends || 0).toFixed(2)} USD.`,
      details: accountResult
    });
  } catch (err) {
    console.error('Error executing DRIP cycle:', err);
    res.status(500).json({ success: false, error: 'Failed to execute dividend cycle.' });
  }
});

// GET /api/retirement/dividends (Fetch dividend accrual history)
router.get('/api/retirement/dividends', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const dividends = db.prepare(`
      SELECT * FROM retirement_contributions 
      WHERE account_id = ? AND source_type IN ('drip_reinvest', 'dividend_cash')
      ORDER BY created_at DESC
    `).all(account.id);

    const totalDividendsAccrued = dividends.reduce((s, d) => s + d.amount, 0);

    res.json({
      success: true,
      dripEnabled: Boolean(account.drip_enabled),
      totalDividendsAccrued: Number(totalDividendsAccrued.toFixed(2)),
      dividends
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch dividend records.' });
  }
});

module.exports = router;
 + transferAmount.toLocaleString() + ' exceeds your remaining 2026 tax-year limit (
router.post('/api/retirement/invest', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { asset_symbol, asset_name, asset_type, amount, icon } = req.body;
    const investAmount = parseFloat(amount);

    if (isNaN(investAmount) || investAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid allocation amount.' });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account || account.balance < investAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient unallocated retirement cash ($${account ? account.balance.toFixed(2) : 0} USD). Please contribute funds first.`
      });
    }

    const price = spotPrices[asset_symbol] || 100.0;
    const units = investAmount / price;

    // Deduct retirement cash
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(investAmount, account.id);

    // Insert or update holding
    const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, asset_symbol);
    if (existingHolding) {
      db.prepare(`
        UPDATE retirement_holdings 
        SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(units, investAmount, existingHolding.id);
    } else {
      db.prepare(`
        INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(account.id, asset_symbol, asset_name || asset_symbol, asset_type || 'stock', units, investAmount, icon || '📈');
    }

    res.json({
      success: true,
      message: `Successfully allocated $${investAmount.toLocaleString()} USD into ${asset_name || asset_symbol} for your Retirement Account.`
    });
  } catch (err) {
    console.error('Error allocating retirement capital:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate retirement investment.' });
  }
});

// POST /api/retirement/toggle-drip (Toggle Dividend Reinvestment Program)
router.post('/api/retirement/toggle-drip', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const newStatus = account.drip_enabled ? 0 : 1;
    db.prepare('UPDATE retirement_accounts SET drip_enabled = ? WHERE id = ?').run(newStatus, account.id);

    res.json({
      success: true,
      drip_enabled: newStatus,
      message: newStatus ? 'Dividend Reinvestment (DRIP) activated: all payouts automatically buy fractional shares.' : 'DRIP deactivated: dividends credited as unallocated cash.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle DRIP setting.' });
  }
});


// POST /api/retirement/invest-basket (Allocate retirement cash into Thematic Baskets)
router.post('/api/retirement/invest-basket', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { basket_id, amount } = req.body;
    const numAmount = parseFloat(amount);

    const basket = STOCK_BASKETS[basket_id];
    if (!basket) {
      return res.status(400).json({ success: false, error: 'Thematic basket not found.' });
    }

    if (isNaN(numAmount) || numAmount < basket.minInvestment) {
      return res.status(400).json({ success: false, error: `Minimum allocation for this basket is $${basket.minInvestment}.` });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Retirement account not found.' });
    }

    if (account.balance < numAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient unallocated retirement cash balance ($${account.balance.toLocaleString()} available). Please contribute funds first.` 
      });
    }

    // Deduct cash balance
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(numAmount, account.id);

    // Allocate across constituent holdings according to their weights
    basket.holdings.forEach(holding => {
      const stockAlloc = Number((numAmount * holding.weight).toFixed(2));
      const stockPrice = spotPrices[holding.symbol] || 150.0;
      const shares = Number((stockAlloc / stockPrice).toFixed(4));

      const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, holding.symbol);
      if (existingHolding) {
        db.prepare(`
          UPDATE retirement_holdings 
          SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shares, stockAlloc, existingHolding.id);
      } else {
        db.prepare(`
          INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
          VALUES (?, ?, ?, 'stock', ?, ?, '🧺')
        `).run(account.id, holding.symbol, holding.name, shares, stockAlloc);
      }
    });

    // Record activity
    db.prepare(`
      INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
      VALUES (?, ?, ?, 'basket_allocation', 2026, ?)
    `).run(account.id, userId, numAmount, `Allocated $${numAmount.toLocaleString()} into ${basket.name} thematic basket`);

    res.json({
      success: true,
      message: `Successfully allocated $${numAmount.toLocaleString()} USD across ${basket.holdings.length} stocks in the ${basket.name} basket.`,
      basketName: basket.name
    });
  } catch (err) {
    console.error('Error allocating retirement basket:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate thematic basket inside retirement account.' });
  }
});

// GET /api/retirement/statement (Generate official Tax-Year 2026 / Form 5498 Custodial Report)
router.get('/api/retirement/statement', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, name, email, country FROM users WHERE id = ?').get(userId);
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const contributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY created_at ASC').all(account.id);
    const holdings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);

    let totalHoldingsValuation = 0;
    const evaluatedHoldings = holdings.map(h => {
      const liveRate = spotPrices[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      const marketVal = Number((h.shares_or_units * liveRate).toFixed(2));
      const unrealizedPnl = Number((marketVal - h.cost_basis).toFixed(2));
      totalHoldingsValuation += marketVal;
      return {
        symbol: h.asset_symbol,
        name: h.asset_name,
        shares: h.shares_or_units,
        costBasis: h.cost_basis,
        marketValue: marketVal,
        unrealizedPnl
      };
    });

    const fmv = Number((account.balance + totalHoldingsValuation).toFixed(2));
    const totalDripReinvested = contributions
      .filter(c => c.source_type === 'drip_reinvest')
      .reduce((sum, c) => sum + c.amount, 0);

    const statement = {
      institution: 'Mainstreet Capital Exchange Prime Custody Ltd',
      regulatoryJurisdiction: 'Institutional Segregated Custodial Depository',
      custodianCode: 'MCE-IRA-SEC-5498',
      statementDate: new Date().toISOString().split('T')[0],
      taxYear: 2026,
      accountInfo: {
        accountNumber: account.account_number,
        accountType: account.account_type.toUpperCase().replace('_', ' '),
        beneficiary: user.name,
        beneficiaryEmail: user.email,
        country: user.country || 'United States',
        status: account.status.toUpperCase(),
        dripActive: Boolean(account.drip_enabled)
      },
      valuationSummary: {
        unallocatedCashBalance: account.balance,
        investedHoldingsFairMarketValue: totalHoldingsValuation,
        totalAccountFairMarketValue: fmv,
        totalLifetimeContributions: account.total_contributed,
        totalDripDividendsReinvested: Number(totalDripReinvested.toFixed(2)),
        annualLimit2026: account.annual_limit,
        remaining2026ContributionRoom: Math.max(0, account.annual_limit - account.total_contributed)
      },
      irsForm5498Simulation: {
        box1_IraContributions: account.total_contributed,
        box2_RolloverContributions: contributions.filter(c => c.source_type === 'rollover_transfer').reduce((s, c) => s + c.amount, 0),
        box3_RothConversion: 0.00,
        box4_RecharacterizedContribs: 0.00,
        box5_FairMarketValueDec31: fmv,
        taxExemptionNotice: 'All earnings and capital gains within this custodial account qualify for 100% tax-free compounding under IRS Section 408A.'
      },
      portfolioHoldings: evaluatedHoldings,
      transactionHistory: contributions
    };

    res.json({ success: true, statement });
  } catch (err) {
    console.error('Error generating retirement statement:', err);
    res.status(500).json({ success: false, error: 'Failed to generate custodial statement.' });
  }
});

// POST /api/retirement/drip/trigger (Admin Only - Trigger quarterly dividend accrual and automated DRIP)
router.post('/api/retirement/drip/trigger', requireAdmin, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const results = distributeQuarterlyDividends(account.id);
    const accountResult = results[0] || {};

    res.json({
      success: true,
      message: `Quarterly dividend cycle executed. Total dividends accrued: $${(accountResult.totalDividends || 0).toFixed(2)} USD.`,
      details: accountResult
    });
  } catch (err) {
    console.error('Error executing DRIP cycle:', err);
    res.status(500).json({ success: false, error: 'Failed to execute dividend cycle.' });
  }
});

// GET /api/retirement/dividends (Fetch dividend accrual history)
router.get('/api/retirement/dividends', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const dividends = db.prepare(`
      SELECT * FROM retirement_contributions 
      WHERE account_id = ? AND source_type IN ('drip_reinvest', 'dividend_cash')
      ORDER BY created_at DESC
    `).all(account.id);

    const totalDividendsAccrued = dividends.reduce((s, d) => s + d.amount, 0);

    res.json({
      success: true,
      dripEnabled: Boolean(account.drip_enabled),
      totalDividendsAccrued: Number(totalDividendsAccrued.toFixed(2)),
      dividends
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch dividend records.' });
  }
});

module.exports = router;
 + remainingLimit.toLocaleString() + ').');
        }

        if (user.balance < transferAmount) {
          throw new Error('Insufficient available cash (
router.post('/api/retirement/invest', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { asset_symbol, asset_name, asset_type, amount, icon } = req.body;
    const investAmount = parseFloat(amount);

    if (isNaN(investAmount) || investAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid allocation amount.' });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account || account.balance < investAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient unallocated retirement cash ($${account ? account.balance.toFixed(2) : 0} USD). Please contribute funds first.`
      });
    }

    const price = spotPrices[asset_symbol] || 100.0;
    const units = investAmount / price;

    // Deduct retirement cash
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(investAmount, account.id);

    // Insert or update holding
    const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, asset_symbol);
    if (existingHolding) {
      db.prepare(`
        UPDATE retirement_holdings 
        SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(units, investAmount, existingHolding.id);
    } else {
      db.prepare(`
        INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(account.id, asset_symbol, asset_name || asset_symbol, asset_type || 'stock', units, investAmount, icon || '📈');
    }

    res.json({
      success: true,
      message: `Successfully allocated $${investAmount.toLocaleString()} USD into ${asset_name || asset_symbol} for your Retirement Account.`
    });
  } catch (err) {
    console.error('Error allocating retirement capital:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate retirement investment.' });
  }
});

// POST /api/retirement/toggle-drip (Toggle Dividend Reinvestment Program)
router.post('/api/retirement/toggle-drip', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const newStatus = account.drip_enabled ? 0 : 1;
    db.prepare('UPDATE retirement_accounts SET drip_enabled = ? WHERE id = ?').run(newStatus, account.id);

    res.json({
      success: true,
      drip_enabled: newStatus,
      message: newStatus ? 'Dividend Reinvestment (DRIP) activated: all payouts automatically buy fractional shares.' : 'DRIP deactivated: dividends credited as unallocated cash.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle DRIP setting.' });
  }
});


// POST /api/retirement/invest-basket (Allocate retirement cash into Thematic Baskets)
router.post('/api/retirement/invest-basket', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { basket_id, amount } = req.body;
    const numAmount = parseFloat(amount);

    const basket = STOCK_BASKETS[basket_id];
    if (!basket) {
      return res.status(400).json({ success: false, error: 'Thematic basket not found.' });
    }

    if (isNaN(numAmount) || numAmount < basket.minInvestment) {
      return res.status(400).json({ success: false, error: `Minimum allocation for this basket is $${basket.minInvestment}.` });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Retirement account not found.' });
    }

    if (account.balance < numAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient unallocated retirement cash balance ($${account.balance.toLocaleString()} available). Please contribute funds first.` 
      });
    }

    // Deduct cash balance
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(numAmount, account.id);

    // Allocate across constituent holdings according to their weights
    basket.holdings.forEach(holding => {
      const stockAlloc = Number((numAmount * holding.weight).toFixed(2));
      const stockPrice = spotPrices[holding.symbol] || 150.0;
      const shares = Number((stockAlloc / stockPrice).toFixed(4));

      const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, holding.symbol);
      if (existingHolding) {
        db.prepare(`
          UPDATE retirement_holdings 
          SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shares, stockAlloc, existingHolding.id);
      } else {
        db.prepare(`
          INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
          VALUES (?, ?, ?, 'stock', ?, ?, '🧺')
        `).run(account.id, holding.symbol, holding.name, shares, stockAlloc);
      }
    });

    // Record activity
    db.prepare(`
      INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
      VALUES (?, ?, ?, 'basket_allocation', 2026, ?)
    `).run(account.id, userId, numAmount, `Allocated $${numAmount.toLocaleString()} into ${basket.name} thematic basket`);

    res.json({
      success: true,
      message: `Successfully allocated $${numAmount.toLocaleString()} USD across ${basket.holdings.length} stocks in the ${basket.name} basket.`,
      basketName: basket.name
    });
  } catch (err) {
    console.error('Error allocating retirement basket:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate thematic basket inside retirement account.' });
  }
});

// GET /api/retirement/statement (Generate official Tax-Year 2026 / Form 5498 Custodial Report)
router.get('/api/retirement/statement', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, name, email, country FROM users WHERE id = ?').get(userId);
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const contributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY created_at ASC').all(account.id);
    const holdings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);

    let totalHoldingsValuation = 0;
    const evaluatedHoldings = holdings.map(h => {
      const liveRate = spotPrices[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      const marketVal = Number((h.shares_or_units * liveRate).toFixed(2));
      const unrealizedPnl = Number((marketVal - h.cost_basis).toFixed(2));
      totalHoldingsValuation += marketVal;
      return {
        symbol: h.asset_symbol,
        name: h.asset_name,
        shares: h.shares_or_units,
        costBasis: h.cost_basis,
        marketValue: marketVal,
        unrealizedPnl
      };
    });

    const fmv = Number((account.balance + totalHoldingsValuation).toFixed(2));
    const totalDripReinvested = contributions
      .filter(c => c.source_type === 'drip_reinvest')
      .reduce((sum, c) => sum + c.amount, 0);

    const statement = {
      institution: 'Mainstreet Capital Exchange Prime Custody Ltd',
      regulatoryJurisdiction: 'Institutional Segregated Custodial Depository',
      custodianCode: 'MCE-IRA-SEC-5498',
      statementDate: new Date().toISOString().split('T')[0],
      taxYear: 2026,
      accountInfo: {
        accountNumber: account.account_number,
        accountType: account.account_type.toUpperCase().replace('_', ' '),
        beneficiary: user.name,
        beneficiaryEmail: user.email,
        country: user.country || 'United States',
        status: account.status.toUpperCase(),
        dripActive: Boolean(account.drip_enabled)
      },
      valuationSummary: {
        unallocatedCashBalance: account.balance,
        investedHoldingsFairMarketValue: totalHoldingsValuation,
        totalAccountFairMarketValue: fmv,
        totalLifetimeContributions: account.total_contributed,
        totalDripDividendsReinvested: Number(totalDripReinvested.toFixed(2)),
        annualLimit2026: account.annual_limit,
        remaining2026ContributionRoom: Math.max(0, account.annual_limit - account.total_contributed)
      },
      irsForm5498Simulation: {
        box1_IraContributions: account.total_contributed,
        box2_RolloverContributions: contributions.filter(c => c.source_type === 'rollover_transfer').reduce((s, c) => s + c.amount, 0),
        box3_RothConversion: 0.00,
        box4_RecharacterizedContribs: 0.00,
        box5_FairMarketValueDec31: fmv,
        taxExemptionNotice: 'All earnings and capital gains within this custodial account qualify for 100% tax-free compounding under IRS Section 408A.'
      },
      portfolioHoldings: evaluatedHoldings,
      transactionHistory: contributions
    };

    res.json({ success: true, statement });
  } catch (err) {
    console.error('Error generating retirement statement:', err);
    res.status(500).json({ success: false, error: 'Failed to generate custodial statement.' });
  }
});

// POST /api/retirement/drip/trigger (Admin Only - Trigger quarterly dividend accrual and automated DRIP)
router.post('/api/retirement/drip/trigger', requireAdmin, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const results = distributeQuarterlyDividends(account.id);
    const accountResult = results[0] || {};

    res.json({
      success: true,
      message: `Quarterly dividend cycle executed. Total dividends accrued: $${(accountResult.totalDividends || 0).toFixed(2)} USD.`,
      details: accountResult
    });
  } catch (err) {
    console.error('Error executing DRIP cycle:', err);
    res.status(500).json({ success: false, error: 'Failed to execute dividend cycle.' });
  }
});

// GET /api/retirement/dividends (Fetch dividend accrual history)
router.get('/api/retirement/dividends', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const dividends = db.prepare(`
      SELECT * FROM retirement_contributions 
      WHERE account_id = ? AND source_type IN ('drip_reinvest', 'dividend_cash')
      ORDER BY created_at DESC
    `).all(account.id);

    const totalDividendsAccrued = dividends.reduce((s, d) => s + d.amount, 0);

    res.json({
      success: true,
      dripEnabled: Boolean(account.drip_enabled),
      totalDividendsAccrued: Number(totalDividendsAccrued.toFixed(2)),
      dividends
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch dividend records.' });
  }
});

module.exports = router;
 + user.balance.toFixed(2) + ' USD) in Primary Brokerage Account.');
        }

        db.prepare('UPDATE users SET balance = balance - ?, equity = equity - ? WHERE id = ?').run(transferAmount, transferAmount, userId);
        db.prepare('UPDATE retirement_accounts SET balance = balance + ?, equity = equity + ?, total_contributed = total_contributed + ? WHERE id = ?').run(transferAmount, transferAmount, transferAmount, account.id);

        db.prepare(`
          INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
          VALUES (?, ?, ?, 'primary_brokerage', 2026, 'Subaccount Transfer into IRA')
        `).run(account.id, userId, transferAmount);

        db.prepare(`
          INSERT INTO transactions (user_id, type, amount, currency, status, method, reference, description)
          VALUES (?, 'transfer', ?, 'USD', 'completed', 'Subaccount Transfer', ?, ?)
        `).run(userId, transferAmount, 'TXE-SUB-' + Date.now(), 'Internal Transfer from Primary Brokerage to Retirement #' + account.account_number);

        return {
          direction: 'primary_to_retirement',
          accountNumber: account.account_number,
          newPrimaryBalance: user.balance - transferAmount,
          newRetirementBalance: account.balance + transferAmount,
          message: 'Transferred 
router.post('/api/retirement/invest', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { asset_symbol, asset_name, asset_type, amount, icon } = req.body;
    const investAmount = parseFloat(amount);

    if (isNaN(investAmount) || investAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid allocation amount.' });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account || account.balance < investAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient unallocated retirement cash ($${account ? account.balance.toFixed(2) : 0} USD). Please contribute funds first.`
      });
    }

    const price = spotPrices[asset_symbol] || 100.0;
    const units = investAmount / price;

    // Deduct retirement cash
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(investAmount, account.id);

    // Insert or update holding
    const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, asset_symbol);
    if (existingHolding) {
      db.prepare(`
        UPDATE retirement_holdings 
        SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(units, investAmount, existingHolding.id);
    } else {
      db.prepare(`
        INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(account.id, asset_symbol, asset_name || asset_symbol, asset_type || 'stock', units, investAmount, icon || '📈');
    }

    res.json({
      success: true,
      message: `Successfully allocated $${investAmount.toLocaleString()} USD into ${asset_name || asset_symbol} for your Retirement Account.`
    });
  } catch (err) {
    console.error('Error allocating retirement capital:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate retirement investment.' });
  }
});

// POST /api/retirement/toggle-drip (Toggle Dividend Reinvestment Program)
router.post('/api/retirement/toggle-drip', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const newStatus = account.drip_enabled ? 0 : 1;
    db.prepare('UPDATE retirement_accounts SET drip_enabled = ? WHERE id = ?').run(newStatus, account.id);

    res.json({
      success: true,
      drip_enabled: newStatus,
      message: newStatus ? 'Dividend Reinvestment (DRIP) activated: all payouts automatically buy fractional shares.' : 'DRIP deactivated: dividends credited as unallocated cash.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle DRIP setting.' });
  }
});


// POST /api/retirement/invest-basket (Allocate retirement cash into Thematic Baskets)
router.post('/api/retirement/invest-basket', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { basket_id, amount } = req.body;
    const numAmount = parseFloat(amount);

    const basket = STOCK_BASKETS[basket_id];
    if (!basket) {
      return res.status(400).json({ success: false, error: 'Thematic basket not found.' });
    }

    if (isNaN(numAmount) || numAmount < basket.minInvestment) {
      return res.status(400).json({ success: false, error: `Minimum allocation for this basket is $${basket.minInvestment}.` });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Retirement account not found.' });
    }

    if (account.balance < numAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient unallocated retirement cash balance ($${account.balance.toLocaleString()} available). Please contribute funds first.` 
      });
    }

    // Deduct cash balance
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(numAmount, account.id);

    // Allocate across constituent holdings according to their weights
    basket.holdings.forEach(holding => {
      const stockAlloc = Number((numAmount * holding.weight).toFixed(2));
      const stockPrice = spotPrices[holding.symbol] || 150.0;
      const shares = Number((stockAlloc / stockPrice).toFixed(4));

      const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, holding.symbol);
      if (existingHolding) {
        db.prepare(`
          UPDATE retirement_holdings 
          SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shares, stockAlloc, existingHolding.id);
      } else {
        db.prepare(`
          INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
          VALUES (?, ?, ?, 'stock', ?, ?, '🧺')
        `).run(account.id, holding.symbol, holding.name, shares, stockAlloc);
      }
    });

    // Record activity
    db.prepare(`
      INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
      VALUES (?, ?, ?, 'basket_allocation', 2026, ?)
    `).run(account.id, userId, numAmount, `Allocated $${numAmount.toLocaleString()} into ${basket.name} thematic basket`);

    res.json({
      success: true,
      message: `Successfully allocated $${numAmount.toLocaleString()} USD across ${basket.holdings.length} stocks in the ${basket.name} basket.`,
      basketName: basket.name
    });
  } catch (err) {
    console.error('Error allocating retirement basket:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate thematic basket inside retirement account.' });
  }
});

// GET /api/retirement/statement (Generate official Tax-Year 2026 / Form 5498 Custodial Report)
router.get('/api/retirement/statement', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, name, email, country FROM users WHERE id = ?').get(userId);
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const contributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY created_at ASC').all(account.id);
    const holdings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);

    let totalHoldingsValuation = 0;
    const evaluatedHoldings = holdings.map(h => {
      const liveRate = spotPrices[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      const marketVal = Number((h.shares_or_units * liveRate).toFixed(2));
      const unrealizedPnl = Number((marketVal - h.cost_basis).toFixed(2));
      totalHoldingsValuation += marketVal;
      return {
        symbol: h.asset_symbol,
        name: h.asset_name,
        shares: h.shares_or_units,
        costBasis: h.cost_basis,
        marketValue: marketVal,
        unrealizedPnl
      };
    });

    const fmv = Number((account.balance + totalHoldingsValuation).toFixed(2));
    const totalDripReinvested = contributions
      .filter(c => c.source_type === 'drip_reinvest')
      .reduce((sum, c) => sum + c.amount, 0);

    const statement = {
      institution: 'Mainstreet Capital Exchange Prime Custody Ltd',
      regulatoryJurisdiction: 'Institutional Segregated Custodial Depository',
      custodianCode: 'MCE-IRA-SEC-5498',
      statementDate: new Date().toISOString().split('T')[0],
      taxYear: 2026,
      accountInfo: {
        accountNumber: account.account_number,
        accountType: account.account_type.toUpperCase().replace('_', ' '),
        beneficiary: user.name,
        beneficiaryEmail: user.email,
        country: user.country || 'United States',
        status: account.status.toUpperCase(),
        dripActive: Boolean(account.drip_enabled)
      },
      valuationSummary: {
        unallocatedCashBalance: account.balance,
        investedHoldingsFairMarketValue: totalHoldingsValuation,
        totalAccountFairMarketValue: fmv,
        totalLifetimeContributions: account.total_contributed,
        totalDripDividendsReinvested: Number(totalDripReinvested.toFixed(2)),
        annualLimit2026: account.annual_limit,
        remaining2026ContributionRoom: Math.max(0, account.annual_limit - account.total_contributed)
      },
      irsForm5498Simulation: {
        box1_IraContributions: account.total_contributed,
        box2_RolloverContributions: contributions.filter(c => c.source_type === 'rollover_transfer').reduce((s, c) => s + c.amount, 0),
        box3_RothConversion: 0.00,
        box4_RecharacterizedContribs: 0.00,
        box5_FairMarketValueDec31: fmv,
        taxExemptionNotice: 'All earnings and capital gains within this custodial account qualify for 100% tax-free compounding under IRS Section 408A.'
      },
      portfolioHoldings: evaluatedHoldings,
      transactionHistory: contributions
    };

    res.json({ success: true, statement });
  } catch (err) {
    console.error('Error generating retirement statement:', err);
    res.status(500).json({ success: false, error: 'Failed to generate custodial statement.' });
  }
});

// POST /api/retirement/drip/trigger (Admin Only - Trigger quarterly dividend accrual and automated DRIP)
router.post('/api/retirement/drip/trigger', requireAdmin, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const results = distributeQuarterlyDividends(account.id);
    const accountResult = results[0] || {};

    res.json({
      success: true,
      message: `Quarterly dividend cycle executed. Total dividends accrued: $${(accountResult.totalDividends || 0).toFixed(2)} USD.`,
      details: accountResult
    });
  } catch (err) {
    console.error('Error executing DRIP cycle:', err);
    res.status(500).json({ success: false, error: 'Failed to execute dividend cycle.' });
  }
});

// GET /api/retirement/dividends (Fetch dividend accrual history)
router.get('/api/retirement/dividends', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const dividends = db.prepare(`
      SELECT * FROM retirement_contributions 
      WHERE account_id = ? AND source_type IN ('drip_reinvest', 'dividend_cash')
      ORDER BY created_at DESC
    `).all(account.id);

    const totalDividendsAccrued = dividends.reduce((s, d) => s + d.amount, 0);

    res.json({
      success: true,
      dripEnabled: Boolean(account.drip_enabled),
      totalDividendsAccrued: Number(totalDividendsAccrued.toFixed(2)),
      dividends
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch dividend records.' });
  }
});

module.exports = router;
 + transferAmount.toLocaleString(undefined, {minimumFractionDigits: 2}) + ' from Primary Brokerage to Retirement (#' + account.account_number + ').'
        };
      }
    });

    const result = executeTransfer();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error processing subaccount transfer:', err.message);
    res.status(400).json({ success: false, error: err.message || 'Failed to process internal subaccount transfer.' });
  }
});

// POST /api/retirement/invest (Allocate retirement cash into stocks, baskets, or crypto)
router.post('/api/retirement/invest', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { asset_symbol, asset_name, asset_type, amount, icon } = req.body;
    const investAmount = parseFloat(amount);

    if (isNaN(investAmount) || investAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid allocation amount.' });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account || account.balance < investAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient unallocated retirement cash ($${account ? account.balance.toFixed(2) : 0} USD). Please contribute funds first.`
      });
    }

    const price = spotPrices[asset_symbol] || 100.0;
    const units = investAmount / price;

    // Deduct retirement cash
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(investAmount, account.id);

    // Insert or update holding
    const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, asset_symbol);
    if (existingHolding) {
      db.prepare(`
        UPDATE retirement_holdings 
        SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(units, investAmount, existingHolding.id);
    } else {
      db.prepare(`
        INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(account.id, asset_symbol, asset_name || asset_symbol, asset_type || 'stock', units, investAmount, icon || '📈');
    }

    res.json({
      success: true,
      message: `Successfully allocated $${investAmount.toLocaleString()} USD into ${asset_name || asset_symbol} for your Retirement Account.`
    });
  } catch (err) {
    console.error('Error allocating retirement capital:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate retirement investment.' });
  }
});

// POST /api/retirement/toggle-drip (Toggle Dividend Reinvestment Program)
router.post('/api/retirement/toggle-drip', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const newStatus = account.drip_enabled ? 0 : 1;
    db.prepare('UPDATE retirement_accounts SET drip_enabled = ? WHERE id = ?').run(newStatus, account.id);

    res.json({
      success: true,
      drip_enabled: newStatus,
      message: newStatus ? 'Dividend Reinvestment (DRIP) activated: all payouts automatically buy fractional shares.' : 'DRIP deactivated: dividends credited as unallocated cash.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to toggle DRIP setting.' });
  }
});


// POST /api/retirement/invest-basket (Allocate retirement cash into Thematic Baskets)
router.post('/api/retirement/invest-basket', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { basket_id, amount } = req.body;
    const numAmount = parseFloat(amount);

    const basket = STOCK_BASKETS[basket_id];
    if (!basket) {
      return res.status(400).json({ success: false, error: 'Thematic basket not found.' });
    }

    if (isNaN(numAmount) || numAmount < basket.minInvestment) {
      return res.status(400).json({ success: false, error: `Minimum allocation for this basket is $${basket.minInvestment}.` });
    }

    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Retirement account not found.' });
    }

    if (account.balance < numAmount) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient unallocated retirement cash balance ($${account.balance.toLocaleString()} available). Please contribute funds first.` 
      });
    }

    // Deduct cash balance
    db.prepare('UPDATE retirement_accounts SET balance = balance - ? WHERE id = ?').run(numAmount, account.id);

    // Allocate across constituent holdings according to their weights
    basket.holdings.forEach(holding => {
      const stockAlloc = Number((numAmount * holding.weight).toFixed(2));
      const stockPrice = spotPrices[holding.symbol] || 150.0;
      const shares = Number((stockAlloc / stockPrice).toFixed(4));

      const existingHolding = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_symbol = ?').get(account.id, holding.symbol);
      if (existingHolding) {
        db.prepare(`
          UPDATE retirement_holdings 
          SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shares, stockAlloc, existingHolding.id);
      } else {
        db.prepare(`
          INSERT INTO retirement_holdings (account_id, asset_symbol, asset_name, asset_type, shares_or_units, cost_basis, icon)
          VALUES (?, ?, ?, 'stock', ?, ?, '🧺')
        `).run(account.id, holding.symbol, holding.name, shares, stockAlloc);
      }
    });

    // Record activity
    db.prepare(`
      INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
      VALUES (?, ?, ?, 'basket_allocation', 2026, ?)
    `).run(account.id, userId, numAmount, `Allocated $${numAmount.toLocaleString()} into ${basket.name} thematic basket`);

    res.json({
      success: true,
      message: `Successfully allocated $${numAmount.toLocaleString()} USD across ${basket.holdings.length} stocks in the ${basket.name} basket.`,
      basketName: basket.name
    });
  } catch (err) {
    console.error('Error allocating retirement basket:', err);
    res.status(500).json({ success: false, error: 'Failed to allocate thematic basket inside retirement account.' });
  }
});

// GET /api/retirement/statement (Generate official Tax-Year 2026 / Form 5498 Custodial Report)
router.get('/api/retirement/statement', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, name, email, country FROM users WHERE id = ?').get(userId);
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const contributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY created_at ASC').all(account.id);
    const holdings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);

    let totalHoldingsValuation = 0;
    const evaluatedHoldings = holdings.map(h => {
      const liveRate = spotPrices[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      const marketVal = Number((h.shares_or_units * liveRate).toFixed(2));
      const unrealizedPnl = Number((marketVal - h.cost_basis).toFixed(2));
      totalHoldingsValuation += marketVal;
      return {
        symbol: h.asset_symbol,
        name: h.asset_name,
        shares: h.shares_or_units,
        costBasis: h.cost_basis,
        marketValue: marketVal,
        unrealizedPnl
      };
    });

    const fmv = Number((account.balance + totalHoldingsValuation).toFixed(2));
    const totalDripReinvested = contributions
      .filter(c => c.source_type === 'drip_reinvest')
      .reduce((sum, c) => sum + c.amount, 0);

    const statement = {
      institution: 'Mainstreet Capital Exchange Prime Custody Ltd',
      regulatoryJurisdiction: 'Institutional Segregated Custodial Depository',
      custodianCode: 'MCE-IRA-SEC-5498',
      statementDate: new Date().toISOString().split('T')[0],
      taxYear: 2026,
      accountInfo: {
        accountNumber: account.account_number,
        accountType: account.account_type.toUpperCase().replace('_', ' '),
        beneficiary: user.name,
        beneficiaryEmail: user.email,
        country: user.country || 'United States',
        status: account.status.toUpperCase(),
        dripActive: Boolean(account.drip_enabled)
      },
      valuationSummary: {
        unallocatedCashBalance: account.balance,
        investedHoldingsFairMarketValue: totalHoldingsValuation,
        totalAccountFairMarketValue: fmv,
        totalLifetimeContributions: account.total_contributed,
        totalDripDividendsReinvested: Number(totalDripReinvested.toFixed(2)),
        annualLimit2026: account.annual_limit,
        remaining2026ContributionRoom: Math.max(0, account.annual_limit - account.total_contributed)
      },
      irsForm5498Simulation: {
        box1_IraContributions: account.total_contributed,
        box2_RolloverContributions: contributions.filter(c => c.source_type === 'rollover_transfer').reduce((s, c) => s + c.amount, 0),
        box3_RothConversion: 0.00,
        box4_RecharacterizedContribs: 0.00,
        box5_FairMarketValueDec31: fmv,
        taxExemptionNotice: 'All earnings and capital gains within this custodial account qualify for 100% tax-free compounding under IRS Section 408A.'
      },
      portfolioHoldings: evaluatedHoldings,
      transactionHistory: contributions
    };

    res.json({ success: true, statement });
  } catch (err) {
    console.error('Error generating retirement statement:', err);
    res.status(500).json({ success: false, error: 'Failed to generate custodial statement.' });
  }
});

// POST /api/retirement/drip/trigger (Admin Only - Trigger quarterly dividend accrual and automated DRIP)
router.post('/api/retirement/drip/trigger', requireAdmin, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const results = distributeQuarterlyDividends(account.id);
    const accountResult = results[0] || {};

    res.json({
      success: true,
      message: `Quarterly dividend cycle executed. Total dividends accrued: $${(accountResult.totalDividends || 0).toFixed(2)} USD.`,
      details: accountResult
    });
  } catch (err) {
    console.error('Error executing DRIP cycle:', err);
    res.status(500).json({ success: false, error: 'Failed to execute dividend cycle.' });
  }
});

// GET /api/retirement/dividends (Fetch dividend accrual history)
router.get('/api/retirement/dividends', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const account = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(userId);
    if (!account) return res.status(404).json({ success: false, error: 'Retirement account not found.' });

    const dividends = db.prepare(`
      SELECT * FROM retirement_contributions 
      WHERE account_id = ? AND source_type IN ('drip_reinvest', 'dividend_cash')
      ORDER BY created_at DESC
    `).all(account.id);

    const totalDividendsAccrued = dividends.reduce((s, d) => s + d.amount, 0);

    res.json({
      success: true,
      dripEnabled: Boolean(account.drip_enabled),
      totalDividendsAccrued: Number(totalDividendsAccrued.toFixed(2)),
      dividends
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch dividend records.' });
  }
});

module.exports = router;
