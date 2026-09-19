# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# packages/database — migration runner (SDD-12 §7)
#
#     docker build -f packages/database/Dockerfile -t vautrin/migrate:$(git rev-parse --short HEAD) .
#
# A separate image, deliberately. SDD-12 §7: "Migrations are deployed
# separately from application startup ... Application startup must not race
# multiple instances attempting arbitrary schema changes." Putting
# `migrate deploy` in the API entrypoint means N replicas racing the same
# DDL on every rollout.
#
# This runs as a one-shot job: it exits 0 when the schema is current, and
# non-zero if a migration fails, so a deploy can gate on it.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CHECKPOINT_DISABLE=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json   packages/config/
COPY packages/database/package.json packages/database/
COPY packages/testing/package.json  packages/testing/
COPY apps/api/package.json          apps/api/
COPY apps/worker/package.json       apps/worker/
COPY packages/database/prisma packages/database/prisma

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec turbo run build --filter=@vautrin/database

# No --prod here, unlike the application images: the Prisma CLI is a
# devDependency and it is the whole point of this image.
RUN pnpm deploy --filter=@vautrin/database --ignore-scripts /prod/database

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build --chown=node:node /prod/database ./

USER node

# `migrate deploy` applies pending migrations and nothing else. It never
# generates, never resets, and never prompts — the only migration command
# safe to run unattended (SDD-04 §10).
#
# It connects through `directUrl` (DATABASE_MIGRATION_URL), the schema-owning
# role, which is why this image and the application images take different
# credentials.
CMD ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]
