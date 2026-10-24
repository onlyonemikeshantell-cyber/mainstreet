const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const db = require('../db');

// Generate Branded HTML Template
const generateEmailHtml = (subject, content, recipientName = 'Valued Trader') => {
  const appBaseUrl = process.env.APP_URL || 'https://mainstreetcapitalx.com';
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
                <img src="${appBaseUrl}/img/brand/mainstreet-logo.png" alt="Mainstreet Capital Exchange" style="height: 36px; width: 36px; object-fit: contain; display: block;" />
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
            <a href="${appBaseUrl}/dashboard" class="btn">Open Trading Terminal &rarr;</a>
          </div>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} MAINSTREET CAPITAL EXCHANGE Global Markets Ltd. Institutional Multi-Asset Execution.<br>
          If you have questions, please contact our 24/7 Desk at <a href="mailto:support@mainstreetcapitalx.com">support@mainstreetcapitalx.com</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Helper: Send via Resend REST Engine
const sendViaResend = async ({ apiKey, to, subject, html, text, fromName, fromEmail }) => {
  const resend = new Resend(apiKey.trim());
  const from = (fromEmail && !fromEmail.includes('localhost') && !fromEmail.includes('tradexedge.com') && !fromEmail.includes('mainstreetcapitalx.com'))
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
  
  // Filter out placeholder / demo Resend API keys
  let resendApiKey = (process.env.RESEND_API_KEY || smtp.resend_api_key || '').trim();
  if (resendApiKey.includes('demo') || resendApiKey.includes('replace') || !resendApiKey.startsWith('re_')) {
    resendApiKey = '';
  }

  // Helper to detect non-functional dummy host placeholders in .env
  const isPlaceholderHost = (h) => !h || h.includes('example.com') || h === 'smtp.mainstreetcapitalx.com' || h === 'localhost';

  // Prioritize active database SMTP credentials (e.g. cPanel / live server)
  let host = (smtp.host || '').trim();
  let port = parseInt(smtp.port) || 465;
  let user = (smtp.user || '').trim();
  let pass = (smtp.pass || '').trim();
  let fromName = (smtp.from_name || 'Mainstreet Capital Exchange Support').trim();
  let fromEmail = (smtp.from_email || user || 'support@mainstreetcapitalx.com').trim();
  let isActive = !!smtp.is_active;

  // Fallback to process.env only if DB credentials are missing or env has real custom overrides
  if ((!host || !pass || isPlaceholderHost(host)) && process.env.SMTP_HOST && !isPlaceholderHost(process.env.SMTP_HOST)) {
    host = process.env.SMTP_HOST.trim();
    port = parseInt(process.env.SMTP_PORT) || 587;
    user = (process.env.SMTP_USER || '').trim();
    pass = (process.env.SMTP_PASS || '').trim();
    fromName = (process.env.SMTP_FROM_NAME || fromName).trim();
    fromEmail = (process.env.SMTP_FROM_EMAIL || fromEmail).trim();
    isActive = (process.env.SMTP_ACTIVE === 'true' || process.env.SMTP_ACTIVE === '1');
  }

  const htmlContent = html || generateEmailHtml(subject, message, to.split('@')[0]);

  const recordEmailLog = (status) => {
    try {
      db.prepare(`
        INSERT INTO email_logs (recipient, recipient_type, subject, message, sender_email, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(to, recipientType, subject, message || htmlContent, fromEmail, status);
    } catch (e) {
      try {
        db.prepare(`
          INSERT INTO email_logs (recipient, recipient_type, subject, message, status)
          VALUES (?, ?, ?, ?, ?)
        `).run(to, recipientType, subject, message || htmlContent, status);
      } catch (err2) {
        console.warn('[MAILER LOG WARNING]', err2.message);
      }
    }
  };

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
      recordEmailLog('Delivered via Resend');

      return { success: true, provider: 'resend', id: resendData.id, info: resendData };
    } catch (err) {
      console.error('[RESEND ERROR] Dispatch failed:', err.message);
      // If SMTP is not configured, record failure and return
      if (!isActive || !user || !pass) {
        recordEmailLog('Failed Resend: ' + err.message.substring(0, 80));
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
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });

      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        text: message,
        html: htmlContent
      });

      console.log(`[SMTP SUCCESS] Delivered email to ${to} via SMTP.`);
      recordEmailLog('Delivered via SMTP');

      return { success: true, provider: 'smtp', id: info.messageId, info };
    } catch (err) {
      console.error('[SMTP ERROR] Dispatch error:', err.message);
      recordEmailLog('Failed SMTP: ' + err.message.substring(0, 80));
      return { success: false, error: 'SMTP Error: ' + err.message };
    }
  }

  // 3. Fallback: Local Sandbox Mode (simulated)
  console.log(`[SANDBOX MODE] Email prepared for ${to}. To send to real inbox, set RESEND_API_KEY in .env or Admin.`);
  recordEmailLog('pending_smtp_config');

  return { success: true, localOnly: true };
};

module.exports = { sendEmail, generateEmailHtml, sendViaResend };
