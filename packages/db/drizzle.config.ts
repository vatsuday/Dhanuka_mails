import { defineConfig } from 'drizzle-kit';

// Generation only: migrations are applied by `pnpm db:migrate` (src/migrate.ts), not drizzle-kit.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
