FROM node:22-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile --filter "@eox/signer..." && chown -R node:node /app
WORKDIR /app/apps/signer
ENV SIGNER_CONFIG=/app/apps/signer/config/dev.json
USER node
CMD ["node_modules/.bin/tsx", "src/main.ts"]
