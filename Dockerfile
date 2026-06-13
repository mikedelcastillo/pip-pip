# syntax=docker/dockerfile:1

# ---- builder: install everything and run the full build pipeline ----
FROM node:22 AS builder
WORKDIR /app
RUN corepack enable
COPY . .
RUN yarn install --frozen-lockfile
RUN bash scripts/build.sh

# ---- runtime: lean image with only production deps + built output ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
# Manifests for a production-only install of the server and its workspace deps
COPY package.json yarn.lock ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/game/package.json ./packages/game/package.json
COPY packages/server/package.json ./packages/server/package.json
RUN yarn install --production
# Built output (preserve the packages/<pkg>/dist layout the server resolves against)
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/game/dist ./packages/game/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/client/dist ./packages/client/dist
CMD ["node", "packages/server/dist/index.js"]
