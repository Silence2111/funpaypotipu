# Сборка из корня монорепо: docker build -f apps/api/Dockerfile .
# syntax=docker/dockerfile:1
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @gamemarket/db generate \
 && pnpm --filter @gamemarket/shared --filter @gamemarket/db build \
 && pnpm --filter @gamemarket/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
