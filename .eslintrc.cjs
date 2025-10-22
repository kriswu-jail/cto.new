/********
 * Root ESLint config for monorepo
 */
module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    browser: false
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  plugins: ['@typescript-eslint'],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '.next/'
  ],
  overrides: [
    {
      files: ['**/*.test.{ts,tsx}'],
      env: { node: true, jest: false }
    }
  ]
};
