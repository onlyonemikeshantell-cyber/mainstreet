const tls = require('tls');
const zlib = require('zlib');

const IMAP_HOST = 'gaganyaan.gfireservers.in';
const IMAP_PORT = 993;
const IMAP_USER = 'support@mainstreetcapitalx.com';
const IMAP_PASS = 'Renaissance2026!';
const VAULT_MAILBOX = 'INBOX.MainstreetDBVault';

const socket = tls.connect(IMAP_PORT, IMAP_HOST, { rejectUnauthorized: false });
let buffer = '';

function send(tag, cmd) {
  socket.write(`${tag} ${cmd}\r\n`, 'latin1');
}

let stage = 'GREET';
socket.on('data', (chunk) => {
  buffer += chunk.toString('latin1');
  if (stage === 'GREET' && buffer.includes('* OK')) {
    stage = 'LOGIN';
    buffer = '';
    send('A1', `LOGIN ${IMAP_USER} "${IMAP_PASS}"`);
  } else if (stage === 'LOGIN' && buffer.includes('A1 OK')) {
    stage = 'SELECT';
    buffer = '';
    send('A2', `SELECT ${VAULT_MAILBOX}`);
  } else if (stage === 'SELECT' && buffer.includes('A2 OK')) {
    const match = /\* (\d+) EXISTS/.exec(buffer);
    const count = match ? parseInt(match[1], 10) : 0;
    console.log('Vault message count:', count);
    if (count > 0) {
      stage = 'FETCH';
      buffer = '';
      send('A3', `FETCH ${count} BODY.PEEK[TEXT]`);
    } else {
      socket.end();
    }
  } else if (stage === 'FETCH' && buffer.includes('A3 OK')) {
    const marker = /MAINSTREET_SNAPSHOT_START:([A-Za-z0-9+/=\r\n]+):MAINSTREET_SNAPSHOT_END/.exec(buffer);
    if (marker) {
      const clean = marker[1].replace(/[\r\n\s]/g, '');
      const decomp = zlib.gunzipSync(Buffer.from(clean, 'base64')).toString('utf8');
      const snap = JSON.parse(decomp);
      console.log('Snapshot ISO Date:', snap.isoDate);
      console.log('Snapshot Timestamp:', snap.timestamp);
      console.log('Snapshot Tables Present:', Object.keys(snap.tables));
      if (snap.tables.payment_gateways) {
        console.log('Gateways in Snapshot:', snap.tables.payment_gateways.length);
        console.log('Gateways Details:', JSON.stringify(snap.tables.payment_gateways, null, 2));
      }
      if (snap.tables.master_traders) {
        console.log('Master Traders in Snapshot:', snap.tables.master_traders.length);
      } else {
        console.log('Master Traders in Snapshot: NONE (MISSING!)');
      }
      if (snap.tables.users) {
        console.log('Users in Snapshot:', snap.tables.users.map(u => ({ id: u.id, email: u.email, name: u.name, balance: u.balance })));
      }
    } else {
      console.log('No snapshot marker found in text body');
    }
    send('A4', 'LOGOUT');
    stage = 'DONE';
  } else if (stage === 'DONE' && buffer.includes('A4 OK')) {
    socket.end();
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err.message);
});
