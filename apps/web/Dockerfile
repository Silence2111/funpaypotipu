# Сборка из корня монорепо: docker build -f apps/web/Dockerfile .
# NEXT_PUBLIC_* инлайнятся на этапе сборки → передаём их build-аргументами.
# syntax=docker/dockerfile:1
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @gamemarket/shared build \
 && pnpm --filter @gamemarket/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
