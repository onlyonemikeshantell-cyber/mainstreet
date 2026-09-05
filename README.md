# TradeXEdge — Multi-Asset Trading Platform (Atom-for-Atom Clone)

A full-stack, institutional-grade multi-asset trading platform cloned 1:1 atom-for-atom from **tradexedge.com**.

---

## 🚀 Active Live Server

The server is actively running in the background at:
👉 **[http://localhost:3333](http://localhost:3333)**

---

## 🎨 Frontend Architecture
- **Exact UI & Palette**: Faithfully replicated using Tailwind CSS custom colors (`#0D0F14` surface base, `#161A23` raised, `#1C2127` overlay, `#2A2F36` border, `#C9A646` primary gold) and typography (`Poppins`, `Merriweather`).
- **Reactive Interactions**: Powered by Alpine.js for dropdown menus, auto-rotating hero sliders, tab switchers, mobile navigation drawer, real-time calculation modals, and interactive order submission.
- **Embedded Trading Engines**: Live TradingView Ticker Tape, Advanced Real-Time Charting Station, Market Screener, and Depth-of-Market widgets.
- **Brand & Vector Assets**: Localized vector SVGs, partner badges (AWS, Cloudflare, Jumio, Ledger), and high-resolution trading desk visuals.

---

## ⚙️ Backend Architecture
- **Server**: Node.js & Express.js with session authentication (`express-session`), `bcryptjs` password hashing, dynamic CSRF validation, and flash message toasts.
- **Database**: SQLite (`database.sqlite`) via `better-sqlite3` in WAL mode for persistent, zero-configuration relational storage.
- **Live WebTrader Terminal**: Interactive trading station with live market simulation, order execution (`BUY`/`SELL` lots), real-time unrealized PnL calculation, and position liquidation.
- **Cashier System**: Instant deposits via Crypto (BTC, ETH, USDT), Bank Wire, or Cards, plus withdrawal requests with balance reconciliation.
- **Admin Control Center**: Oversight dashboard to manage user balances, review contact submissions, and audit platform transactions.

---

## 🔑 Default Accounts & Credentials

| Role | Email / Username | Password | Initial Balance |
| :--- | :--- | :--- | :--- |
| **Demo Trader** | `trader@tradexedge.com` / `trader` | `Trader123!` | $25,000.00 USD |
| **Administrator** | `admin@tradexedge.com` / `admin` | `Admin123!` | $50,000.00 USD |

---

## 💻 Running the Application Manually

1. **Navigate to the project directory**:
   ```bash
   cd "C:\Users\HP\.gemini\antigravity\scratch\tradexedge-clone"
   ```

2. **Start the application**:
   ```bash
   npm start
   ```

3. **Open in browser**:
   - Web Platform: [http://localhost:3333](http://localhost:3333)
   - Trader Dashboard: [http://localhost:3333/dashboard](http://localhost:3333/dashboard)
   - Live WebTrader Terminal: [http://localhost:3333/webtrade/app](http://localhost:3333/webtrade/app)
   - Admin Control Center: [http://localhost:3333/admin](http://localhost:3333/admin)
