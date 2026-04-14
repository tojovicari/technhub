# ── builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app/apps/api

# Install all deps (dev included for build tools)
COPY apps/api/package*.json ./
RUN npm ci

# Copy source and generate + compile
COPY apps/api .
RUN npx prisma generate && npm run build

# ── runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app/apps/api
ENV NODE_ENV=production

# Production deps only
COPY apps/api/package*.json ./
RUN npm ci --omit=dev

# Compiled JS
COPY --from=builder /app/apps/api/dist ./dist

# Prisma schema (needed by migrate deploy at runtime)
COPY --from=builder /app/apps/api/prisma ./prisma

# Generated Prisma client
COPY --from=builder /app/apps/api/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000

CMD ["node", "dist/server.js"]
