import { defineConfig } from 'vitest/config';

// Integration tests against real Valkey and Postgres containers (Testcontainers).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
