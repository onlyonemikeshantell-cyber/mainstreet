const fs = require('fs');
const path = require('path');

const mailerPath = path.join(__dirname, '..', 'src', 'services', 'mailer.js');
let content = fs.readFileSync(mailerPath, 'utf8');

if (content.includes('timeout: 3500,')) {
  content = content.replace('timeout: 3500,', 'timeout: 8000,');
  fs.writeFileSync(mailerPath, content, 'utf8');
  console.log('Successfully updated timeout in mailer.js from 3500 to 8000ms');
} else {
  console.log('timeout: 3500, not found in mailer.js');
}
