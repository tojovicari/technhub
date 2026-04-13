# ── builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy manifests first for layer caching
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/

RUN npm ci --workspace=apps/api --include-workspace-root

# Copy source
COPY apps/api ./apps/api

# Generate Prisma client and compile TypeScript
RUN npm run api:prisma:generate
RUN npm run api:build

# ── runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/

RUN npm ci --workspace=apps/api --include-workspace-root --omit=dev

# Compiled JS
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Prisma schema (needed by migrate deploy at runtime)
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# Generated Prisma client
COPY --from=builder /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma

EXPOSE 3000

CMD ["node", "apps/api/dist/server.js"]
