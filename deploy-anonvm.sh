#!/bin/bash
# ==============================================================================
# TradexEdge Production Deployment Script for AnonVM.wtf (Ubuntu / Debian)
# ==============================================================================

set -e

echo "=================================================="
echo "🚀 Starting TradexEdge Production Deployment..."
echo "=================================================="

# 1. Update OS packages
apt-get update && apt-get upgrade -y

# 2. Install essential build tools & dependencies
apt-get install -y curl git build-essential nginx certbot python3-certbot-nginx ufw

# 3. Install Node.js LTS (v20.x)
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js v20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# 4. Install PM2 Process Manager globally
npm install -g pm2

# 5. Install project dependencies
echo "📦 Installing application dependencies..."
npm install --production

# 6. Ensure data and storage directories exist
mkdir -p data public/storage/kyc

# 7. Start application via PM2
pm2 stop tradexedge 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root || true

# 8. Configure Firewall (UFW)
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=================================================="
echo "✅ TradexEdge is LIVE on port 3333!"
echo "PM2 Status:"
pm2 status
echo "=================================================="
