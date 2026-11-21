# syntax=docker/dockerfile:1.7
#
# One image per backend service, built from the repository root:
#
#   docker build -f deploy/docker/service.Dockerfile \
#     --build-arg APP=@logixai/arena-service --build-arg APP_DIR=arena-service \
#     --build-arg PORT=3010 -t logixai/arena-service .
#
# `turbo prune` keeps only the service and the workspace packages it uses, so
# each image installs and builds just what it needs. The same image runs
# migrations: `docker run ... node dist/db/migrate.js` (JS services: src/db/migrate.js).
# All configuration comes from environment variables (see docs/deploy.md).

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
WORKDIR /repo

# 1. Prune the monorepo down to this service and its workspace dependencies.
FROM base AS prune
ARG APP
RUN npm install -g turbo@2.11.11
COPY . .
RUN turbo prune "${APP}" --docker

# 2. Install (cached by package.json/lockfile), build, drop dev dependencies.
FROM base AS build
ARG APP
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --from=prune /repo/out/full/ .
# Root files turbo prune leaves out but the workspace tsconfigs extend.
COPY --from=prune /repo/tsconfig.base.json ./
RUN npx turbo run build --filter="${APP}" \
 && npm prune --omit=dev --no-audit --no-fund

# 3. Runtime: production dependencies and build output only, as a non-root user.
FROM base AS runtime
# Node handles SIGTERM itself (graceful shutdown); run with `--init` / `init: true`
# so an init process reaps zombie processes.
ARG APP_DIR
ARG PORT=3000
ARG START=dist/index.js
ENV NODE_ENV=production \
    PORT=${PORT} \
    START=${START}
COPY --from=build --chown=node:node /repo /app
WORKDIR /app/apps/${APP_DIR}
USER node
EXPOSE ${PORT}
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "exec node \"$START\""]
