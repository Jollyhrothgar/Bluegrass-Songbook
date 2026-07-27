import { defineConfig } from '@playwright/test';

// E2E tests use a dedicated port (default 8137) so they never collide with —
// or silently test against — whatever is running on the human dev default
// 8080 (or the 8080-8090 auto-increment/--cleanup sweep range).
// Override with PW_PORT=<port>. Setting PW_PORT explicitly also opts in to
// reuseExistingServer (i.e. "I'm managing the server on that port myself");
// otherwise Playwright always starts and owns a fresh server via --exact,
// which fails fast instead of adopting a foreign process on the port.
const port = Number(process.env.PW_PORT) || 8137;

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: `./scripts/server ${port} --exact`,
    port,
    reuseExistingServer: Boolean(process.env.PW_PORT)
  },
  use: {
    baseURL: `http://localhost:${port}`,
    // Wide viewport to ensure sidebar nav is visible
    viewport: { width: 1440, height: 900 }
  }
});
