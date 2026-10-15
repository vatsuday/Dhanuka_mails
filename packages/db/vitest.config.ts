import { defineConfig } from 'vitest/config';

// Every test in this package is an integration test against a real Postgres (Testcontainers).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
