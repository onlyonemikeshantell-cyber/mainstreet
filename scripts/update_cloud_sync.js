const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '../src/services/cloudPersistenceService.js');
let c = fs.readFileSync(targetPath, 'utf8');

if (!c.includes("'copy_trading_comments'")) {
  c = c.replace("'master_trades',", "'master_trades',\n  'copy_trading_comments',");
  // Replace the second occurrence in CONFIG_TABLES as well
  c = c.replace("'master_trades',", "'master_trades',\n  'copy_trading_comments',");
  fs.writeFileSync(targetPath, c, 'utf8');
  console.log('✓ Added copy_trading_comments to cloudPersistenceService.js');
} else {
  console.log('Already present');
}
