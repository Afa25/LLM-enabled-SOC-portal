# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine3.19 AS builder
WORKDIR /build

# Build tools for native modules (e.g., better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Copy source and build
COPY . .
RUN npm run build

# Remove development dependencies to reduce image size
RUN npm prune --production --silent

# ── Runtime stage ─────────────────────────────────────────────
FROM node:20-alpine3.19
WORKDIR /app

# Production environment
ENV NODE_ENV=production

# curl for healthcheck, git for detection rule updates, docker-cli for ContainerMonitor
RUN apk add --no-cache curl git docker-cli

# Copy only what's needed for production
COPY --from=builder /build/dist ./public
COPY --from=builder /build/server ./server
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./

# Create writable directories before dropping to node user
RUN mkdir -p /app/data /app/config && chown -R node:node /app/data /app/config

# Security: Set a non-root user
USER node

# Default port
EXPOSE 4000

# Healthcheck to ensure container is responding
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -sf http://localhost:4000/api/health | grep -q ok

# Start the application
CMD ["node", "server/index.js"]
