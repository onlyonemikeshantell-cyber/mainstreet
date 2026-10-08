// Thematic Stock Baskets & Dividend Yield Configurations for Mainstreet Capital Exchange

const STOCK_BASKETS = {
  ai_titans: {
    id: 'ai_titans',
    name: 'AI & Semiconductors',
    tagline: 'Leading compute infrastructure, AI silicon design, and enterprise generative compute',
    icon: '🤖',
    badgeColor: 'sky',
    holdingsCount: 5,
    annualizedReturn: 32.6,
    historical3Y: 88.4,
    dividendYield: 1.4,
    riskLevel: 'Growth (4/5)',
    rebalancing: 'Quarterly',
    minInvestment: 50,
    holdings: [
      { symbol: 'NVDA', name: 'Nvidia Corp', weight: 0.30 },
      { symbol: 'MSFT', name: 'Microsoft Corp', weight: 0.25 },
      { symbol: 'TSM', name: 'Taiwan Semiconductor', weight: 0.20 },
      { symbol: 'AMD', name: 'Advanced Micro Devices', weight: 0.15 },
      { symbol: 'ASML', name: 'ASML Holding', weight: 0.10 }
    ]
  },
  dividend_leaders: {
    id: 'dividend_leaders',
    name: 'Dividend Leaders',
    tagline: 'Defensive blue-chip cash-flow compounders with regular quarterly yield distribution',
    icon: '🏦',
    badgeColor: 'emerald',
    holdingsCount: 5,
    annualizedReturn: 14.8,
    historical3Y: 42.1,
    dividendYield: 4.2,
    riskLevel: 'Conservative (2/5)',
    rebalancing: 'Quarterly',
    minInvestment: 50,
    holdings: [
      { symbol: 'JPM', name: 'JPMorgan Chase & Co', weight: 0.25 },
      { symbol: 'JNJ', name: 'Johnson & Johnson', weight: 0.25 },
      { symbol: 'PG', name: 'Procter & Gamble', weight: 0.20 },
      { symbol: 'PEP', name: 'PepsiCo Inc', weight: 0.15 },
      { symbol: 'ABBV', name: 'AbbVie Inc', weight: 0.15 }
    ]
  },
  global_tech: {
    id: 'global_tech',
    name: 'Global Technology',
    tagline: 'Market-cap weighted portfolio of dominant global cloud, consumer software & internet leaders',
    icon: '🌐',
    badgeColor: 'indigo',
    holdingsCount: 5,
    annualizedReturn: 27.4,
    historical3Y: 74.2,
    dividendYield: 1.1,
    riskLevel: 'Moderate (3/5)',
    rebalancing: 'Quarterly',
    minInvestment: 50,
    holdings: [
      { symbol: 'AAPL', name: 'Apple Inc', weight: 0.25 },
      { symbol: 'MSFT', name: 'Microsoft Corp', weight: 0.25 },
      { symbol: 'GOOGL', name: 'Alphabet Inc', weight: 0.20 },
      { symbol: 'AMZN', name: 'Amazon.com Inc', weight: 0.15 },
      { symbol: 'META', name: 'Meta Platforms', weight: 0.15 }
    ]
  },
  clean_energy: {
    id: 'clean_energy',
    name: 'Clean Energy',
    tagline: 'Solar generation, grid modernization, utility storage, and decarbonization infrastructure',
    icon: '⚡',
    badgeColor: 'amber',
    holdingsCount: 5,
    annualizedReturn: 21.2,
    historical3Y: 52.8,
    dividendYield: 2.1,
    riskLevel: 'Moderate-High (4/5)',
    rebalancing: 'Quarterly',
    minInvestment: 50,
    holdings: [
      { symbol: 'NEE', name: 'NextEra Energy', weight: 0.25 },
      { symbol: 'ENPH', name: 'Enphase Energy', weight: 0.25 },
      { symbol: 'FSLR', name: 'First Solar Inc', weight: 0.20 },
      { symbol: 'TSLA', name: 'Tesla Inc', weight: 0.15 },
      { symbol: 'ICLN', name: 'iShares Clean Energy', weight: 0.15 }
    ]
  },
  healthcare_innovation: {
    id: 'healthcare_innovation',
    name: 'Healthcare Innovation',
    tagline: 'Biotechnology breakthroughs, robotic surgical automation, and molecular therapeutics',
    icon: '🧬',
    badgeColor: 'rose',
    holdingsCount: 5,
    annualizedReturn: 19.8,
    historical3Y: 58.6,
    dividendYield: 2.4,
    riskLevel: 'Moderate (3/5)',
    rebalancing: 'Quarterly',
    minInvestment: 50,
    holdings: [
      { symbol: 'LLY', name: 'Eli Lilly & Co', weight: 0.30 },
      { symbol: 'UNH', name: 'UnitedHealth Group', weight: 0.25 },
      { symbol: 'ISRG', name: 'Intuitive Surgical', weight: 0.20 },
      { symbol: 'VRTX', name: 'Vertex Pharmaceuticals', weight: 0.15 },
      { symbol: 'REGN', name: 'Regeneron Pharma', weight: 0.10 }
    ]
  }
};

// Annual dividend APYs for held equities
const STOCK_DIVIDEND_RATES = {
  'JPM': 0.034,
  'JNJ': 0.031,
  'PG': 0.026,
  'PEP': 0.032,
  'ABBV': 0.038,
  'O': 0.058,
  'PLD': 0.032,
  'AAPL': 0.012,
  'MSFT': 0.015,
  'NEE': 0.029,
  'LLY': 0.014,
  'UNH': 0.018,
  'NVDA': 0.008,
  'TSM': 0.018,
  'ASML': 0.014
};

module.exports = {
  STOCK_BASKETS,
  STOCK_DIVIDEND_RATES
};
