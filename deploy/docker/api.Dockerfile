# syntax=docker/dockerfile:1
# NestJS API image. Build from the repository root:
#   docker build -f deploy/docker/api.Dockerfile -t ksm-api .

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# ---- build: install the workspace and compile shared + backend ----
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter backend...
COPY packages/shared packages/shared
COPY backend backend
RUN pnpm --filter @ksm/shared build && pnpm --filter backend build
RUN pnpm deploy --filter backend --prod --legacy --ignore-scripts /out

# ---- migrate: one-off job that applies Prisma migrations ----
FROM build AS migrate
WORKDIR /repo/backend
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---- runtime: production dependencies and compiled code only ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/backend/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
