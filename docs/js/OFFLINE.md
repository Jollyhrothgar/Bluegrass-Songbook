# Offline / PWA: the service worker's caching strategy

Read this before changing `docs/sw.js`, `js/sw-strategy.js`, `js/pwa.js` or
`js/lazy-modules.js`, or when a deploy seems to leave users on a mix of old and
new code.

`js/sw-strategy.js::routeFor()` is the only place that decides how a request is
cached. `sw.js` is a mechanical shell around it, so the table is unit-tested
(`js/__tests__/sw-strategy.test.js`) without a service-worker runtime.
`e2e/sw-and-prefetch.spec.js` exercises the real worker against a delaying
proxy (`page.route` cannot do it: Playwright turns the HTTP cache off while a
route is installed, which makes every request `cache: 'reload'`).

| Request | Strategy | Cache | Why |
|---|---|---|---|
| Navigations and other same-origin GETs (`.html`, `.js`, `.css`) | network-first, `NETWORK_TIMEOUT_MS` (1.8 s) | `bgb-shell-<ver>` | Nothing is content-hashed. The cache answers when the network fails, or when it has not answered in time and a cached copy exists. Navigation preload is on. |
| `data/*.jsonl`, `data/**.json` (incl. `data/tabs/*.json`), `data/songs/*.pro` | stale-while-revalidate | `bgb-data-<ver>` | Rebuilt by every deploy and big: paint instantly, refresh behind. The refresh sends `cache: 'no-cache'` (a conditional request) so GitHub Pages' `max-age=600` cannot keep the cache a deploy behind. |
| `surikov.github.io/*` (WebAudioFont), jsDelivr `bravura` | cache-first | `bgb-vendor-<ver>` | Immutable third-party assets; opaque responses are cached on purpose. |
| `*.supabase.co`, non-GET, other third parties (analytics, abcjs and supabase-js CDN bundles), non-http schemes | bypass | none | Not ours. No `respondWith`. |

A navigation that misses the cache offline falls back to `./index.html`; its
`<base href="/">` and path routing let the shell serve any route, `/songs/...`
included. Offline support starts on the second visit: the first visit's
requests predate the worker's control, so they are not in its cache.

## Why the shell is network-first, not stale-while-revalidate

There is no build step and no content hashing, so one deploy changes dozens of
ES modules at once. Stale-while-revalidate would serve old copies of some
modules beside new copies of others, and a module importing a name its old
sibling does not export is a blank app. Network-first picks a deploy up on the
next load (up to ten minutes later because GitHub Pages sends `max-age=600`).
To keep one page load on one generation of the app, `shellPolicy()` makes the
choice sticky in both directions:

- Slow latch (`slowSince`): once one shell request has timed out to the cache,
  every shell request prefers its cached copy for `SLOW_NETWORK_WINDOW_MS`
  (15 s), so the load stays on the old generation.
- Fresh latch (`freshSince`): once any ES-module request (`startsFreshWindow`:
  destination `script`, mode `cors`) has been answered by the network, every
  shell request waits for the network (cache only on a network error) for
  `FRESH_NETWORK_WINDOW_MS` (15 s). The window is anchored at the first answer,
  and a navigation resets it. Stylesheets and the page itself do not start it.
- The slow latch wins a tie.
- A hard reload (`wantsFreshNetwork`: `cache: 'reload'` or `'no-store'`) never
  falls back on a timeout. It is also the escape hatch if a bad worker or stale
  cache misbehaves.

Residual mix that cannot be fixed without content hashing: a module the cache
has never held (a lazy import not yet visited, or a file a deploy added) comes
from the network even during the slow latch. A hard reload fixes it.

## Updating the worker

`pwa.js` registers with `updateViaCache: 'none'`, so an update check fetches
`sw.js` and its imports (`sw-strategy.js`) from the network. Otherwise
`max-age=600` could pair a new `sw.js` with an old `sw-strategy.js` that lacks a
name it imports; the install fails (the old worker stays) but the update stalls.

## What a deploy needs

Shipping new JS, CSS or a rebuilt `index.jsonl` needs no cache bump. Bump
`CACHE_VERSION` in `js/sw-strategy.js` only when the strategy changes: a route
moves between rows of the table, a cache splits, the stored shape changes.
Every cache name carries the version, and `activate` deletes every `bgb-` cache
from other generations (`staleCaches()`). The new worker calls `skipWaiting()`
and `clients.claim()` and posts `{type: 'sw-activated'}`; `pwa.js` turns that
into an "Updated, reload for the new version" toast for tabs that already had a
controller.

`PRECACHE_URLS` is the shell entries plus `LAZY_MODULE_URLS`
(`js/lazy-modules.js`): every module outside the boot graph. Boot modules are in
the runtime cache because every online load requests them; a lazy module is
requested only when its route first runs, so someone who went offline first
would find it missing. `js/__tests__/lazy-modules.test.js` derives the lazy set
from the source (`import()` edges minus the static closure of `main.js`) and
fails with the exact difference.

## Drafts, file handling, icons

- `js/drafts.js` is an IndexedDB bucket (`bgb-drafts` / `drafts`) of
  `{id, title, instrument, workId?, takeRef?, otf, updatedAt}`. The tab editor
  autosaves into it (debounced ~1 s, `createAutosaver`), wired in
  `work-view.js::mountTabEditor`, never inside the editor. Submit and Cancel
  clear the draft; Done flushes and keeps it. Storage is injected
  (`memoryBackend()` / `idbBackend()`), which is why the tests need no
  `fake-indexeddb`; without IndexedDB it degrades to memory.
- `migrateLegacyDraft()` imports the old single-slot localStorage draft
  (`otf-editor-draft`) once and leaves the copy in place:
  `startAddTabMode` still resumes a half-written new take from it, inside a
  render that cannot wait on IndexedDB.
- `draftOpenHash()` builds the reopen route (`#new-tab?draft=`,
  `#work/{slug}/add-tab?draft=`, `#work/{slug}/edit/{take}?draft=`).
  `main.js::openTabRoute` reads `?draft=` back out of the bucket (async) and
  hands the document to `openNewTabPage({otf})`, `openWork(id, {addTab: {otf}})`
  or `openWork(id, {editRef, draft})`. `work-view.js` parks a `draft` option in
  `pendingDraft`, which `mountTabEditor` consumes; the draft wins over the
  published take. `create.html` forwards `?draft=` too.
- `.tef` and `.otf.json` open the same way whether the OS handed them over
  (`launchQueue`, installed Chromium app) or they were dropped on the window
  (`enableFileDrop`): parse, park the document as a draft, route to
  `#new-tab?draft=...&file=1`. A hash route cannot carry a document, so the
  draft is the handoff. Elements with their own drop zone set `data-file-drop`.
- Icons (favicons, `apple-touch-icon.png`, manifest `icon-*.png`) are rendered
  from `images/favicon.svg` by `scripts/lib/make_icons.py`
  (`uv run --with resvg-py python scripts/lib/make_icons.py`). Nothing in the
  build calls it; re-run it when the logo changes. Pages link the PNGs, never
  the SVG (a browser rasterizes an SVG favicon plainly and it goes muddy at tab
  size). Every page needs a 48 px multiple and an `apple-touch-icon` for Google
  Search's result icon (`tests/test_favicons.py`).
