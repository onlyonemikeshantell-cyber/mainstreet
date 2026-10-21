// Trading & Investment Background Workers for Mainstreet Capital Exchange
const { getLivePrices } = require('../services/livePriceService');

let copyTradingTimer = null;
let tpSlTimer = null;

/**
 * Accrues realistic micro-returns (+0.02% to +0.08%) on active copy trading allocations
 */
function initCopyTradingWorker(db, intervalMs = 45000) {
  if (copyTradingTimer) clearInterval(copyTradingTimer);

  copyTradingTimer = setInterval(() => {
    try {
      const activeSubs = db.prepare("SELECT * FROM copy_subscriptions WHERE status = 'active'").all();
      if (activeSubs && activeSubs.length > 0) {
        const updateStmt = db.prepare('UPDATE copy_subscriptions SET current_profit = current_profit + ? WHERE id = ?');
        activeSubs.forEach(sub => {
          const microRate = (Math.random() * 0.0006 + 0.0002);
          const profitGain = +(sub.allocated_amount * microRate).toFixed(2);
          updateStmt.run(profitGain, sub.id);
        });
      }
    } catch (err) {
      console.error('[WORKER ERROR: CopyTrading]:', err.message);
    }
  }, intervalMs);

  copyTradingTimer.unref();
}

/**
 * Continuously evaluates open trades against live market feeds to execute Take-Profit (TP)
 * and Stop-Loss (SL) auto-liquidations and settlements
 */
function initLiquidationWorker(db, intervalMs = 2500) {
  if (tpSlTimer) clearInterval(tpSlTimer);

  tpSlTimer = setInterval(() => {
    try {
      const openTrades = db.prepare("SELECT * FROM trades WHERE status = 'OPEN'").all();
      if (!openTrades || openTrades.length === 0) return;

      const prices = getLivePrices();

      openTrades.forEach(trade => {
        let currentPrice = trade.current_price;
        if (trade.symbol.includes('BTC') && prices['BTC']) currentPrice = prices['BTC'].price;
        else if (trade.symbol.includes('ETH') && prices['ETH']) currentPrice = prices['ETH'].price;
        else if (trade.symbol.includes('SOL') && prices['SOL']) currentPrice = prices['SOL'].price;
        else if (trade.symbol.includes('BNB') && prices['BNB']) currentPrice = prices['BNB'].price;

        // Update current price in DB
        db.prepare('UPDATE trades SET current_price = ? WHERE id = ?').run(currentPrice, trade.id);

        let shouldClose = false;
        let closeReason = '';

        if (trade.type === 'BUY') {
          if (trade.take_profit && currentPrice >= trade.take_profit) {
            shouldClose = true;
            closeReason = 'TAKE_PROFIT_TRIGGER';
          } else if (trade.stop_loss && currentPrice <= trade.stop_loss) {
            shouldClose = true;
            closeReason = 'STOP_LOSS_TRIGGER';
          }
        } else if (trade.type === 'SELL') {
          if (trade.take_profit && currentPrice <= trade.take_profit) {
            shouldClose = true;
            closeReason = 'TAKE_PROFIT_TRIGGER';
          } else if (trade.stop_loss && currentPrice >= trade.stop_loss) {
            shouldClose = true;
            closeReason = 'STOP_LOSS_TRIGGER';
          }
        }

        if (shouldClose) {
          const diff = trade.type === 'BUY' ? (currentPrice - trade.open_price) : (trade.open_price - currentPrice);
          const multiplier = trade.symbol.includes('EUR') || trade.symbol.includes('GBP') ? 100000 : 1;
          const finalPnL = +(diff * trade.lot_size * multiplier).toFixed(2);

          // Settle Trade atomically
          db.prepare(`
            UPDATE trades 
            SET status = 'CLOSED', close_price = ?, profit_loss = ?, closed_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `).run(currentPrice, finalPnL, trade.id);

          // Update User Balance and Equity
          const u = db.prepare('SELECT balance, equity FROM users WHERE id = ?').get(trade.user_id);
          if (u) {
            const newBal = u.balance + finalPnL;
            db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newBal, trade.user_id);
          }

          console.log(`[TP/SL Engine] Auto-closed Trade #${trade.id} (${trade.symbol} ${trade.type}) @ $${currentPrice} [${closeReason}] -> P&L: $${finalPnL}`);
        }
      });
    } catch (err) {
      console.error('[WORKER ERROR: TP/SL Engine]:', err.message);
    }
  }, intervalMs);

  tpSlTimer.unref();
}

function startWorkers(db) {
  initCopyTradingWorker(db);
  initLiquidationWorker(db);
  console.log('[System Workers] Copy trading accrual & TP/SL liquidation engines initialized.');
}

function stopWorkers() {
  if (copyTradingTimer) clearInterval(copyTradingTimer);
  if (tpSlTimer) clearInterval(tpSlTimer);
}

module.exports = {
  startWorkers,
  stopWorkers,
  initCopyTradingWorker,
  initLiquidationWorker
};
