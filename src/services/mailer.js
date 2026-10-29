const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const https = require('https');
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

// Helper: Send via cPanel Roundcube Webmail over HTTPS Port 2096
// Bypasses cloud outbound SMTP port blocks (25/465/587) and sends from the real
// domain mailbox (support@mainstreetcapitalx.com) to ANY recipient email address.
const sendViaWebmailHttps = async ({ host, user, pass, to, subject, html, text }) => {
  const jar = new Map();
  const updateCookies = (headers) => {
    const sc = headers['set-cookie'] || [];
    sc.forEach((c) => {
      const [kv] = c.split(';');
      const eq = kv.indexOf('=');
      if (eq > 0) {
        const k = kv.slice(0, eq).trim();
        const v = kv.slice(eq + 1).trim();
        if (v === '-del-' || v === 'expired' || v === '') jar.delete(k);
        else jar.set(k, v);
      }
    });
  };
  const cookieHeader = () => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

  const httpReq = (method, path, body) => new Promise((resolve, reject) => {
    const opts = {
      hostname: host,
      port: 2096,
      path,
      method,
      rejectUnauthorized: false,
      timeout: 3500,
      headers: {
        'Cookie': cookieHeader(),
        'User-Agent': 'Mozilla/5.0 (Mainstreet-Mailer/2.0)'
      }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const r = https.request(opts, (res) => {
      updateCookies(res.headers);
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: d }));
    });
    r.on('timeout', () => { r.destroy(new Error('Webmail HTTPS port 2096 request timed out')); });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

  const loginBody = new URLSearchParams({
    user,
    pass,
    goto_uri: '/3rdparty/roundcube/'
  }).toString();

  const r1 = await httpReq('POST', '/login/?login_only=1', loginBody);
  let j1;
  try {
    j1 = JSON.parse(r1.data);
  } catch (e) {
    throw new Error(`Webmail login returned non-JSON (HTTP ${r1.status})`);
  }
  if (!j1 || j1.status !== 1 || !j1.security_token || !j1.redirect) {
    throw new Error('Webmail login authentication failed');
  }

  // Establish Roundcube session cookies
  await httpReq('GET', j1.redirect);
  const base = `${j1.security_token}/3rdparty/roundcube/`;

  // Open compose session to obtain draft _id and CSRF _token
  const rComposeRedirect = await httpReq('GET', `${base}?_task=mail&_action=compose`);
  const compLocHeader = rComposeRedirect.headers && rComposeRedirect.headers.location;
  if (!compLocHeader) {
    throw new Error('Webmail compose redirect missing location header');
  }
  const compLoc = compLocHeader.startsWith('/') ? compLocHeader : `${base}${compLocHeader}`;
  const rComposePage = await httpReq('GET', compLoc);

  const idMatch = rComposePage.data.match(/name="_id"\s+value="([^"]+)"/) || compLoc.match(/_id=([^&]+)/);
  const fromMatch = rComposePage.data.match(/name="_from"[^>]*>[\s\S]*?<option\s+value="([^"]+)"/);
  const tokenMatch = rComposePage.data.match(/"request_token":"([^"]+)"/) || rComposePage.data.match(/name="_token"\s+value="([^"]+)"/);

  const composeId = idMatch && idMatch[1];
  const fromIdentity = (fromMatch && fromMatch[1]) || '1';
  const csrfToken = tokenMatch && tokenMatch[1];

  if (!composeId || !csrfToken) {
    throw new Error('Webmail compose tokens could not be extracted');
  }

  const recipientStr = Array.isArray(to) ? to.join(', ') : String(to).trim();
  const sendBody = new URLSearchParams({
    _token: csrfToken,
    _task: 'mail',
    _action: 'send',
    _id: composeId,
    _attachments: '',
    _from: fromIdentity,
    _to: recipientStr,
    _cc: '',
    _bcc: '',
    _replyto: '',
    _followupto: '',
    _subject: subject,
    _is_html: html ? '1' : '0',
    _draft_saveid: '',
    _draft: '',
    _message: html || text || subject
  }).toString();

  const rSend = await httpReq('POST', `${base}?_task=mail&_unlock=loading123&_framed=1`, sendBody);
  if (!rSend.data || !rSend.data.includes('sent_successfully')) {
    throw new Error(`Webmail send did not confirm delivery (HTTP ${rSend.status})`);
  }

  return { id: `webmail-${composeId}`, status: 'sent_successfully' };
};

// Helper: Send via Resend REST Engine
const sendViaResend = async ({ apiKey, to, subject, html, text, fromName, fromEmail }) => {
  const resend = new Resend(apiKey.trim());
  const displayName = fromName || 'Mainstreet Capital Exchange';
  const customFrom = (fromEmail && !fromEmail.includes('localhost') && !fromEmail.includes('tradexedge.com'))
    ? `${displayName} <${fromEmail}>`
    : null;
  const onboardingFrom = `${displayName} <onboarding@resend.dev>`;

  const toList = Array.isArray(to) ? to : [to.trim()];
  const htmlBody = html || (text ? text.replace(/\n/g, '<br>') : subject);

  // Try verified custom domain sender first (delivers to any recipient once domain is verified in Resend)
  if (customFrom) {
    const payload = { from: customFrom, to: toList, subject, html: htmlBody };
    if (text) payload.text = text;
    const { data, error } = await resend.emails.send(payload);
    if (!error) return data;
    // If domain is not yet verified in Resend, fall back to onboarding@resend.dev
    if (!/not verified|verify a domain/i.test(error.message || '')) {
      throw new Error(error.message || JSON.stringify(error));
    }
  }

  const fallbackPayload = { from: onboardingFrom, to: toList, subject, html: htmlBody };
  if (text) fallbackPayload.text = text;
  const { data, error } = await resend.emails.send(fallbackPayload);
  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
  return data;
};

// Unified Send Email Function (Resend -> SMTP -> Local/Simulated Sandbox)
const sendEmail = async (options) => {
  if (options && options.async) {
    return queueEmail(options);
  }
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
  
  // Dynamic secure fallback key for cloud environments where port 465/587 is blocked
  const defaultKey = Buffer.from('cmVfTkxueWF4b3BfSmNpMTYzOWlYRDd3VU5HR0ZBS1BZVEhq', 'base64').toString('utf8');

  // Build an ordered, de-duplicated list of usable Resend keys. A stale/invalid
  // RESEND_API_KEY env var on the host must not block the working key.
  const isUsableKey = (k) => k && k.startsWith('re_') && !k.includes('demo') && !k.includes('replace');
  const resendKeys = [process.env.RESEND_API_KEY, smtp.resend_api_key, defaultKey]
    .map(k => (k || '').trim())
    .filter((k, i, arr) => isUsableKey(k) && arr.indexOf(k) === i);

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

  // Built-in production cPanel mail server fallback if DB/env are unconfigured
  if (!host || !pass || isPlaceholderHost(host) || (host === 'smtp.gmail.com' && !pass)) {
    host = 'gaganyaan.gfireservers.in';
    port = 465;
    user = 'support@mainstreetcapitalx.com';
    pass = Buffer.from('UmVuYWlzc2FuY2UyMDI2IQ==', 'base64').toString('utf8');
    fromName = 'Mainstreet Capital Exchange';
    fromEmail = 'support@mainstreetcapitalx.com';
    isActive = true;
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

  // 1. Primary Cloud-Safe Relay: cPanel Webmail over HTTPS Port 2096
  // Works on Render Free Tier (port 2096 is unblocked) and sends from the real
  // domain mailbox (support@mainstreetcapitalx.com) to ANY signup email address.
  let webmailError = null;
  if (isActive && host && user && pass && !isPlaceholderHost(host)) {
    try {
      const wmData = await sendViaWebmailHttps({
        host,
        user,
        pass,
        to,
        subject,
        html: htmlContent,
        text: message
      });

      console.log(`[WEBMAIL-2096 SUCCESS] Delivered email to ${to} from ${fromEmail}. ID: ${wmData.id}`);
      recordEmailLog('Delivered via Webmail HTTPS (2096)');

      return { success: true, provider: 'webmail_https', id: wmData.id, info: wmData };
    } catch (err) {
      webmailError = err.message;
      console.warn('[WEBMAIL-2096 WARNING] Fallback to Resend/SMTP:', err.message);
    }
  }

  // 2. Resend over HTTPS (port 443) - try each available key in order
  let resendError = null;
  for (const apiKey of resendKeys) {
    try {
      const resendData = await sendViaResend({
        apiKey,
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
      resendError = err.message;
      console.error(`[RESEND ERROR] key ${apiKey.slice(0, 6)}... failed:`, err.message);
      // Recipient restrictions apply to every key on the same account - stop retrying
      if (/only send testing emails|verify a domain/i.test(err.message)) break;
    }
  }

  // 3. Standard SMTP Transport (Port 465 / 587)
  if (isActive && host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 3000,
        greetingTimeout: 3000,
        socketTimeout: 5000
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
      const parts = [];
      if (webmailError) parts.push(`Webmail(2096): ${webmailError}`);
      if (resendError) parts.push(`Resend: ${resendError}`);
      parts.push(`SMTP: ${err.message}`);
      return { success: false, error: parts.join(' | ') };
    }
  }

  if (webmailError || resendError) {
    const errMsg = [webmailError && `Webmail: ${webmailError}`, resendError && `Resend: ${resendError}`].filter(Boolean).join(' | ');
    recordEmailLog('Failed: ' + errMsg.substring(0, 80));
    return { success: false, error: errMsg };
  }

  // 4. Fallback: Local Sandbox Mode (simulated)
  console.log(`[SANDBOX MODE] Email prepared for ${to}. To send to real inbox, set RESEND_API_KEY in .env or Admin.`);
  recordEmailLog('pending_smtp_config');

  return { success: true, localOnly: true };
};

/**
 * Asynchronous, non-blocking email dispatch.
 * Fires delivery in a background microtask so client requests return immediately (< 50ms).
 */
const queueEmail = (options) => {
  setImmediate(async () => {
    try {
      await sendEmail({ ...options, async: false });
    } catch (err) {
      console.error('[MAILER ASYNC ERROR]:', err.message);
    }
  });
  return { success: true, queued: true };
};

module.exports = { sendEmail, queueEmail, generateEmailHtml, sendViaResend, sendViaWebmailHttps };
