const db = require('../db');

// Annual dividend yield rates
const DIVIDEND_RATES = {
  'O': 0.068,
  'PLD': 0.038,
  'SPG': 0.059,
  'VICI': 0.055,
  'PSA': 0.042,
  'DLR': 0.039,
  'VNQ': 0.044,
  'AMT': 0.032,
  'EQIX': 0.024,
  'WELL': 0.031,
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
  'PLD': 124.50,
  'O': 56.80,
  'EQIX': 875.20,
  'AMT': 225.40,
  'SPG': 158.30,
  'PSA': 312.60,
  'DLR': 154.20,
  'WELL': 118.90,
  'VICI': 32.40,
  'VNQ': 92.10,
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
 * Supports:
 * - Standard statutory rates
 * - Custom fixed dollar figure inputs (per-account or global)
 * - Custom yield percentage inputs
 * - Flexible reinvestment modes: auto (respects account.drip_enabled), drip (force fractional reinvestment), or cash (force cash credit)
 * - Specific target holding reinvestment or proportional distribution across existing holdings
 * 
 * @param {Object|number|string} [options] - Options object or legacy targetAccountId
 */
function distributeQuarterlyDividends(options = {}) {
  let targetAccountId = null;
  let customAmount = null;
  let customYieldPercent = null;
  let mode = 'auto'; // 'auto' | 'drip' | 'cash'
  let targetHoldingId = null;
  let notes = null;
  let taxYear = 2026;

  if (typeof options === 'object' && options !== null) {
    targetAccountId = options.targetAccountId || options.account_id || null;
    if (targetAccountId === 'all' || targetAccountId === '') targetAccountId = null;
    if (options.customAmount !== undefined && options.customAmount !== null && options.customAmount !== '') {
      customAmount = parseFloat(options.customAmount);
      if (isNaN(customAmount) || customAmount <= 0) customAmount = null;
    }
    if (options.customYieldPercent !== undefined && options.customYieldPercent !== null && options.customYieldPercent !== '') {
      customYieldPercent = parseFloat(options.customYieldPercent);
      if (isNaN(customYieldPercent) || customYieldPercent <= 0) customYieldPercent = null;
    }
    if (options.mode) mode = options.mode;
    if (options.targetHoldingId) targetHoldingId = parseInt(options.targetHoldingId, 10);
    if (options.notes) notes = String(options.notes).trim();
    if (options.taxYear) taxYear = parseInt(options.taxYear, 10) || 2026;
  } else if (typeof options === 'number' || typeof options === 'string') {
    targetAccountId = options;
  }

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
    const shouldReinvest = mode === 'drip' ? true : (mode === 'cash' ? false : Boolean(account.drip_enabled));

    if (customAmount !== null && customAmount > 0) {
      // -------------------------------------------------------------
      // CASE 1: FIXED CUSTOM DOLLAR FIGURE INPUT
      // -------------------------------------------------------------
      totalDividendsForAccount = Number(customAmount.toFixed(2));

      if (shouldReinvest && holdings.length > 0) {
        // Option A: Specific target holding selected
        if (targetHoldingId) {
          const matchedHolding = holdings.find(h => h.id === targetHoldingId) || holdings[0];
          const currentPrice = SPOT_PRICES[matchedHolding.asset_symbol] || (matchedHolding.cost_basis / (matchedHolding.shares_or_units || 1)) || 100.0;
          const additionalShares = Number((totalDividendsForAccount / currentPrice).toFixed(4));

          db.prepare(`
            UPDATE retirement_holdings 
            SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(additionalShares, totalDividendsForAccount, matchedHolding.id);

          const recordNote = notes || `Custom DRIP: Acquired ${additionalShares} shares of ${matchedHolding.asset_symbol} @ $${currentPrice}`;
          db.prepare(`
            INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
            VALUES (?, ?, ?, 'drip_reinvest', ?, ?)
          `).run(account.id, account.user_id, totalDividendsForAccount, taxYear, recordNote);

          actionsTaken.push({
            symbol: matchedHolding.asset_symbol,
            type: 'drip_reinvest',
            payout: totalDividendsForAccount,
            additionalShares
          });
        } else {
          // Option B: Proportional distribution across all stock holdings
          let totalHoldingsVal = 0;
          holdings.forEach(h => {
            const p = SPOT_PRICES[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1)) || 100.0;
            totalHoldingsVal += (h.shares_or_units * p);
          });

          let remainingPayout = totalDividendsForAccount;
          holdings.forEach((holding, idx) => {
            const p = SPOT_PRICES[holding.asset_symbol] || (holding.cost_basis / (holding.shares_or_units || 1)) || 100.0;
            const hVal = holding.shares_or_units * p;
            const weight = totalHoldingsVal > 0 ? (hVal / totalHoldingsVal) : (1.0 / holdings.length);
            
            const portionPayout = (idx === holdings.length - 1)
              ? Number(remainingPayout.toFixed(2))
              : Number((totalDividendsForAccount * weight).toFixed(2));
            
            remainingPayout -= portionPayout;

            if (portionPayout > 0) {
              const addShares = Number((portionPayout / p).toFixed(4));
              db.prepare(`
                UPDATE retirement_holdings 
                SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).run(addShares, portionPayout, holding.id);

              const recordNote = notes 
                ? `${notes} (${holding.asset_symbol}: ${addShares} shares @ $${p})`
                : `Custom DRIP: Acquired ${addShares} shares of ${holding.asset_symbol} @ $${p}`;

              db.prepare(`
                INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
                VALUES (?, ?, ?, 'drip_reinvest', ?, ?)
              `).run(account.id, account.user_id, portionPayout, taxYear, recordNote);

              actionsTaken.push({
                symbol: holding.asset_symbol,
                type: 'drip_reinvest',
                payout: portionPayout,
                additionalShares: addShares
              });
            }
          });
        }
      } else {
        // Fallback or explicit Cash Credit
        db.prepare('UPDATE retirement_accounts SET balance = balance + ? WHERE id = ?').run(totalDividendsForAccount, account.id);
        const recordNote = notes || (shouldReinvest && holdings.length === 0
          ? `Custom Dividend: $${totalDividendsForAccount.toFixed(2)} credited to IRA cash (no stock holdings available for DRIP reinvestment)`
          : `Custom Cash Dividend: $${totalDividendsForAccount.toFixed(2)} credited to IRA balance`);

        db.prepare(`
          INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
          VALUES (?, ?, ?, 'dividend_cash', ?, ?)
        `).run(account.id, account.user_id, totalDividendsForAccount, taxYear, recordNote);

        actionsTaken.push({
          symbol: 'USD',
          type: 'cash_credit',
          payout: totalDividendsForAccount
        });
      }

    } else {
      // -------------------------------------------------------------
      // CASE 2: YIELD BASED CALCULATION (CUSTOM YIELD % OR STATUTORY)
      // -------------------------------------------------------------
      holdings.forEach(holding => {
        let annualRate;
        if (customYieldPercent !== null && customYieldPercent > 0) {
          annualRate = customYieldPercent / 100.0;
        } else {
          annualRate = DIVIDEND_RATES[holding.asset_symbol] || 0.012; // default 1.2%
        }
        const quarterlyRate = annualRate / 4.0;
        const currentPrice = SPOT_PRICES[holding.asset_symbol] || (holding.cost_basis / (holding.shares_or_units || 1));
        const marketVal = holding.shares_or_units * currentPrice;
        const dividendPayout = Number((marketVal * quarterlyRate).toFixed(2));

        if (dividendPayout >= 0.05) { // minimum threshold 5 cents
          totalDividendsForAccount += dividendPayout;

          if (shouldReinvest) {
            // BUY FRACTIONAL SHARES
            const additionalShares = Number((dividendPayout / currentPrice).toFixed(4));

            db.prepare(`
              UPDATE retirement_holdings 
              SET shares_or_units = shares_or_units + ?, cost_basis = cost_basis + ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(additionalShares, dividendPayout, holding.id);

            const recordNote = notes 
              ? `${notes}: Acquired ${additionalShares} shares of ${holding.asset_symbol} @ $${currentPrice}`
              : `Automated DRIP: Acquired ${additionalShares} shares of ${holding.asset_symbol} @ $${currentPrice}`;

            db.prepare(`
              INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
              VALUES (?, ?, ?, 'drip_reinvest', ?, ?)
            `).run(account.id, account.user_id, dividendPayout, taxYear, recordNote);

            actionsTaken.push({
              symbol: holding.asset_symbol,
              type: 'drip_reinvest',
              payout: dividendPayout,
              additionalShares
            });
          } else {
            // CREDIT CASH
            db.prepare('UPDATE retirement_accounts SET balance = balance + ? WHERE id = ?').run(dividendPayout, account.id);

            const recordNote = notes
              ? `${notes}: $${dividendPayout} credited to IRA balance`
              : `Quarterly Cash Dividend from ${holding.asset_symbol}: $${dividendPayout} credited to IRA balance`;

            db.prepare(`
              INSERT INTO retirement_contributions (account_id, user_id, amount, source_type, tax_year, notes)
              VALUES (?, ?, ?, 'dividend_cash', ?, ?)
            `).run(account.id, account.user_id, dividendPayout, taxYear, recordNote);

            actionsTaken.push({
              symbol: holding.asset_symbol,
              type: 'cash_credit',
              payout: dividendPayout
            });
          }
        }
      });
    }

    // Recompute total equity for this account
    const updatedHoldings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(account.id);
    let newHoldingsVal = 0;
    updatedHoldings.forEach(h => {
      const p = SPOT_PRICES[h.asset_symbol] || (h.cost_basis / (h.shares_or_units || 1)) || 100.0;
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
      newBalance: updatedAccount.balance,
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
