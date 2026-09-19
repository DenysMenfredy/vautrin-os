# @vautrin/testing

Shared [Vitest](https://vitest.dev) configuration. Vitest is the single test
runner across this repository — packages, `apps/api`, `apps/worker`, and
`apps/web`.

Implements: **SDD-11** (testing strategy).

## Why one runner

SDD-11 describes a pyramid — unit, integration, tenant-isolation, E2E, AI
evaluation — that spans a NestJS backend and a Nuxt frontend. Using one runner
means those layers share a vocabulary, and a developer moving between
`apps/api` and `apps/web` does not relearn how to write a test.

Vitest also has first-class Vue support via `@nuxt/test-utils`, which is what
made it the choice over Jest for the frontend half.

## Presets

```ts
// vitest.config.ts — unit tests
import { defineUnitTestConfig } from '@vautrin/testing';
export default defineUnitTestConfig();
```

```ts
// vitest.integration.config.ts — needs PostgreSQL/Redis
import { defineIntegrationTestConfig } from '@vautrin/testing';
export default defineIntegrationTestConfig();
```

Both accept an override object, merged over the preset:

```ts
export default defineIntegrationTestConfig({
  test: { setupFiles: ['./test/setup.ts'] },
});
```

| | `defineUnitTestConfig` | `defineIntegrationTestConfig` |
|---|---|---|
| Matches | `**/*.test.ts` | `**/*.integration.test.ts` |
| Excludes | `**/*.integration.test.ts` | — |
| Parallel files | yes | **no** |
| Retries | default | **0** |
| Timeout | default | 30s test / 60s hook |

## Two decisions worth knowing

**Integration tests run serially.** Not for speed — they share one database
and assert on row counts, so concurrent files observe each other's fixtures
and fail intermittently.

**Integration tests never retry.** A retried integration test hides exactly
the non-determinism the suite exists to expose. If one is flaky, the test or
the code is wrong.

`globals: false` throughout: tests import `describe`/`it`/`expect`
explicitly, so a file has no hidden dependency on runner configuration.

## Naming

The split is by filename, so a single glob separates what needs
infrastructure from what does not:

```text
foo.test.ts               unit — runs anywhere
foo.integration.test.ts   needs docker compose up
```

## Conventions

Test data is synthetic. Never commit real customer PII (SDD-11 §8).

CI must not depend on real paid providers — use mocks, contract tests, or
sandbox environments (SDD-11 §7).

## Versions

`vitest` and `vite` are pinned deliberately. Vite is a peer dependency of
Vitest and is declared explicitly rather than auto-installed, so the runner
stays on the same Vite major as Nuxt 4's builder and the two cannot drift.
