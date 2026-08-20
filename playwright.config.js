import { defineConfig, devices } from '@playwright/test';

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
    baseURL: `http://localhost:${port}`
  },
  projects: [
    {
      // The suite as it has always run: one wide window, wide enough that
      // the sidebar-era layouts and the tab band never collapse.
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } },
      testIgnore: /-mobile\.spec\.js$/
    },
    {
      // A phone, because the phone layouts are real product surfaces and
      // "we tested it wide" is not a test of them. The tab band collapses
      // to ⚙, the editor's menu bar collapses to ☰, and the edit session's
      // buttons have to stay reachable through both.
      //
      // iPhone 13's metrics (390x844, dpr 3, touch, isMobile) on Chromium:
      // the descriptor's own default is WebKit, which the CI image does not
      // install, and every collapse under test is a width/pointer question
      // rather than an engine one.
      name: 'mobile',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium'
      },
      testMatch: /-mobile\.spec\.js$/
    }
  ]
});
