# ─────────────────────────────────────────────────────────────────────────────
# DOCKERFILE - WhatsApp Connector (Cloud Run Ready)
# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build optimized for pnpm workspaces and monorepo architecture.
# 
# DESIGN DECISIONS:
# - Base: Node 20 Alpine (minimal, secure)
# - Build: Full monorepo build (all packages)
# - Runtime: Only whatsapp app + its workspace dependencies
# - Production: No devDependencies, pruned node_modules
#
# STAGES:
# 1. base       - Install pnpm
# 2. dependencies - Install ALL dependencies (including dev)
# 3. builder    - Build entire monorepo (tsc)
# 4. pruner     - Prune to production dependencies only
# 5. runner     - Final runtime image (minimal)
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 1: Base image with pnpm
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 2: Install ALL dependencies (including devDependencies for build)
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS dependencies

# Copy workspace configuration
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy all package.json files to establish workspace structure
COPY apps/whatsapp/package.json ./apps/whatsapp/
COPY apps/automation/package.json ./apps/automation/
COPY apps/calendar/package.json ./apps/calendar/
COPY apps/instagram/package.json ./apps/instagram/

COPY packages/adapter-express/package.json ./packages/adapter-express/
COPY packages/core-ads/package.json ./packages/core-ads/
COPY packages/core-auth/package.json ./packages/core-auth/
COPY packages/core-comments/package.json ./packages/core-comments/
COPY packages/core-connectors/package.json ./packages/core-connectors/
COPY packages/core-events/package.json ./packages/core-events/
COPY packages/core-logging/package.json ./packages/core-logging/
COPY packages/core-messaging/package.json ./packages/core-messaging/
COPY packages/core-meta-graph/package.json ./packages/core-meta-graph/
COPY packages/core-meta-instagram/package.json ./packages/core-meta-instagram/
COPY packages/core-meta-messenger/package.json ./packages/core-meta-messenger/
COPY packages/core-meta-whatsapp/package.json ./packages/core-meta-whatsapp/
COPY packages/core-rate-limit/package.json ./packages/core-rate-limit/
COPY packages/core-runtime/package.json ./packages/core-runtime/
COPY packages/core-signature/package.json ./packages/core-signature/
COPY packages/core-sync/package.json ./packages/core-sync/
COPY packages/core-tenant/package.json ./packages/core-tenant/
COPY packages/core-validation/package.json ./packages/core-validation/
COPY packages/core-webhooks/package.json ./packages/core-webhooks/

# Install all dependencies (including devDependencies needed for TypeScript build)
RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 3: Build entire monorepo
# ─────────────────────────────────────────────────────────────────────────────
FROM dependencies AS builder

# Copy TypeScript configs
COPY tsconfig.base.json ./

COPY apps/whatsapp/tsconfig.json apps/whatsapp/tsconfig.build.json ./apps/whatsapp/
COPY apps/automation/tsconfig.json apps/automation/tsconfig.build.json ./apps/automation/
COPY apps/calendar/tsconfig.json apps/calendar/tsconfig.build.json ./apps/calendar/
COPY apps/instagram/tsconfig.json apps/instagram/tsconfig.build.json ./apps/instagram/

COPY packages/adapter-express/tsconfig.json packages/adapter-express/tsconfig.build.json ./packages/adapter-express/
COPY packages/core-ads/tsconfig.json packages/core-ads/tsconfig.build.json ./packages/core-ads/
COPY packages/core-auth/tsconfig.json packages/core-auth/tsconfig.build.json ./packages/core-auth/
COPY packages/core-comments/tsconfig.json packages/core-comments/tsconfig.build.json ./packages/core-comments/
COPY packages/core-connectors/tsconfig.json packages/core-connectors/tsconfig.build.json ./packages/core-connectors/
COPY packages/core-events/tsconfig.json packages/core-events/tsconfig.build.json ./packages/core-events/
COPY packages/core-logging/tsconfig.json packages/core-logging/tsconfig.build.json ./packages/core-logging/
COPY packages/core-messaging/tsconfig.json packages/core-messaging/tsconfig.build.json ./packages/core-messaging/
COPY packages/core-meta-graph/tsconfig.json packages/core-meta-graph/tsconfig.build.json ./packages/core-meta-graph/
COPY packages/core-meta-instagram/tsconfig.json packages/core-meta-instagram/tsconfig.build.json ./packages/core-meta-instagram/
COPY packages/core-meta-messenger/tsconfig.json packages/core-meta-messenger/tsconfig.build.json ./packages/core-meta-messenger/
COPY packages/core-meta-whatsapp/tsconfig.json packages/core-meta-whatsapp/tsconfig.build.json ./packages/core-meta-whatsapp/
COPY packages/core-rate-limit/tsconfig.json packages/core-rate-limit/tsconfig.build.json ./packages/core-rate-limit/
COPY packages/core-runtime/tsconfig.json packages/core-runtime/tsconfig.build.json ./packages/core-runtime/
COPY packages/core-signature/tsconfig.json packages/core-signature/tsconfig.build.json ./packages/core-signature/
COPY packages/core-sync/tsconfig.json packages/core-sync/tsconfig.build.json ./packages/core-sync/
COPY packages/core-tenant/tsconfig.json packages/core-tenant/tsconfig.build.json ./packages/core-tenant/
COPY packages/core-validation/tsconfig.json packages/core-validation/tsconfig.build.json ./packages/core-validation/
COPY packages/core-webhooks/tsconfig.json packages/core-webhooks/tsconfig.build.json ./packages/core-webhooks/

# Copy source code
COPY apps/ ./apps/
COPY packages/ ./packages/

# Build all packages in dependency order
RUN pnpm --filter "@connectors/*" build
RUN pnpm --filter "@connectors/whatsapp-app" build

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 4: Prune to production dependencies only
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS pruner

# Copy built artifacts
COPY --from=builder /app ./

# Prune to production dependencies for whatsapp app
RUN pnpm --filter "@connectors/whatsapp-app" --prod deploy /prod/whatsapp

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 5: Final runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS runner

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy production dependencies and built code
COPY --from=pruner --chown=nodejs:nodejs /prod/whatsapp ./

USER nodejs

# Cloud Run automatically sets PORT env var
ENV NODE_ENV=production
EXPOSE 8080

# Health check (optional, Cloud Run has its own)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

CMD ["node", "dist/server.js"]
