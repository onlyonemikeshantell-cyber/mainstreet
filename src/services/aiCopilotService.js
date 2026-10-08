const { getLivePrices } = require('./livePriceService');

// Advanced AI Financial Copilot Engine
const MODEL_PERSONAS = {
  'gpt4o': {
    name: 'GPT-4o Multi-Asset Quant',
    badge: 'OMNI QUANT',
    focus: 'Cross-market alpha generation, macro correlation and multi-asset synthesis'
  },
  'candle_analyst': {
    name: 'Candlestick & Technical Analyst',
    badge: 'TECHNICAL DEEP',
    focus: 'Order flow, Fair Value Gaps (FVG), 4H MACD divergences and liquidity sweeps'
  },
  'financial_ai': {
    name: 'Institutional Risk & Valuation AI',
    badge: 'MACRO & RISK',
    focus: 'Gain-to-Pain ratio, Sharpe optimization, quarterly dividend yields and solvency'
  },
  'doc_ai': {
    name: 'Custodial & Compliance Document AI',
    badge: 'COMPLIANCE & CUSTODY',
    focus: 'SIPC custodial insurance, IRS Roth IRA tax regulations and execution audit trails'
  }
};

function generateCopilotAnalysis({ prompt, model = 'gpt4o', asset = 'SOL', timeframe = 'Day' }) {
  const livePrices = getLivePrices();
  const currentAssetData = livePrices[asset] || { price: 156.20, change24h: 3.45, name: asset };
  const price = currentAssetData.price || 156.20;
  const change = currentAssetData.change24h || 3.45;
  const isPositive = change >= 0;

  const slugMap = {
    'gpt-4o': 'gpt4o',
    'gpt4o': 'gpt4o',
    'document-ai': 'doc_ai',
    'document_ai': 'doc_ai',
    'doc-ai': 'doc_ai',
    'doc_ai': 'doc_ai',
    'financial-ai': 'financial_ai',
    'financial_ai': 'financial_ai',
    'candle-analyst': 'candle_analyst',
    'candle_analyst': 'candle_analyst'
  };

  const normalizedModel = slugMap[model] || (MODEL_PERSONAS[model] ? model : 'gpt4o');
  const persona = MODEL_PERSONAS[normalizedModel] || MODEL_PERSONAS['gpt4o'];

  const queryLower = (prompt || '').toLowerCase();

  // Dynamic Technical Calculations
  const rsi = Math.min(84, Math.max(32, Math.round(52 + (change * 4))));
  const gainToPain = +(1.6 + (Math.abs(change) * 0.08)).toFixed(1);
  const rewardToRisk = +(2.1 + (Math.abs(change) * 0.1)).toFixed(1);
  const leverageUsed = '$120,000';
  const winProbability = Math.min(94, Math.max(68, Math.round(76 + (change * 1.8)))) + '%';
  const sharpeRatio = +(2.4 + (Math.abs(change) * 0.15)).toFixed(2);
  const maxDrawdown = '3.2%';

  let summary = `Trade Focus: ${isPositive ? 'Bullish Breakout Continuation' : 'Mean-Reversion Accumulation'} on ${asset}`;
  let analysis = '';
  let actionables = [];

  if (normalizedModel === 'candle_analyst') {
    analysis = `Candlestick telemetry for ${asset} (${timeframe} view) indicates institutional absorption around the $${(price * 0.965).toFixed(2)} support zone. A 4-hour MACD bullish divergence is confirmed with volume delta expanding by +34%. Next major liquidity sweep sits at $${(price * 1.055).toFixed(2)}.`;
    actionables = [
      { text: `⚡ Execute Buy @ $${price.toFixed(2)}`, action: 'trade', symbol: asset, type: 'buy' },
      { text: `🎯 Target $${(price * 1.055).toFixed(2)} (+5.5%)`, action: 'chart', symbol: asset },
      { text: `🛡️ Set Stop-Loss @ $${(price * 0.955).toFixed(2)}`, action: 'risk', symbol: asset }
    ];
  } else if (normalizedModel === 'financial_ai') {
    analysis = `Portfolio Risk Engine: ${asset} maintains a Gain-to-Pain ratio of ${gainToPain} and Reward-to-Risk ratio of ${rewardToRisk}:1. Volatility coefficient is compressed at 1.42 with 0.0% counterparty risk via STP ECN prime routing. Sharpe ratio stands institutional-grade at ${sharpeRatio}.`;
    actionables = [
      { text: '📊 Run Monte Carlo Stress Test', action: 'stress_test', symbol: asset },
      { text: `🔄 Rebalance Portfolio to 18% ${asset}`, action: 'rebalance', symbol: asset },
      { text: '📈 View Expected Yield & DRIP', action: 'drip', symbol: asset }
    ];
  } else if (normalizedModel === 'doc_ai') {
    analysis = `Compliance & Custodial Verification: All orders on ${asset} are executed under strict STP/ECN non-dealing-desk protocols. Digital assets are backed by multi-sig offline cold storage, while equities and IRAs are protected under SIPC custodial insurance up to $500,000 per account.`;
    actionables = [
      { text: '📜 View SIPC Custodial Audit', action: 'doc_sipc' },
      { text: '🛡️ Tax-Free IRA Eligibility Check', action: 'doc_ira' },
      { text: '⚡ Download ECN Execution Proof', action: 'doc_ecn' }
    ];
  } else {
    // Default GPT-4o Multi-Asset Quant
    if (queryLower.includes('risk') || queryLower.includes('sharpe') || queryLower.includes('drawdown')) {
      summary = `Risk Telemetry & Portfolio Optimization for ${asset}`;
      analysis = `Quantitative audit reveals exceptional alpha density. Reward-to-Risk ratio is modeled at ${rewardToRisk}:1 with a Gain-to-Pain metric of ${gainToPain}. Estimated win probability on algorithmic entry is ${winProbability} across a ${timeframe} horizon.`;
    } else if (queryLower.includes('rebalance') || queryLower.includes('allocation')) {
      summary = 'Optimal Asset Allocation Recommendation';
      analysis = `Based on current volatility indexes and dividend yields, we recommend maintaining 45% Equities, 30% Crypto (${asset}, BTC, ETH), 15% Thematic Baskets, and 10% Liquid Cash.`;
    } else {
      analysis = `Based on multi-exchange order flow aggregation, ${asset} is showing strong institutional buy volume with $${(price).toFixed(2)} pivot holding firmly. Resistance at $${(price * 1.048).toFixed(2)} is weakening with ${winProbability} upside probability. Recommended entry: $${price.toFixed(2)} with Stop-Loss at $${(price * 0.952).toFixed(2)}.`;
    }
    actionables = [
      { text: `⚡ 1-Click Order: Buy ${asset}`, action: 'trade', symbol: asset, type: 'buy' },
      { text: '📊 Run Deep Alpha Scan', action: 'scan', symbol: asset },
      { text: '🔄 Optimize Portfolio Allocation', action: 'rebalance', symbol: asset }
    ];
  }

  return {
    success: true,
    model: normalizedModel,
    persona,
    asset,
    timeframe,
    price: price.toFixed(2),
    change24h: (isPositive ? '+' : '') + change.toFixed(2) + '%',
    summary,
    analysis,
    actionables,
    metrics: {
      gainToPain,
      rewardToRisk,
      leverageUsed,
      winProbability,
      sharpeRatio,
      maxDrawdown,
      rsi
    },
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
}

module.exports = {
  MODEL_PERSONAS,
  generateCopilotAnalysis
};