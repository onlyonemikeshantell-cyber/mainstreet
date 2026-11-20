const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/routes/user.js');
let c = fs.readFileSync(filePath, 'utf8');

const target = `  res.render('app/copy-trading-app', {
    title: 'Copy Trading Portfolio Station | Mainstreet Capital Exchange',
    user,
    masters,
    mySubscriptions
  });`;

const replacement = `  const comments = db.prepare(\`
    SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy, mt.avatar as master_avatar
    FROM copy_trading_comments c
    LEFT JOIN master_traders mt ON c.master_id = mt.id
    WHERE c.is_approved = 1
    ORDER BY c.is_pinned DESC, c.id DESC
  \`).all();

  res.render('app/copy-trading-app', {
    title: 'Copy Trading Portfolio Station | Mainstreet Capital Exchange',
    user,
    masters,
    mySubscriptions,
    comments
  });`;

if (c.includes("res.render('app/copy-trading-app'")) {
  c = c.replace(target, () => replacement);
  fs.writeFileSync(filePath, c, 'utf8');
  console.log('✓ Updated src/routes/user.js with comments support');
} else {
  console.error('Target not found in src/routes/user.js');
}
