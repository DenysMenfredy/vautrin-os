# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# apps/web — Vautrin OS dashboard, Nuxt 4 (VOS-023, SDD-12 §8)
#
#     docker build -f apps/web/Dockerfile -t vautrin/web:$(git rev-parse --short HEAD) .
#
# Built from the REPOSITORY ROOT: the image compiles @vautrin/contracts into
# itself, and pnpm needs the lockfile and workspace manifest to resolve it.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/auth/package.json packages/auth/
COPY patches ./patches
COPY packages/config/package.json    packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json  packages/database/
COPY packages/integrations/package.json packages/integrations/
COPY packages/revenue/package.json packages/revenue/
COPY packages/queues/package.json    packages/queues/
COPY packages/testing/package.json   packages/testing/
COPY apps/api/package.json           apps/api/
COPY apps/worker/package.json        apps/worker/
COPY apps/web/package.json           apps/web/
COPY packages/database/prisma packages/database/prisma

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec turbo run build --filter=@vautrin/web

# ---------------------------------------------------------------------------
# runtime
#
# Nitro emits a self-contained bundle in .output, with its own node_modules
# and no need for pnpm or the workspace. So unlike the API and worker images
# this stage needs nothing but Node and the build output — no `pnpm deploy`,
# no corepack, a noticeably smaller image.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    # Nitro reads these. HOST must be 0.0.0.0 or the server binds to
    # loopback inside the container and nothing can reach it.
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /repo/apps/web/.output ./

USER node

EXPOSE 3000

# Renders the page, which proves Nitro is serving. It stays healthy while the
# API is down on purpose: the frontend degrades to an "unreachable" tile
# rather than failing, and taking the web container out of rotation for a
# backend outage would only remove the page that explains the outage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server/index.mjs"]
