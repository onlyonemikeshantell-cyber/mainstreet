const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'src', 'views', 'app', 'admin.ejs');
let content = fs.readFileSync(targetPath, 'utf8');

const replacements = [
  // Flash messages
  {
    from: /<span>⚠️<\/span>/g,
    to: '<svg class="w-4 h-4 text-amber-400 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
  },
  {
    from: /<span>✓<\/span>/g,
    to: '<svg class="w-4 h-4 text-emerald-400 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
  },
  {
    from: />\s*✓\s*All Clear/g,
    to: '>All Clear'
  },
  {
    from: />✓ TIER 1</g,
    to: '>TIER 1<'
  },

  // Confirmation messages
  {
    from: /'⚠️ Are you sure/g,
    to: '\'Are you sure'
  },

  // Thumbnail preview
  {
    from: /<span class="absolute inset-0 bg-black\/50 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl text-white text-\[10px\] font-bold transition">🔍<\/span>/g,
    to: '<span class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl text-white text-xs font-bold transition"><svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg></span>'
  },

  // Modals: Inject STP Trade
  {
    from: /<span class="text-lg">📈<\/span>/g,
    to: '<svg class="w-4 h-4 inline mr-1 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>'
  },
  {
    from: /<span class="text-lg">📉<\/span>/g,
    to: '<svg class="w-4 h-4 inline mr-1 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"/></svg>'
  },
  {
    from: />\s*<span>⚡ Execute & Align Trades<\/span>/g,
    to: '><svg class="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg><span>Execute & Align Trades</span>'
  },

  // Set Balance Modal
  {
    from: />\s*💰\s*<\/div>/g,
    to: '><svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>'
  },
  {
    from: />\s*✓\s*Live Market Auto-Sync/g,
    to: '>Live Market Auto-Sync'
  },
  {
    from: />\s*✓\s*Live Market Value Sync/g,
    to: '>Live Market Value Sync'
  },
  {
    from: />\s*✓\s*Instant Atomic Recalculation/g,
    to: '>Instant Atomic Recalculation'
  },
  {
    from: /<span>☀️<\/span>/g,
    to: '<span class="font-mono text-[10px] font-bold text-[#14F195]">SOL</span>'
  },
  {
    from: /<span>✕<\/span>/g,
    to: '<span class="font-mono text-[10px] font-bold text-sky-400">XRP</span>'
  },
  {
    from: /<span>🐕<\/span>/g,
    to: '<span class="font-mono text-[10px] font-bold text-amber-400">DOGE</span>'
  },
  {
    from: /<span>🔺<\/span>/g,
    to: '<span class="font-mono text-[10px] font-bold text-rose-500">AVAX</span>'
  },
  {
    from: /<span>🔗<\/span>/g,
    to: '<span class="font-mono text-[10px] font-bold text-blue-500">LINK</span>'
  },
  {
    from: /<span>🌊<\/span>/g,
    to: '<span class="font-mono text-[10px] font-bold text-cyan-400">SUI</span>'
  },
  {
    from: /<span>💎<\/span>/g,
    to: '<span class="font-mono text-[10px] font-bold text-sky-300">TON</span>'
  },
  {
    from: /<span>🐸<\/span>/g,
    to: '<span class="font-mono text-[10px] font-bold text-emerald-400">PEPE</span>'
  },
  {
    from: /showPass \? '🙈 Hide' : '👁️ Spy'/g,
    to: 'showPass ? \'Hide Password\' : \'Reveal Password\''
  },

  // KYC Modal
  {
    from: /✕ Reject Document/g,
    to: 'Reject Document'
  },
  {
    from: /✓ Approve & Verify Trader/g,
    to: 'Approve & Verify Trader'
  },
  {
    from: /<span class="w-10 h-10 rounded-2xl bg-primary\/10 text-primary flex items-center justify-center text-xl font-bold">💰<\/span>/g,
    to: '<div class="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shadow-md"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>'
  },
  {
    from: /<span>💵 USD Cash \/ Deposit Balance<\/span>/g,
    to: '<span>USD Cash / Custody Balance</span>'
  },
  {
    from: /<span class="text-\[#14F195\]">☀️ Solana \(SOL\)<\/span>/g,
    to: '<span class="text-[#14F195] font-mono font-bold">Solana (SOL)</span>'
  },
  {
    from: /<span class="text-\[#23292F\]">✕ Ripple \(XRP\)<\/span>/g,
    to: '<span class="text-sky-400 font-mono font-bold">Ripple (XRP)</span>'
  },
  {
    from: /<div class="w-10 h-10 rounded-2xl bg-primary\/10 flex items-center justify-center text-primary text-xl font-bold">🛡️<\/div>/g,
    to: '<div class="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg></div>'
  },
  {
    from: /<span>⚡ DIDIT AI/g,
    to: '<span>DIDIT AI'
  },
  {
    from: /📁 Manual Upload \(Backup\)/g,
    to: 'Manual Upload (Backup)'
  },
  {
    from: />🔍 Enlarge<\/button>/g,
    to: '>Enlarge Preview</button>'
  },
  {
    from: /<span>⚡<\/span>\s*<span>Test Copy Flow<\/span>/g,
    to: '<svg class="w-3.5 h-3.5 inline mr-1 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg><span>Test Copy Flow</span>'
  },
  {
    from: /<span>⚡<\/span>\s*<span>([A-Za-z0-9\s]+)<\/span>\s*<\/p>/g,
    to: '<span class="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block mr-1"></span><span>$1</span></p>'
  }
];

replacements.forEach(r => {
  content = content.replace(r.from, r.to);
});

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Complete emoji purge finished.');
