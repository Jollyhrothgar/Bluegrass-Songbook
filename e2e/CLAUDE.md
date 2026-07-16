# E2E Tests

Playwright end-to-end tests for the Bluegrass Songbook frontend.

## Running

```bash
npm run test:e2e       # Run all E2E tests
npm run test:all       # Run unit tests + E2E tests
```

## Configuration

- **Config**: `playwright.config.js` (project root)
- **Web server**: Starts `./scripts/server` on port 8080 automatically
- **Viewport**: 1440x900 (wide, keeps sidebar visible)
- **Reuse server**: `reuseExistingServer: true` - won't restart if already running

## Test Specs

| Spec | Coverage |
|------|----------|
| `search.spec.js` | Basic search, result display, search prompt |
| `search-edge-cases.spec.js` | `artist:`, `title:`, `tag:` filter syntax |
| `song-view.spec.js` | Song title/artist, chord/lyrics content, Info disclosure |
| `work-view.spec.js` | Work URL routing, tablature rendering, controls disclosure |
| `navigation.spec.js` | Home page, sidebar nav links, URL hash changes |
| `landing-page.spec.js` | Collection cards loading, expected collection titles |
| `favorites.spec.js` | Empty state, adding/removing songs, viewing favorites |
| `list-management.spec.js` | List CRUD, add/remove songs, ordering |
| `editor.spec.js` | Editor UI, form fields visibility |
| `transposition.spec.js` | Key detection, key selector, explicit key directives |
| `version-picker.spec.js` | Multi-version detection, version picker modal |
| `print-options.spec.js` | Print button, export dropdown, P keyboard shortcut |
| `ui.spec.js` | Theme toggle (light/dark), fullscreen mode, settings |
| `abc-notation.spec.js` | ABC notation sheet music display, playback controls |
| `error-states.spec.js` | Invalid URLs, non-existent songs/works, graceful errors |

## Conventions

- Tests use hash-based routing: `/#search`, `/#work/slug`, `/#song/id`
- Common helpers: `openSidebar(page)`, `closeSidebar(page)` (defined inline per spec)
- localStorage is cleared in `beforeEach` for isolation
- Timeouts: 2000-10000ms depending on operation (search loads, async renders)
- Use `.first()` for strict mode compliance when multiple elements match
