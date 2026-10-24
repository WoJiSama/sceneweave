# Build the isolated AI service against the repository's locked Node 24 runtime.
FROM node:24.14.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.ai.json ./
RUN npm ci
COPY services/ai ./services/ai
COPY src/shared ./src/shared
RUN npm run ai:build

FROM node:24.14.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && mkdir -p /var/lib/sceneweave-ai \
    && chown node:node /var/lib/sceneweave-ai
COPY --from=build --chown=node:node /app/dist-ai ./dist-ai
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "dist-ai/services/ai/server.js"]
