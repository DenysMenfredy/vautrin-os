/**
 * @vautrin/testing — shared Vitest configuration (SDD-11).
 *
 * Vitest is the test runner everywhere in this repository: packages, the API,
 * the worker, and the Nuxt frontend. One runner keeps SDD-11's test pyramid
 * expressible with a single vocabulary instead of per-app dialects.
 *
 * SDD-11 distinguishes test kinds by what they need, not by where they live:
 *
 *   unit         no external dependency, fast, safe to run in parallel
 *   integration  needs PostgreSQL/Redis, therefore serial and slower
 *
 * Those are the two presets below. Tenant-isolation tests (SDD-11 §4) are
 * integration tests; E2E (SDD-11 §5) gets its own configuration once there is
 * an application to drive.
 */

import { configDefaults, defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config';

/** A Vitest configuration object. */
export type TestConfig = ViteUserConfig;

/**
 * Settings shared by every kind of test.
 *
 * `globals: false` is deliberate: tests import `describe`/`it`/`expect`
 * explicitly. It costs one import line and means a test file has no hidden
 * dependency on runner configuration.
 */
const base: ViteUserConfig = {
  test: {
    globals: false,
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    /** Surfaces slow tests instead of letting them quietly accumulate. */
    slowTestThreshold: 1_000,
  },
};

/**
 * Unit tests: no database, no Redis, no network (SDD-11 §2).
 *
 * Integration files are excluded by filename so a single `vitest run` during
 * development never blocks on infrastructure that may not be up.
 */
export function defineUnitTestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(
    mergeConfig(base, {
      test: {
        name: 'unit',
        include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
        exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        /**
         * A package with only integration tests is a legitimate state — an
         * app whose logic lives behind a database, for instance. Without
         * this, `turbo run test` fails for that package and the failure says
         * nothing about correctness.
         */
        passWithNoTests: true,
      },
    } satisfies ViteUserConfig),
    overrides,
  );
}

/**
 * Integration tests: real PostgreSQL and Redis (SDD-11 §3, §4).
 *
 * `fileParallelism: false` is not a performance choice. These tests share one
 * database and assert on row counts; running two files concurrently makes
 * them observe each other's fixtures and fail intermittently.
 *
 * `retry: 0` is equally deliberate. A retried integration test hides exactly
 * the non-determinism this suite exists to expose.
 */
export function defineIntegrationTestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(
    mergeConfig(base, {
      test: {
        name: 'integration',
        include: ['test/**/*.integration.test.ts'],
        fileParallelism: false,
        retry: 0,
        testTimeout: 30_000,
        hookTimeout: 60_000,
      },
    } satisfies ViteUserConfig),
    overrides,
  );
}

export { configDefaults, defineConfig, mergeConfig };
