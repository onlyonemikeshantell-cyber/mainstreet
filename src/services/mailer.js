const { Resend } = require('resend');
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
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #080A0D; color: #F8FAFC; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #11151B; border: 1px solid #1E2530; border-radius: 16px; overflow: hidden; }
        .header { background: #0D1015; padding: 25px; text-align: center; border-bottom: 1px solid #1E2530; }
        .logo { max-height: 42px; width: auto; }
        .body { padding: 30px 25px; line-height: 1.6; color: #F8FAFC; font-size: 14px; }
        .badge { display: inline-block; background: rgba(2,132,199,0.15); border: 1px solid rgba(2,132,199,0.3); color: #38BDF8; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; font-family: monospace; }
        .btn { display: inline-block; background: #0284C7; color: #ffffff; font-weight: bold; text-decoration: none; padding: 12px 25px; border-radius: 8px; margin-top: 20px; font-size: 13px; font-family: monospace; }
        .footer { background: #080A0D; padding: 20px; text-align: center; font-size: 11px; color: #64748B; border-top: 1px solid #1E2530; }
        .footer a { color: #38BDF8; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <table role="presentation" style="margin: 0 auto; border-collapse: collapse;">
            <tr>
              <td style="vertical-align: middle; padding-right: 10px;">
                <img src="https://pope-portfolio-sum-extraordinary.trycloudflare.com/img/brand/mainstreet-logo.png" alt="Mainstreet Capital Exchange" style="height: 36px; width: 36px; object-fit: contain; display: block;" />
              </td>
              <td style="vertical-align: middle; text-align: left;">
                <span style="color: #38BDF8; font-size: 18px; font-weight: 800; font-family: monospace; letter-spacing: -0.5px; display: block; line-height: 1.1;">MAINSTREET CAPITAL</span>
                <span style="color: #94A3B8; font-size: 10px; font-family: monospace; letter-spacing: 1px; text-transform: uppercase;">EXCHANGE GLOBAL DESK</span>
              </td>
            </tr>
          </table>
        </div>
        <div class="body">
          <div class="badge">Official Desk Communication</div>
          <h2 style="color: #F8FAFC; margin-top: 0; font-size: 18px;">${subject}</h2>
          <p>Hello <strong>${recipientName}</strong>,</p>
          <div>${(content || '').replace(/\n/g, '<br>')}</div>
          <div style="text-align: center; margin-top: 25px;">
            <a href="https://pope-portfolio-sum-extraordinary.trycloudflare.com/dashboard" class="btn">Open Trading Terminal &rarr;</a>
          </div>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} MAINSTREET CAPITAL EXCHANGE Global Markets Ltd. Institutional Multi-Asset Execution.<br>
          If you have questions, please contact our 24/7 Desk at <a href="mailto:support@mainstreetcapitalexchange.com">support@mainstreetcapitalexchange.com</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Helper: Send via Resend REST Engine
const sendViaResend = async ({ apiKey, to, subject, html, text, fromName, fromEmail }) => {
  const resend = new Resend(apiKey.trim());
  const from = (fromEmail && !fromEmail.includes('localhost') && !fromEmail.includes('tradexedge.com') && !fromEmail.includes('mainstreetcapitalexchange.com'))
    ? `${fromName || 'Mainstreet Capital Exchange'} <${fromEmail}>`
    : `${fromName || 'Mainstreet Capital Exchange'} <onboarding@resend.dev>`;

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to.trim()],
    subject,
    html: html || (text ? text.replace(/\n/g, '<br>') : subject)
  };
  if (text) payload.text = text;

  const { data, error } = await resend.emails.send(payload);
  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
  return data;
};

// Unified Send Email Function (Resend -> SMTP -> Local/Simulated Sandbox)
const sendEmail = async (options) => {
  // Support both sendEmail({ to, subject, ... }) and legacy sendEmail(to, subject, html)
  let to, subject, message, html, recipientType;
  if (typeof options === 'string') {
    to = arguments[0];
    subject = arguments[1];
    html = arguments[2];
    message = '';
    recipientType = 'direct';
  } else {
    to = options.to;
    subject = options.subject;
    message = options.message || '';
    html = options.html || null;
    recipientType = options.recipientType || 'direct';
  }

  const smtp = db.prepare('SELECT * FROM smtp_settings ORDER BY id DESC LIMIT 1').get() || {};
  const resendApiKey = (process.env.RESEND_API_KEY || smtp.resend_api_key || '').trim();
  const host = (process.env.SMTP_HOST || smtp.host || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT || smtp.port) || 587;
  const user = (process.env.SMTP_USER || smtp.user || '').trim();
  const pass = (process.env.SMTP_PASS || smtp.pass || '').trim();
  const fromName = process.env.SMTP_FROM_NAME || smtp.from_name || 'Mainstreet Capital Exchange Support';
  const fromEmail = (process.env.SMTP_FROM_EMAIL || smtp.from_email || user || 'support@mainstreetcapitalexchange.com').trim();
  const isActive = (process.env.SMTP_ACTIVE === 'true' || process.env.SMTP_ACTIVE === '1') || !!smtp.is_active;

  const htmlContent = html || generateEmailHtml(subject, message, to.split('@')[0]);

  // 1. Prioritize Resend when API key is provided
  if (resendApiKey) {
    try {
      const resendData = await sendViaResend({
        apiKey: resendApiKey,
        to,
        subject,
        html: htmlContent,
        text: message,
        fromName,
        fromEmail
      });

      console.log(`[RESEND SUCCESS] Dispatched email to ${to}. Message ID: ${resendData.id}`);
      db.prepare(`
        INSERT INTO email_logs (recipient, recipient_type, subject, message, sender_email, status)
        VALUES (?, ?, ?, ?, ?, 'Delivered via Resend')
      `).run(to, recipientType, subject, message || htmlContent, fromEmail);

      return { success: true, provider: 'resend', id: resendData.id, info: resendData };
    } catch (err) {
      console.error('[RESEND ERROR] Dispatch failed:', err.message);
      // If SMTP is not configured, record failure and return
      if (!isActive || !user || !pass) {
        db.prepare(`
          INSERT INTO email_logs (recipient, recipient_type, subject, message, sender_email, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(to, recipientType, subject, message || htmlContent, fromEmail, 'Failed Resend: ' + err.message.substring(0, 80));
        return { success: false, error: 'Resend Error: ' + err.message };
      }
      console.log('[MAILER] Falling back to standard SMTP transport...');
    }
  }

  // 2. Standard SMTP Transport
  if (isActive && host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: { rejectUnauthorized: false }
      });

      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        text: message,
        html: htmlContent
      });

      console.log(`[SMTP SUCCESS] Delivered email to ${to} via SMTP.`);
      db.prepare(`
        INSERT INTO email_logs (recipient, recipient_type, subject, message, sender_email, status)
        VALUES (?, ?, ?, ?, ?, 'Delivered via SMTP')
      `).run(to, recipientType, subject, message || htmlContent, fromEmail);

      return { success: true, provider: 'smtp', id: info.messageId, info };
    } catch (err) {
      console.error('[SMTP ERROR] Dispatch error:', err.message);
      db.prepare(`
        INSERT INTO email_logs (recipient, recipient_type, subject, message, sender_email, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(to, recipientType, subject, message || htmlContent, fromEmail, 'Failed SMTP: ' + err.message.substring(0, 80));
      return { success: false, error: 'SMTP Error: ' + err.message };
    }
  }

  // 3. Fallback: Local Sandbox Mode (simulated)
  console.log(`[SANDBOX MODE] Email prepared for ${to}. To send to real inbox, set RESEND_API_KEY in .env or Admin.`);
  db.prepare(`
    INSERT INTO email_logs (recipient, recipient_type, subject, message, sender_email, status)
    VALUES (?, ?, ?, ?, ?, 'pending_smtp_config')
  `).run(to, recipientType, subject, message || htmlContent, fromEmail);

  return { success: true, localOnly: true };
};

module.exports = { sendEmail, generateEmailHtml, sendViaResend };
