import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@edt-ts/scheduler-common': resolve(__dirname, '../scheduler-common/src/index.ts'),
      '@edt-ts/scheduler-core': resolve(__dirname, '../scheduler-core/src/index.ts'),
    },
  },
});
