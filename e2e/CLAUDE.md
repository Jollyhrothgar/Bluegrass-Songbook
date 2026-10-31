# E2E Tests

Playwright tests for the frontend. Specs are `e2e/*.spec.js` (`ls e2e` lists
them); each opens with a comment saying what it covers.

## The rule

> **Everything a human can do must be reachable by Playwright against a
> mocked backend.**

A surface a person can reach and a test cannot is a bug in the product or in
this harness, and gets fixed rather than noted. Three corollaries:

1. **No native dialogs.** `window.prompt` / `confirm` / `alert` are drawn by the
   browser, so no test can click them, no theme can style them, and on iOS the
   editor never gets focus back. The OTF tab editor (`docs/js/otf-editor/`) asks in in-app panels:
   `ValuePromptPopover` (`otf-editor/popover.js`), the inline "Discard edits?" in
   the bottom band's edit bar (`otf-editor/work-edit.js`), and the drafts list's
   inline "Delete this draft?". `docs/js/__tests__/no-native-dialogs.test.js`
   scans the tab-editor sources and fails if one comes back. In tab-editor specs,
   register `page.on('dialog')` and assert it never fired; never accept a dialog
   to make a test pass there, because it means the product is wrong. Outside the
   tab editor, `docs/js/lists.js`, `main.js`, `review-queue.js`, `pwa.js`,
   `chord-explorer/main.js`, `editor.js` and `work-view.js` (one `alert` each)
   still use native dialogs (`view-versions.spec.js` and
   `list-management.spec.js` drive them with `page.on('dialog')`). That is
   backlog, not a pattern to copy.
2. **The backend is mocked, never live.** See below.
3. **Layouts are widths, not devices.** The tab band (`.app-bottomband`, the bottom band; CSS `container: tabband / inline-size`) collapses on its own width
   (`tab-controls-sheet.js` observes the element; CSS uses
   `@container tabband (max-width: 640px)`), so a test reaches the collapsed
   layout by constraining the container, not only the viewport.

## Running

```bash
npm run test:e2e                       # all E2E
npm run test:all                       # vitest + E2E
npx playwright test e2e/search.spec.js # one spec
npx playwright test --project=mobile   # or --project=desktop
```

Config is `playwright.config.js`. It starts `./scripts/server <port> --exact`
itself, on a port that `e2e/port.js` derives from the worktree's path
(20000-29999), so parallel worktrees can run E2E at once and tests never hit a
dev server on 8080-8090. `--exact` fails fast if the port is taken. A spec that
needs the port imports `E2E_PORT` from `e2e/port.js`. `PW_PORT=<port>`
overrides it and also opts in to `reuseExistingServer` ("I'm managing that
server"). Projects:

- `desktop`: 1440x900, every spec except `*-mobile.spec.js`.
- `mobile`: iPhone 13 metrics (390x844, touch) on Chromium, only
  `*-mobile.spec.js`. WebKit, the descriptor's default engine, is not installed,
  and every collapse under test is a width/pointer question.

### When it fails on one machine only

- **Random tests fail, a different set each run, with
  `net::ERR_CONNECTION_RESET` on `localhost`**: the test server's listen backlog
  overflowed (each page requests ~40 ES modules at once, one page per worker).
  `scripts/server` sets `request_queue_size = 128`; Python's default is 5. If
  `--workers=1` passes, this has regressed.
- **`npx playwright install` hangs** after writing `ABOUT` and `LICENSE*` into the
  browser folder, at 0% CPU: Playwright's zip extractor stalls under Node 24.16.0
  and 26.12.1 (24.7.0 and 24.22.0 are fine; for WebKit it stalls at ~15 MB on
  `webkit-*/libwebrtc.dylib`). Install with another Node:
  `mise x node@24.22.0 -- npx playwright install chromium chromium-headless-shell`
  (add `webkit` to reproduce iOS-only bugs; no project runs it). Only the install
  needs it; the tests run on any Node.

## The Supabase mock

Every spec imports `test` from `./fixtures.js`, never from `@playwright/test`
(`tests/test_e2e_specs_use_fixtures.py` fails CI otherwise). The fixture
installs a signed-out, empty-tables mock on each browser context and runs
`assertClean()` after the test. Without it, tests wrote to the production
project that `supabase-auth.js` hard-codes (including a `visitors` row per page
load). Details:

- A spec that needs a signed-in user or seeded tables calls
  `mockSupabase(page, {...})`. Page routes win over the context's, which is only
  the backstop. The backstop lets the soundfont CDNs through
  (`blockAudio: false`) so Play really starts; a spec's own mock aborts them.
- `playwright.config.js` makes `*.supabase.co` unresolvable
  (`--host-resolver-rules`) for the whole suite; routed requests are answered
  before DNS. That is what lets `sw-and-prefetch.spec.js` use
  `test.use({ supabaseBackstop: false })` (any installed route turns off
  Playwright's HTTP cache, which that spec measures) without reaching production.
- `e2e/helpers/supabase-mock.js` routes `**/*.supabase.co/**`. The real
  supabase-js SDK still loads from jsdelivr and runs, so the shipping code path
  is under test: `auth.getSession()`, `.from('pending_songs').upsert(…)`,
  `fetch(functions/v1/auto-commit-song)`. Read the file's header for the options
  (`signedIn`, `commit`, `rpc`, `tables`, `oauthReturn`, `blockAudio`) and
  helpers (`sb.row(table)` fails unless exactly one row was written;
  `sb.calls()`; `sb.assertClean()`).
- A signed-in session is seeded into `localStorage['sb-<ref>-auth-token']`, so
  `getSession()` needs no network.
- To test sign-in, use `{ signedIn: false, oauthReturn: true }`: the authorize
  route 302s back with `#access_token=…` like Google + Supabase, so the browser
  really leaves and returns. Do not stub `signInWithGoogle` to test a sign-in
  flow: the page never unloads, so the lost-route / lost-draft bug (fix-it item
  A5) is invisible. `e2e/editor-lifecycle.spec.js` is the model; `editor.spec.js`
  keeps a stub only for "the gate fires and the draft stays".
- Without `oauthReturn`, the authorize route serves a page with `#e2e-oauth-gate`,
  which is what "the login gate appeared" means in an assertion.
- `assertClean()` fails on a Supabase path the mock doesn't understand (the app
  grew a call; teach the helper) and on any request to a host other than
  localhost or jsdelivr. Google Analytics is always aborted.
- `e2e/helpers/tef-fixture.js` decodes a real `.tef` from the JS parser's golden
  oracle (`docs/js/tef-import/__fixtures__/golden.json`), so an import test can
  assert what landed.

## Conventions

- Routing is hash-based in tests (`/#search`, `/#work/slug`, `/#add`,
  `/#edit/slug`); a song then shows at its path, `/songs/{song}/…`
  (`song-paths.spec.js`). Assert a song by path or `history.state.songId`.
- Helpers in `e2e/helpers.js`: `gotoSearch`, `searchFor`, `searchAndOpen`,
  `navClick(page, id)` (top-band link by `data-nav`), `openDock(page, 'key' |
  'display' | 'view')` (the song page's dock sheets; returns the sheet) with
  `closeSheet(page)`, and `openPill(page, pillId)` (the list export pill).
- Wait for `#search-stats` to contain "songs" before navigating away from
  search: the post-index-load render overwrites earlier navigation.
- Clear localStorage in `beforeEach` where isolation matters. Use `.first()`
  when several elements match (strict mode).
- A test that asserts what it sent to Supabase starts with `await
  mockSupabase(page)` and ends with `sb.assertClean()`.
- `otf-editor-invariants.spec.js` runs a seeded random walk; a failure prints the
  seed and keys. Widen locally with
  `WALK_SEEDS=4,5,6 npx playwright test e2e/otf-editor-invariants.spec.js -g random`.
- Tests read the generated index in `docs/data/`, so run
  `./scripts/bootstrap --quick` first on a fresh clone.

### Selectors and fixture works

Shell ids come from `docs/js/shell.js` and `work-view.js`: `#app-topbar`,
`.topbar-nav-link[data-nav=…]` (full band only), and on a song page the thin
dock (G19): `#topbar-back`, `#topbar-search`, `#edit-song-btn` (the one Edit),
`#topbar-overflow-btn`. Everything else song-specific is in ⋯: use
`openMenu(page, expand?)` from `helpers.js` (rows `#list-picker-btn`,
`#export-menu-btn` and `#report-menu-btn`, which expand in place to hold
`[data-action=…]` / `#flag-btn` / `#report-bug-btn` / `#copyright-btn`;
`#overflow-tour`, `#menu-go-*`, `#menu-account` / `#menu-sign-in`). The writer
line `#song-details-btn` opens `#song-details-sheet` (`#edit-meta-btn` is its
Edit details). The song page's controls are the reading dock in
`#app-bottomband` (G19b): `#dock-key-btn` (opens `#dock-key-sheet`),
`#dock-size` (`[data-size="1"]` / `"-1"`), View as `#dock-view` (segments
`[data-view=lyrics|both|chart]`) or, when the song has versions, tabs or a
hybrid part, `#dock-view-btn` (opens `#song-view-sheet`: `.dock-row[data-view]`,
`.dock-row[data-part]`, the versions as `.arrangement-item`) and
`#dock-display-btn` (opens `#dock-display-sheet`: `#pill-compact`,
`#pill-autohide`, `#pill-chord-mode`, and for a chart `#pill-chart-cells`,
`#pill-chart-bars`, `#pill-chart-order`, whose buttons carry `data-value`). The
pill row and part tabs are gone. ABC notation has `#abc-play-btn`,
`#abc-tempo-label`, `#abc-size`; a tab part's band ends in `.tab-view-btn`.
In the lead-sheet editor the band is `#editor-band`: `#editor-mode-*`,
`#editor-undo/redo`, `#editor-key-select` and the Display pill, whose options
exist only once it is open, so use `openDisplay(page)` from
`helpers/lead-editor.js`; `#flag-modal` (feedback), `#song-nav-bar` (list
context). `.pill-btn` opens a `.pill-popover`; one is open at a time, and the
dock sheets are modal (close with `closeSheet`). Both bands auto-hide while
scrolling a song only when Display ▸ Auto-hide controls is on
(`body.chrome-hidden`; off by default), and only on a page with
`#dock-display-btn` (never a tab or ABC page). To enter the tab editor press Edit with
`pressTabEdit(page)` (`helpers/tab-edit.js`); the band has no Edit of its own.

Tab-editor selectors: `.editor-renderer .stave-row`, `.editor-canvas-container`,
`.note-text`, `.editor-status-bar` (`.status-flash` shows a refused op),
`.track-buttons .track-button.active`, `.menu-trigger[data-menu="score"]` then
`.menu-popup .menu-item` (track entries are `menuitemradio`, so `[role=menuitem]`
misses them), `.otf-track-name-popover`, `.otf-value-prompt-popover`,
`.editor-selection-rect`, and the session buttons `.tab-edit-submit` /
`-done` in the bottom band (Download, Cancel and Import .tef… are File menu
items: `clickFileItem` in `helpers/front-door.js`, laptop or phone). The live
document is `.otf-editor.__otfEditor.state.facade`, and
`__otfEditor.automation.check()` reports layout and history rule violations.

Fixture works (confirm with `ls works/<id>` after a build):

- `old-home-place`: lead sheet, the only chord chart, and a banjo tab (so View ▾).
  A spec of `#dock-view` (Lyrics | Chart) takes the tab away with
  `serveWithoutTabs` (`helpers.js`). The index prune hides non-bluegrass rows
  such as `your-cheating-heart` from search.
- `wagon-wheel`: 2-version group (View ▾ ▸ Versions).
- `arkansas-traveler-1`: ABC notation (the ABC dock); `lonesome-road-blues-1`: a chordful lead sheet plus a banjo tab (View ▾ ▸ Tabs).
- `foggy-mountain-breakdown`: tab only (no lead sheet). Open `/#work/foggy-mountain-breakdown/mandolin`
  (`works/foggy-mountain-breakdown/mandolin.otf.json`) to edit a published tab and
  submit a correction (`editor-lifecycle.spec.js`, `otf-editor-mobile.spec.js`).
- `cripple-creek-1` redirects to `cripple-creek` (legacy slug).
- `house-of-gold`: has a version, `/songs/house-of-gold/2/`.
- `1-1-love`: archived, so its path is served by `404.html`.
- `abbey-reel-the`: ABC notation.
- `red-haired-boy/ensemble-tab`: six tracks, the multi-track fixture.
