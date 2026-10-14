import base from '@dm/config/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  ...base,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
]);
