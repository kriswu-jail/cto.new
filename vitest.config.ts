import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'build', '.next', 'coverage', 'e2e'],
    reporters: 'default'
  }
});
