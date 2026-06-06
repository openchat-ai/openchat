import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        http: 'readonly',
        https: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'warn',
      'no-undef': 'error',
      'no-console': 'off',
      'no-case-declarations': 'off',
      'no-useless-catch': 'off',
      'no-dupe-keys': 'warn',
      'no-dupe-class-members': 'warn',
      'no-useless-escape': 'warn',
      'no-loss-of-precision': 'warn',
      'no-unreachable': 'warn',
      'no-fallthrough': 'warn',
      'require-yield': 'warn',
    },
    ignores: ['__tests__/**'],
  },
  {
    // dev/page.js 是浏览器端 dev 页面 JS，启用 browser globals
    files: ['src/api/routes/dev/page.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
