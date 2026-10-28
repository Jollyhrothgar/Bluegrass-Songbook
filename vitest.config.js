import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['docs/js/__tests__/**/*.test.js'],
    globals: true,
    setupFiles: ['docs/js/__tests__/setup-webstorage.js'],
    deps: {
      inline: ['vitest-canvas-mock']
    }
  }
});
