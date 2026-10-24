import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    },
  },
);
