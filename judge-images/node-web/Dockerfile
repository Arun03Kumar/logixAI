# Sandbox image for JavaScript and React practice (language NODE_WEB in
# packages/languages). Build: npm run judge:images   ->  logixai/node-web:1
#
# Node 22 with React 19 (same major as apps/web), jsdom for rendering
# components and Sucrase for JSX. Packages live in /opt/lx and are found
# through NODE_PATH, so the sandbox's read-only filesystem is fine. Bump the
# tag (and packages/languages) when changing versions. NODE_ENV=development
# because React only ships act() (used to drive components in tests) there.
FROM node:22-slim

WORKDIR /opt/lx
RUN npm init -y >/dev/null \
 && npm install --no-audit --no-fund --omit=dev \
      react@19.2.3 \
      react-dom@19.2.3 \
      jsdom@25.0.1 \
      sucrase@3.35.0 \
 && npm cache clean --force \
 && node -e "require('react'); require('react-dom/client'); require('jsdom'); require('sucrase')"

ENV NODE_PATH=/opt/lx/node_modules \
    NODE_ENV=development \
    UV_THREADPOOL_SIZE=1

WORKDIR /sandbox
