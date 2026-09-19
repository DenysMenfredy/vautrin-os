# ADR-001 — Monorepo Strategy

- Status: Accepted
- Date: 2026-09-19

## Context

Vautrin OS contains a web application, API, worker processes, shared contracts,
domain libraries, AI infrastructure, integration adapters, and vertical templates.
Separate repositories would make synchronized changes and AI-assisted development
more expensive.

## Decision

Use a single repository managed by:
- pnpm workspaces;
- Turborepo.

NestJS remains the backend framework but does not own the repository-level
monorepo strategy.

## Repository layout

```text
apps/
packages/
templates/
docs/
infra/
```

## Consequences

Positive:
- shared TypeScript packages;
- unified CI;
- dependency graph awareness;
- atomic changes;
- consistent tooling.

Negative:
- repository complexity grows;
- CI configuration needs affected-task discipline;
- package boundaries must be enforced.

## Rejected alternatives

### Separate repositories
Rejected for MVP because they increase coordination overhead.

### Nest CLI monorepo as the repository strategy
Rejected because the repository contains Nuxt, infrastructure, templates, and
non-Nest packages in addition to Nest applications.
