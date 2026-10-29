import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT } from './e2e/port.js';

// Playwright starts and owns a fresh server on this worktree's own port
// (e2e/port.js); --exact fails fast instead of adopting a foreign process on
// it. PW_PORT=<port> overrides the port and opts in to reuseExistingServer
// ("I'm managing the server on that port myself").
const port = E2E_PORT;

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: `./scripts/server ${port} --exact`,
    port,
    reuseExistingServer: Boolean(process.env.PW_PORT)
  },
  use: {
    baseURL: `http://localhost:${port}`,
    // No test may reach the production Supabase project (supabase-auth.js
    // hard-codes it). e2e/fixtures.js mocks it per context; this is the floor
    // under that, for a spec that opts out of routes: the host doesn't resolve.
    // Routed requests are answered before DNS, so the mock is unaffected.
    launchOptions: {
      args: ['--host-resolver-rules=MAP *.supabase.co ~NOTFOUND']
    }
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
