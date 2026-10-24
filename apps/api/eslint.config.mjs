import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // `const { secret, ...rest } = value` is how we leave fields out.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    },
  },
);
