const fs = require('fs');
const path = require('path');

const csrfPath = path.join(__dirname, '..', 'src', 'middleware', 'csrf.js');
let content = fs.readFileSync(csrfPath, 'utf8');

const target = `  '/register/verify-otp',`;
const replacement = `  '/register/verify-otp',
  '/verify-email/resend',
  '/verify-email',`;

if (content.includes(target) && !content.includes("'/verify-email/resend'")) {
  content = content.replace(target, replacement);
  fs.writeFileSync(csrfPath, content, 'utf8');
  console.log('Successfully updated csrf.js with /verify-email exemptions');
} else {
  console.log('Target not found or already updated in csrf.js');
}
