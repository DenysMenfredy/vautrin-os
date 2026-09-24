# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# apps/api — Vautrin OS HTTP API (VOS-023, SDD-12 §8)
#
# Build from the REPOSITORY ROOT, not this directory:
#     docker build -f apps/api/Dockerfile -t vautrin/api:$(git rev-parse --short HEAD) .
#
# The build context has to be the workspace root because the image compiles
# shared packages into itself (SDD-12 §8), and pnpm needs the lockfile and
# workspace manifest to resolve them.
# ---------------------------------------------------------------------------

# Pinned rather than floating: SDD-12 §9 requires reproducible deployments,
# and a moving base tag makes two builds of the same commit differ.
ARG NODE_VERSION=22.19.0

# Debian rather than Alpine on purpose. Prisma ships engine binaries per libc,
# and the generated client here carries the glibc build
# (libquery_engine-debian-openssl-3.0.x). Alpine would need a musl target and
# buys little once the Prisma engines dominate the image size.
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    # Prisma's CLI must never phone home from a build container.
    CHECKPOINT_DISABLE=1

# Prisma's query engine links against OpenSSL, and node:*-slim does not ship
# it. Without this the engine cannot detect the libssl version, warns, and
# falls back to guessing an ABI — which works until it silently does not.
# ca-certificates is needed for outbound TLS to providers.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# build — install, compile, and reduce to a production tree
# ---------------------------------------------------------------------------
FROM base AS build

# Manifests before source, so the dependency layer is only invalidated when
# a package.json or the lockfile changes — not on every code edit.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json   packages/config/
COPY packages/auth/package.json     packages/auth/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/integrations/package.json packages/integrations/
COPY packages/queues/package.json   packages/queues/
COPY packages/testing/package.json  packages/testing/
COPY apps/api/package.json          apps/api/
COPY apps/worker/package.json       apps/worker/

# The database package's postinstall runs `prisma generate`, so the schema has
# to be present before install rather than arriving with the rest of the source.
COPY packages/database/prisma packages/database/prisma

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# Turborepo resolves the dependency graph, including the generate-before-build
# ordering that the Prisma client needs.
RUN pnpm exec turbo run build --filter=@vautrin/api

# Produces a self-contained tree: only production dependencies, with workspace
# packages materialised as real directories. --ignore-scripts because every
# build step has already run; the generated Prisma client travels with
# @vautrin/database as a package file.
RUN pnpm deploy --filter=@vautrin/api --prod --ignore-scripts /prod/api

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    API_PORT=3000

WORKDIR /app

# `node` is an unprivileged user that ships with the official image
# (SDD-09 §10 — least privilege). Ownership is set during copy so no extra
# layer is needed to chown the tree.
COPY --from=build --chown=node:node /prod/api ./

USER node

EXPOSE 3000

# Uses the readiness probe, which verifies the database rather than merely
# proving the process is up. No curl in a slim image, so Node makes the call.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/'+(process.env.API_GLOBAL_PREFIX||'api')+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form so the process is PID 1 and receives SIGTERM directly; Nest's
# shutdown hooks then drain in-flight requests and close the database pool.
# Migrations are NOT run here — SDD-12 §7 keeps them a separate step.
CMD ["node", "dist/main.js"]
