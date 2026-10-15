import { defineIntegrationTestConfig } from '@vautrin/testing';
export default defineIntegrationTestConfig({
  test: { name: 'e2e', include: ['test/**/*.test.ts'], testTimeout: 60000 },
});
