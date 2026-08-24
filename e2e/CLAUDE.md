# E2E Tests

Playwright end-to-end tests for the Bluegrass Songbook frontend
(post-redesign shell UI: slim top band, unified song page, pill popovers).

## The rule

> **Everything a human can do must be reachable by Playwright against a
> mocked backend.**

It is not a nice-to-have; it is how a defect is defined here. A surface a
person can reach and a test cannot is a bug in the product or a bug in this
harness, and either way it gets fixed rather than noted. Three corollaries,
each of which has already cost us something:

1. **No native dialogs.** `window.prompt` / `confirm` / `alert` are drawn by
   the browser, so they are not in the DOM: no test can click them, no theme
   can style them, and on iOS the editor never gets focus back. The tab
   editor's asks are all in-app panels now — `ValuePromptPopover` (Go to
   measure, Tempo…), the bar's inline "Discard edits?", the drafts list's
   inline "Delete this draft?". `docs/js/__tests__/no-native-dialogs.test.js`
   scans the tab-editor sources and fails if one comes back, and the specs
   below register `page.on('dialog')` and assert it never fired.
   (Outside the tab editor, `lists.js`, `main.js`, `review-queue.js` and the
   chordpro visual editor still use native dialogs — `arrangement-pill.spec.js`
   and `list-management.spec.js` drive them through `page.on('dialog')`. That
   is the backlog, not the standard.)
2. **The backend is mocked, never live.** See the Supabase mock below.
3. **Layouts are widths, not devices.** A phone layout that only a phone can
   reach is a phone layout nothing tests. The tab band collapses on the
   BAND's own width (`tab-controls-sheet.js` observes the element; the CSS
   asks `@container tabband (max-width: 640px)`), so a test can reach the
   collapsed layout by constraining the container as well as the viewport.

## Running

```bash
npm run test:e2e       # Run all E2E tests
npm run test:all       # Run unit tests + E2E tests
```

## Configuration

- **Config**: `playwright.config.js` (project root)
- **Web server**: Starts `./scripts/server <port> --exact` automatically on a
  dedicated test port (default **8137**, deliberately outside the 8080-8090
  dev-server/`--cleanup` range so tests never hit an unrelated app on 8080)
- **Port override**: `PW_PORT=<port> npm run test:e2e`
- **Reuse server**: off by default - Playwright starts and owns a fresh server,
  and `--exact` mode fails fast (instead of auto-incrementing) if the port is
  occupied, so tests can never silently run against a foreign server. Setting
  `PW_PORT` explicitly opts in to `reuseExistingServer` ("I'm managing the
  server on that port myself").
- **Projects**: two.
  - `desktop` — 1440x900, everything except `*-mobile.spec.js`. This is the
    suite as it has always run.
  - `mobile` — `devices['iPhone 13']` metrics (390x844, touch, `isMobile`) on
    **Chromium**, running only `*-mobile.spec.js`. The device descriptor's own
    default is WebKit, which is not installed here, and every collapse under
    test is a width/pointer question rather than an engine one.
  - Run one with `--project=desktop` / `--project=mobile`.

## The Supabase mock

`e2e/helpers/supabase-mock.js` routes `**/*.supabase.co/**` so submissions,
sign-in and every table read are answered in-process. The real supabase-js SDK
still loads from jsdelivr and still runs — stubbing it would test the stub —
so what is under test is the shipping code path: `auth.getSession()`,
`.from('pending_songs').upsert(…)`, `fetch(functions/v1/auto-commit-song)`.

```js
import { mockSupabase } from './helpers/supabase-mock.js';

const sb = await mockSupabase(page);                    // signed in
const sb = await mockSupabase(page, { signedIn: false }); // anonymous
const sb = await mockSupabase(page, {
    commit: { success: true, mode: 'create', workId: 'e2e-breakdown' },
    rpc: { is_trusted_user: true },
    tables: { bounties: [] },
});
…
sb.row('pending_songs');   // the row the app WROTE (fails unless exactly one)
sb.calls();                // every Supabase path touched
sb.assertClean();          // nothing un-mocked, nothing off-box
```

- **Signing in** is a session blob seeded into
  `localStorage['sb-<ref>-auth-token']` by an init script, which is how the
  SDK persists one — `getSession()` then answers with no network at all.
- **Signing in FAILING** is a route too: `signInWithOAuth` navigates to
  `/auth/v1/authorize`, and the mock serves a page carrying `#e2e-oauth-gate`.
  That is what "the login gate appeared" means in an assertion.
- **`assertClean()`** fails on two things: a Supabase path the mock does not
  understand (the app grew a call; teach the helper) and any request to a host
  that is not localhost or jsdelivr (a test was talking to production).
  Analytics and the WebAudioFont CDN are aborted outright.
- `e2e/helpers/tef-fixture.js` decodes a real `.tef` out of the JS parser's
  golden oracle (`docs/js/tef-import/__fixtures__/golden.json`), so an import
  test can assert what LANDED, not just that something did.

## Viewport

`desktop` runs 1440x900; `mobile` runs 390x844. Nothing else sets one.

## UI Model (what the tests target)

The redesign removed the ~250px logo header, hamburger sidebar, quick-controls
bar, Info bar, work dashboard cards, version-picker modal (#version-modal),
export dropdown markup, and the mobile bottom sheet. The suite targets:

- **Top band** (`#app-topbar`, built by `docs/js/shell.js`): brand link
  `#topbar-brand` (home), nav links `.topbar-nav-link[data-nav="search|add|
  favorites|lists"]`, theme `#topbar-theme`, auth `#auth-section`, overflow
  `#topbar-overflow-btn` + `#topbar-overflow-menu`. Song pages add
  `#topbar-back`, `#edit-song-btn`, `#list-picker-btn` and the Export pill
  (`#export-pill`).
- **Unified song page** (`work-view.js`): canonical URL `#work/{slug}`
  (+ `#work/{slug}/{partId}`); `#song/{id}` permanently redirects via
  `history.replaceState`. Structure: title row (`.song-title`, `#edit-song-btn`),
  `.song-artist-line`, pill row `#song-pill-row` (`#key-pill`, `#display-pill`,
  `#info-pill`, `#arrangement-pill` when the group has >1 version), part tabs
  `#part-tabs .part-tab` when a work has >1 part, content below.
- **Pills** (`shell.js` `pill()` primitive): `.pill-btn` opens `.pill-popover`;
  only one popover open at a time; outside click / Escape closes.
- **Bottom band** (`#app-bottomband`): tablature playback controls
  (`.tab-play-btn`, `.tab-tempo-*`, mixer) and ABC controls (`#abc-play-btn`,
  `#abc-tempo-label`).
- **Auto-hiding chrome**: `body.chrome-hidden` — the top band hides on scroll-down on song pages, returns on scroll-up/top (no focus mode; `#edit-song-btn` sits in the title row).
- **Feedback**: one unified modal `#flag-modal` (type selector), opened from
  the overflow menu ("Send Feedback" everywhere, "Report issue" on song pages).
- **List navigation**: `#song-nav-bar` (bottom bar) still used in list context.

## Test Specs

| Spec | Coverage |
|------|----------|
| `search.spec.js` | Basic search, result display, search prompt |
| `search-edge-cases.spec.js` | `artist:`, `title:`, `tag:` filter syntax, tag dropdown, URL encoding |
| `song-view.spec.js` | Title/artist, content, Key/Display/Info pill behaviors, Export print |
| `work-view.spec.js` | Work URL routing, tablature in bottom band, part tabs, playback, and the band collapsing on its own width (container pinned, viewport left wide) |
| `arrangement-pill.spec.js` | Multi-version groups: pill listing, navigation, vote gating (replaces the old version-picker modal tests) |
| `navigation.spec.js` | Top-band nav links, deep links, `#song`→`#work` redirect, history |
| `landing-page.spec.js` | Collection cards, landing search, URL routing |
| `favorites.spec.js` | Empty state, adding/removing songs, viewing favorites |
| `list-management.spec.js` | List CRUD via picker + Song Lists view, sharing buttons |
| `editor.spec.js` | Add-song picker flow, `#add`/`#edit` deep links, editor fields, validation |
| `visual-editor.spec.js` | Two-pane editor: chord strip, lyric editing, palette |
| `transposition.spec.js` | Key pill: key grid, semitone steps, Nashville, edge cases |
| `print-options.spec.js` | Export pill actions (print/copy/download), list print |
| `ui.spec.js` | Theme toggle (top band), auto-hiding chrome, overflow menu, pref persistence |
| `abc-notation.spec.js` | ABC sheet music display, bottom-band playback controls |
| `error-states.spec.js` | Not-found states, invalid URLs, graceful errors |
| `otf-editor.spec.js` | OTF editor: the dev harness (`/editor-demo.html`), the in-app Go-to-measure / Tempo prompts, and the song page's authoring mode (`#new-tab`; `/create.html` is a redirect shim into it) |
| `otf-editor-visual.spec.js` | OTF editor visual/screenshot checks |
| `otf-editor-mobile.spec.js` | **mobile project.** Band collapses to ⚙; edit session's buttons stay on the band; menu bar collapses to ☰; `Press ? for help`; digits still enter notes; Cancel asks inline |
| `otf-editor-submit.spec.js` | Correction and new-tab submissions against the Supabase mock; "live but not synced"; the anonymous sign-in gate |
| `otf-editor-files.spec.js` | ⬇ Download + Ctrl+S (real `download` events); `.tef` via the band's 📂 button and via a drop anywhere on the app |
| `otf-editor-selection.spec.js` | **The selection is a rectangle.** Drag string 3 of measure 2 → string 5 of measure 4 on `red-haired-boy/banjo`: the highlight box is checked against the renderer's own string-line y's, `Delete` and `+` are checked against the live document (`.otf-editor.__otfEditor.state.facade`), a refused block `+` is checked in `.status-flash`, and `Ctrl+z` takes the block back in one step |
| `otf-editor-tracks.spec.js` | Multi-track (`red-haired-boy` ensemble): switch by toolbar and by Score ▸ Tracks, rename via the popover (+ duplicate refusal), reorder, undo |
| `otf-editor-drafts.spec.js` | `#drafts`: autosave appears, Open reopens on the right route with the note, inline-confirm Delete |
| `helpers.js` | Shared helpers (not a spec) |
| `helpers/supabase-mock.js` | Mocked backend (not a spec) — see above |
| `helpers/tef-fixture.js` | A real `.tef` from the golden corpus (not a spec) |

## Conventions

- Tests use hash-based routing: `/#search`, `/#work/slug`, `/#add`, `/#edit/slug`
- Shared helpers live in `e2e/helpers.js`:
  - `gotoSearch(page)` — go to `#search` and wait for the index to load
  - `searchFor(page, q)` / `searchAndOpen(page, q)` — query + open first result
  - `navClick(page, id)` — click a top-band nav link by `data-nav` id
  - `openPill(page, pillId)` — open a pill popover, returns its locator
- localStorage is cleared in `beforeEach` where isolation matters
- Wait for `#search-stats` to contain "songs" before navigating away from
  search — the post-index-load render stomps earlier navigation
- Use `.first()` for strict mode compliance when multiple elements match
- **Never accept a native dialog to make a test pass in the tab editor.** If a
  flow needs `page.on('dialog')` there, the product is wrong — register the
  listener and assert it stayed empty instead (that is the check, not a
  workaround)
- Anything that talks to Supabase starts with `await mockSupabase(page)` and
  ends with `sb.assertClean()`
- Editor selectors worth knowing: `.editor-renderer .stave-row` (mounted),
  `.editor-canvas-container` (click to place the cursor), `.note-text`,
  `.editor-status-bar`, `.track-buttons .track-button[.active]`,
  `.menu-trigger[data-menu="score"]` → `.menu-popup .menu-item` (track entries
  are `menuitemradio`, so `[role=menuitem]` misses them),
  `.otf-track-name-popover`, `.otf-value-prompt-popover`,
  `.editor-selection-rect` (one per row/measure the selection crosses,
  clipped to the selected strings) and `.editor-status-bar .status-flash`
  (what a refused op says); the session's buttons
  live in the bottom band as `.tab-edit-submit` / `.tab-edit-download` /
  `.tab-edit-cancel` / `.tab-edit-done` / `.tab-edit-import`
- Useful fixture works: `old-home-place` (plain lead sheet; note the jam-repertoire
  prune hides non-bluegrass rows like `your-cheating-heart` from search),
  `wagon-wheel` (2-version group → arrangement pill),
  `arkansas-traveler-1` (lead sheet + banjo tab → part tabs),
  `foggy-mountain-breakdown` (tab-only, mandolin part),
  `angeline-the-baker` → `angeline-baker` (legacy slug redirect),
  `abbey-reel-the` (ABC notation),
  `foggy-mountain-breakdown/mandolin` (a published tab to correct),
  `red-haired-boy/ensemble-tab` (six tracks — the multi-track fixture)
