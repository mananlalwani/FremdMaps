// @ts-check
import eslint from '@eslint/eslint-api'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import astroPlugin from 'eslint-plugin-astro'
import prettierConfig from 'eslint-config-prettier'

export default [
  {
    ignores: ['dist/**', '.astro/**', 'node_modules/**', 'public/graph-worker.js'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.astro'],
    plugins: {
      astro: astroPlugin,
    },
    processor: astroPlugin.processors['.astro'],
    rules: {
      ...astroPlugin.configs.recommended.rules,
    },
  },
  prettierConfig,
]
