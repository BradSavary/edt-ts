import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@edt-ts/scheduler-common': resolve(__dirname, '../scheduler-common/src/index.ts'),
      '@': resolve(__dirname, '.'),
    },
  },
});
