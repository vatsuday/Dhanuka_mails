import base from '@dm/config/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  { ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
  ...base,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
]);
