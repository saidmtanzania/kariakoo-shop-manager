# syntax=docker/dockerfile:1
# Next.js web image (standalone server). Build from the repository root:
#   docker build -f deploy/docker/web.Dockerfile -t ksm-web .

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Where the Next.js server forwards /api/*; rewrites are fixed at build time.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @ksm/shared build && pnpm --filter web build

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
