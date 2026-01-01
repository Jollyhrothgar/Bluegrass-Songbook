import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: './scripts/server',
    port: 8080,
    reuseExistingServer: true
  },
  use: {
    baseURL: 'http://localhost:8080'
  }
});
