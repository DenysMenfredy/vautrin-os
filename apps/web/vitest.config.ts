import { defineVitestConfig } from '@nuxt/test-utils/config';

/**
 * Nuxt needs its own Vitest setup rather than the shared preset.
 *
 * `defineVitestConfig` wires the Nuxt environment: auto-imports, runtime
 * config, component resolution and a DOM. The shared node presets in
 * @vautrin/testing cannot provide that, so this app is the one deliberate
 * exception to using them — the naming convention still matches
 * (*.test.ts for unit, *.integration.test.ts for the rest).
 */
export default defineVitestConfig({
  test: {
    name: 'unit',
    environment: 'nuxt',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    globals: false,
  },
});
