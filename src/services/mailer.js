const nodemailer = require('nodemailer');
const db = require('../db');

// Generate Branded HTML Template
const generateEmailHtml = (subject, content, recipientName = 'Valued Trader') => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #0D0F14; color: #EDEDED; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #161A23; border: 1px solid #2A2F36; border-radius: 12px; overflow: hidden; }
        .header { background: #0D0F14; padding: 25px; text-align: center; border-bottom: 1px solid #2A2F36; }
        .logo { max-height: 42px; width: auto; }
        .body { padding: 30px 25px; line-height: 1.6; color: #EDEDED; font-size: 15px; }
        .badge { display: inline-block; background: rgba(201,166,70,0.15); border: 1px solid #C9A646; color: #C9A646; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; }
        .btn { display: inline-block; background: #C9A646; color: #0D0F14; font-weight: bold; text-decoration: none; padding: 12px 25px; border-radius: 6px; margin-top: 20px; font-size: 14px; }
        .footer { background: #0D0F14; padding: 20px; text-align: center; font-size: 12px; color: #6B7280; border-top: 1px solid #2A2F36; }
        .footer a { color: #C9A646; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="https://tradexedge.com/storage/app/public/photos/SLfEn83lBAqk2U2WwdHJPMComgTWIXz2W6sWsvIj.png" alt="TradexEdge" class="logo" />
        </div>
        <div class="body">
          <div class="badge">Official Desk Communication</div>
          <h2 style="color: #C9A646; margin-top: 0;">${subject}</h2>
          <p>Hello <strong>${recipientName}</strong>,</p>
          <div>${content.replace(/\n/g, '<br>')}</div>
          <div style="text-align: center; margin-top: 25px;">
            <a href="http://localhost:3333/dashboard" class="btn">Open Trading Terminal</a>
          </div>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} TradexEdge. Institutional High-Speed Execution.<br>
          If you have questions, please contact our 24/7 Desk at <a href="mailto:support@tradexedge.com">support@tradexedge.com</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

const sendEmail = async ({ to, subject, message, recipientType = 'direct' }) => {
  const smtp = db.prepare('SELECT * FROM smtp_settings ORDER BY id DESC LIMIT 1').get();
  const fromName = smtp ? smtp.from_name : 'TradexEdge Support';
  const fromEmail = smtp ? smtp.from_email : 'support@tradexedge.com';

  const html = generateEmailHtml(subject, message, to.split('@')[0]);

  let deliveryStatus = 'Delivered (Simulated)';

  // If real SMTP is configured and active, attempt real SMTP dispatch
  if (smtp && smtp.is_active && smtp.user && smtp.pass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: {
          user: smtp.user,
          pass: smtp.pass
        }
      });

      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        text: message,
        html
      });
      deliveryStatus = 'Delivered via SMTP';
    } catch (err) {
      console.error('SMTP Delivery error:', err.message);
      deliveryStatus = 'Queued / Failed SMTP: ' + err.message.substring(0, 50);
    }
  }

  // Record in database log
  db.prepare(`
    INSERT INTO email_logs (recipient, recipient_type, subject, message, sender_email, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(to, recipientType, subject, message, fromEmail, deliveryStatus);

  return { success: true, status: deliveryStatus };
};

module.exports = { sendEmail, generateEmailHtml };
