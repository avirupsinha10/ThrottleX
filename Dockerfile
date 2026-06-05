# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
# Install all dependencies (including devDependencies for TypeScript compiler)
RUN npm ci && npm cache clean --force

COPY src ./src
RUN npx tsc

# ─── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Non-root user for least-privilege execution
RUN addgroup -g 1001 -S throttlex \
 && adduser  -u 1001 -S -G throttlex throttlex

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER throttlex

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
