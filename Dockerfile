FROM node:20-bullseye-slim

# Install system dependencies required for native better-sqlite3 compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Ensure storage and data directories exist
RUN mkdir -p data storage/kyc public/uploads/avatars

# Expose default port
EXPOSE 3333

ENV NODE_ENV=production
ENV PORT=3333

# Start Node.js server
CMD ["npm", "start"]
