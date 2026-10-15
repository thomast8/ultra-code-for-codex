import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      exclude: ['src/codex/generated/**'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      thresholds: { statements: 90, lines: 90, functions: 90, branches: 85 },
    },
    pool: 'forks',
    maxWorkers: 1,
  },
});
