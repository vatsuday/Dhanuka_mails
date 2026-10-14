// Shared ESLint flat config. A package uses it like this:
//
//   import base from '@dm/config/eslint';
//   import { defineConfig } from 'eslint/config';
//   export default defineConfig([
//     ...base,
//     { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
//   ]);
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  { ignores: ['**/dist/**', '**/coverage/**', '**/.next/**', '**/node_modules/**'] },
  js.configs.recommended,
  // Type-aware strict rules for TypeScript sources.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: { parserOptions: { projectService: true } },
  },
  // JavaScript files (configs, scripts) get the base rules without type information.
  // They run on Node, so Node's globals (process, console, ...) are defined.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
]);
