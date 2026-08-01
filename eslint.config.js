import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';

import reactProps from './eslint-rules/plugin.js';

export default tseslint.config(
  {
    // Global ignores — Rust target dirs, build output, generated data, tooling.
    ignores: [
      '.agents/',
      '.pi/',
      'dist/',
      'node_modules/',
      '**/.wrangler/',
      'packages/target/',
      'packages/**/target/',
      'src/lib/uma-sim-wasm/pkg/',
      '**/*.d.ts',
      'public/',
      'db/',
      'courseeventparams/'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat['recommended-latest'],
  jsxA11y.flatConfigs.recommended,
  // `unopinionated` = recommended minus the stylistic/opinionated rules
  // (prevent-abbreviations, no-null, no-array-reduce, filename-case, etc.).
  unicorn.configs.unopinionated,

  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    settings: {
      react: { version: '19.0' }
    },
    plugins: {
      'react-props': reactProps
    },
    rules: {
      // React 19 + the automatic JSX runtime make these classic rules noise.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react/no-unescaped-entities': 'off',

      // `any` is a smell, not a build-breaker — surface it without failing CI.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Flag oversized files for refactor without failing CI. Counts code
      // lines only (blanks + comments skipped).
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],

      // React Compiler / experimental hook rules: informative but noisy and
      // prone to false positives (e.g. TanStack Virtual). Keep as warnings.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/incompatible-library': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],

      // Project-specific React/Zustand rules.
      'react-props/destructure-props': 'error',
      'react-props/require-use-shallow': 'error',

      // --- Unicorn: extra finicky / purely cosmetic rules left on by
      // `unopinionated` that we don't want to enforce in this project. ---
      'unicorn/no-negated-condition': 'off',
      'unicorn/prefer-code-point': 'off',
      'unicorn/no-object-as-default-parameter': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
      'unicorn/no-zero-fractions': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/prefer-at': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/escape-case': 'off',
      'unicorn/number-literal-case': 'off',
      'unicorn/numeric-separators-style': 'off',
      'unicorn/import-style': 'off',
      'unicorn/prefer-add-event-listener': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-global-this': 'off',
      'unicorn/no-abusive-eslint-disable': 'off',
      'unicorn/no-anonymous-default-export': 'off'
    }
  },

  {
    // Scripts and config run in Node — relax browser-leaning rules.
    files: ['scripts/**', '*.config.{ts,js,mjs}', 'eslint-rules/**'],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      'no-console': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/no-exports-in-scripts': 'off'
    }
  }
);
