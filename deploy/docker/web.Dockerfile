# syntax=docker/dockerfile:1.7
#
# The Next.js web app, built from the repository root:
#
#   docker build -f deploy/docker/web.Dockerfile -t logixai/web .
#
# API URLs are read at runtime from PUBLIC_* environment variables
# (PUBLIC_ARENA_API_URL, ...; see apps/web/app/coding-platform/lib/config.js),
# so one image works for every domain.

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
WORKDIR /repo

FROM base AS prune
RUN npm install -g turbo@2.11.11
COPY . .
RUN turbo prune @logixai/web --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --from=prune /repo/out/full/ .
# Root files turbo prune leaves out but the workspace tsconfigs extend.
COPY --from=prune /repo/tsconfig.base.json ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx turbo run build --filter=@logixai/web

# Runtime: the standalone server (only the files Next.js traced), static assets and public/.
FROM base AS runtime
# Node handles SIGTERM itself (graceful shutdown); run with `--init` / `init: true`
# so an init process reaps zombie processes.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3008 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3008
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/runtime-config.js').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
