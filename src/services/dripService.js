const db = require('../db');

// Annual dividend yield rates
const DIVIDEND_RATES = {
  'AAPL': 0.015, // 1.5%
  'MSFT': 0.018, // 1.8%
  'NVDA': 0.005, // 0.5%
  'JPM':  0.036, // 3.6%
  'AMZN': 0.008, // 0.8%
  'GOOGL': 0.010, // 1.0%
  'META': 0.012, // 1.2%
  'TSLA': 0.000, // 0.0%
  'PLTR': 0.000, // 0.0%
  'BRK.B': 0.024 // 2.4%
};

const SPOT_PRICES = {
  'AAPL': 224.20,
  'MSFT': 418.50,
  'NVDA': 128.50,
  'JPM': 214.50,
  'AMZN': 178.60,
  'GOOGL': 164.80,
  'META': 512.30,
  'TSLA': 218.40,
  'PLTR': 31.80,
  'BRK.B': 452.10,
  'BTC': 68650.00,
  'ETH': 3645.00,
  'SOL': 156.20
};

/**
 * Distribute quarterly dividends across retirement accounts.
 * If drip_enabled = 1: Reinvests dividend to buy fractional shares.
 * If drip_enabled = 0: Credits cash to unallocated IRA balance.
 */
function distributeQuarterlyDividends(targetAccountId = null) {
  let accounts;
  if (targetAccountId) {
    accounts = db.prepare('SELECT * FROM retirement_accounts WHERE id = ?').all(targetAccountId);
  } else {
    accounts = db.prepare("SELECT * FROM retirement_accounts WHERE status = 'active'").all();
  }

  const results = [];

  accounts.forEach(account => {
    const holdings = db.prepare("SELECT * FROM retirement_holdings WHERE account_id = ? AND asset_type = 'stock'").all(account.id);
    let totalDividendsForAccount = 0;
    const actionsTaken = [];

    holdings.forEach(holding => {
      const annualRate = DIVIDEND_RATES[holding.asset_symbol] || 0.012; // default 1.2%
      const quarterlyRate = annualRate / 4.0;
      const currentPrice = SPOT_PRICES[holding.asset_symbol] || (holding.cost_basis / (holding.shares_or_units || 1));
      const marketVal = holding.shares_or_units * currentPrice;
      const dividendPayout = Number((marketVal * quarterlyRate).toFixed(2));

      if (dividendPayout >= 0.05) { // minimum threshold 5 cents
        totalDividendsForAccount += dividendPayout;

        if (account.drip_enabled) {
          // BUY FRACTIONAL SHARES
          const additionalShares = Number((dividendPayout / currentPrice).toFixed(4));

          db.prepare(`
            UPDATE retirement_holdings 
            SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(additionalShares, dividendPayout, holding.id);

          // Record DRIP reinvestment contribution
          db.prepare(`
            INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
            VALUES (?, ?, ?, 'drip_reinvest', 2026, ?)
          `).run(
            account.id, 
            account.user_id, 
            dividendPayout, 
            `Automated DRIP: Acquired ${additionalShares} shares of ${holding.asset_symbol} @ $${currentPrice}`
          );

          actionsTaken.push({
            symbol: holding.asset_symbol,
            type: 'drip_reinvest',
            payout: dividendPayout,
            additionalShares
          });
        } else {
          // CREDIT CASH
          db.prepare('UPDATE retirement_accounts SET balance = balance + ? WHERE id = ?').run(dividendPayout, account.id);

          db.prepare(`
            INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
            VALUES (?, ?, ?, 'dividend_cash', 2026, ?)
          `).run(
            account.id, 
            account.user_id, 
            dividendPayout, 
            `Quarterly Cash Dividend from ${holding.asset_symbol}: $${dividendPayout} credited to IRA balance`
          );

          actionsTaken.push({
            symbol: holding.asset_symbol,
            type: 'cash_credit',
            payout: dividendPayout
          });
        }
      }
    });

    // Recompute total equity
    const updatedHoldings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);
    let newHoldingsVal = 0;
    updatedHoldings.forEach(h => {
      const p = SPOT_PRICES[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1));
      newHoldingsVal += (h.shares_or_units * p);
    });

    const updatedAccount = db.prepare('SELECT balance FROM retirement_accounts WHERE id = ?').get(account.id);
    const newEquity = Number((updatedAccount.balance + newHoldingsVal).toFixed(2));
    db.prepare('UPDATE retirement_accounts SET equity = ? WHERE id = ?').run(newEquity, account.id);

    results.push({
      accountId: account.id,
      accountNumber: account.account_number,
      dripEnabled: Boolean(account.drip_enabled),
      totalDividends: totalDividendsForAccount,
      newEquity,
      actions: actionsTaken
    });
  });

  return results;
}

module.exports = {
  DIVIDEND_RATES,
  SPOT_PRICES,
  distributeQuarterlyDividends
};
