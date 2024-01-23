/* eslint-env node */
module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  root: true,

  ignorePatterns: ["dist/**/*"],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
