# Frontend implementation plan — design system v1.0

## Source and scope

The source of visual truth is `Vautrin_OS_Design_System_v1.0.pdf`. The API and
shared contracts are the source of functional truth. This change implements
the authenticated operations workspace for currently exposed domains.

## Impacted modules

- `apps/web`: session handling, shared UI, shell, overview, leads,
  conversations, appointments, workflows, AI Workforce, settings.
- `packages/contracts`: consumed without changing API shapes.
- `apps/api`, `apps/worker`, `packages/database`: unchanged; frontend only
  calls existing tenant-scoped endpoints.

## Decisions

- Use the existing same-origin `/api` proxy. Keep the access token in memory;
  use the HttpOnly refresh cookie and rotate through `/auth/refresh`.
- Resolve permissions from `/auth/me`. A tenant switch is sent to the API and
  followed by a session reload; a client-selected ID never authorizes data.
- Present only API-backed facts. The lead API has no next-action field or
  joined contact name; the UI loads contact records and labels untracked
  actions honestly. The API has no estimate endpoints, so there is no
  estimates destination yet.
- Draft workflows can be created and edited as ordered steps using only the
  worker's implemented wait, condition, literal SMS and end actions. Advanced
  definitions stay readable and versionable without lossy conversion.
- Agent drafts can be created, edited and versioned. Agent execution is not
  wired into the worker yet, so the UI describes active status as a saved
  configuration state.
- Use tokenized visual foundations and reusable primitives. Desktop is a
  fixed sidebar and utility bar; mobile uses a drawer and single-column views.

## Verification

Run web typecheck, lint, build and focused UI tests. Check auth, loading,
empty/error, narrow viewport and keyboard focus behavior.
