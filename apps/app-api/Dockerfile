FROM node:24.21.0-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile --filter "@eox/app-api-server..." && chown -R node:node /app
WORKDIR /app/apps/app-api
ENV APP_API_SOURCE=cox-fixture APP_API_HOST=0.0.0.0 APP_API_PORT=8080
USER node
EXPOSE 8080
CMD ["node", "--import", "/app/apps/app-api/node_modules/tsx/dist/loader.mjs", "src/main.ts"]
