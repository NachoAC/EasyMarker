import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },
  {
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Functions passed to page.evaluate() run inside the extension.
    files: ['test/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-implicit-globals': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      // Security: keep user data out of HTML parsing and dynamic code.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent or DOM APIs: titles and URLs come from the user.' },
        { property: 'outerHTML', message: 'Use textContent or DOM APIs: titles and URLs come from the user.' },
        { property: 'insertAdjacentHTML', message: 'Use DOM APIs: titles and URLs come from the user.' },
      ],
    },
  },
];
