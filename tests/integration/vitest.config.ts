import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: import.meta.dirname,
    include: ['**/*.int-spec.ts'],
    // Integration tests share one PostgreSQL database; run files serially.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
