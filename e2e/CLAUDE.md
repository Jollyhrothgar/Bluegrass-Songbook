# E2E Tests

Playwright end-to-end tests for the Bluegrass Songbook frontend
(post-redesign shell UI: slim top band, unified song page, pill popovers).

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
- **Viewport**: 1440x900

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
  `history.replaceState`. Structure: title row (`.song-title`, `#focus-btn`),
  `.song-artist-line`, pill row `#song-pill-row` (`#key-pill`, `#display-pill`,
  `#info-pill`, `#arrangement-pill` when the group has >1 version), part tabs
  `#part-tabs .part-tab` when a work has >1 part, content below.
- **Pills** (`shell.js` `pill()` primitive): `.pill-btn` opens `.pill-popover`;
  only one popover open at a time; outside click / Escape closes.
- **Bottom band** (`#app-bottomband`): tablature playback controls
  (`.tab-play-btn`, `.tab-tempo-*`, mixer) and ABC controls (`#abc-play-btn`,
  `#abc-tempo-label`).
- **Focus mode**: `body.immersive` (F toggles, Esc exits, `#focus-btn`).
- **Feedback**: one unified modal `#flag-modal` (type selector), opened from
  the overflow menu ("Send Feedback" everywhere, "Report issue" on song pages).
- **List navigation**: `#song-nav-bar` (bottom bar) still used in list context.

## Test Specs

| Spec | Coverage |
|------|----------|
| `search.spec.js` | Basic search, result display, search prompt |
| `search-edge-cases.spec.js` | `artist:`, `title:`, `tag:` filter syntax, tag dropdown, URL encoding |
| `song-view.spec.js` | Title/artist, content, Key/Display/Info pill behaviors, Export print |
| `work-view.spec.js` | Work URL routing, tablature in bottom band, part tabs, playback |
| `arrangement-pill.spec.js` | Multi-version groups: pill listing, navigation, vote gating (replaces the old version-picker modal tests) |
| `navigation.spec.js` | Top-band nav links, deep links, `#song`→`#work` redirect, history |
| `landing-page.spec.js` | Collection cards, landing search, URL routing |
| `favorites.spec.js` | Empty state, adding/removing songs, viewing favorites |
| `list-management.spec.js` | List CRUD via picker + Song Lists view, sharing buttons |
| `editor.spec.js` | Add-song picker flow, `#add`/`#edit` deep links, editor fields, validation |
| `visual-editor.spec.js` | Two-pane editor: chord strip, lyric editing, palette |
| `transposition.spec.js` | Key pill: key grid, semitone steps, Nashville, edge cases |
| `print-options.spec.js` | Export pill actions (print/copy/download), list print |
| `ui.spec.js` | Theme toggle (top band), focus mode (immersive), overflow menu, pref persistence |
| `abc-notation.spec.js` | ABC sheet music display, bottom-band playback controls |
| `error-states.spec.js` | Not-found states, invalid URLs, graceful errors |
| `otf-editor.spec.js` | Standalone OTF editor demo (`/editor-demo.html`, `/create.html`) |
| `otf-editor-visual.spec.js` | OTF editor visual/screenshot checks |
| `helpers.js` | Shared helpers (not a spec) |

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
- Useful fixture works: `your-cheating-heart` (plain lead sheet),
  `wagon-wheel` (2-version group → arrangement pill),
  `arkansas-traveler-1` (lead sheet + banjo tab → part tabs),
  `foggy-mountain-breakdown` (tab-only, mandolin part),
  `angeline-the-baker` → `angeline-baker` (legacy slug redirect),
  `abbey-reel-the` (ABC notation)
