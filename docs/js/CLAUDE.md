# Frontend (docs/js)

Single-page search application for the Bluegrass Songbook. Modularized into ES modules.

## Files

```
docs/
├── index.html          # Page structure, modals (chrome is built by js/shell.js)
├── blog.html           # Dev blog
├── js/
│   ├── main.js         # Entry point, initialization, event wiring, routing
│   ├── shell.js        # App shell: top band, bottom band, pill primitive
│   ├── state.js        # Shared state (allSongs, currentSong, etc.)
│   ├── corpus.js       # Corpus assembly: canon + lazy archive + pending merge
│   ├── song-content.js # ChordPro on demand (data/songs/{id}.pro) + has_* flags
│   ├── search-core.js  # Search logic, query parsing, filtering
│   ├── work-view.js    # THE unified song page (openWork) — all routes land here
│   ├── song-view.js    # Lead-sheet rendering helpers, ABC notation, list nav
│   ├── song-controls.js # Pill builders: Key / Display / Info / Export
│   ├── tab-controls-sheet.js # Phone: re-parents the tab band's non-transport controls into a ⚙ settings sheet
│   ├── chords.js       # Transposition, Nashville numbers, key detection
│   ├── tags.js         # Tag dropdown, filtering, virtual instrument tags/facets
│   ├── title-match.js  # Song-title normalization (bounty board dedupe)
│   ├── lists.js        # User lists, favorites, multi-owner, Thunderdome
│   ├── list-picker.js  # List picker popup component
│   ├── editor.js       # Song editor (Raw tab), re-exports smart-paste pipeline
│   ├── smart-paste.js  # Shared chord-sheet→ChordPro conversion (Raw + Visual paste)
│   ├── dedup-check.js  # "This song already exists" scorer — MIRRORS scripts/lib/dedup_scorer.py
│   ├── flags.js        # Unified feedback modal (song issues, bugs, general feedback)
│   ├── add-song-picker.js # Add/request-a-song picker (also serves #request-song)
│   ├── superuser-request.js # Super-user request modal and submission
│   ├── high-scores.js  # `#high-scores` leaderboard — renders `get_leaderboard()`; identities are resolved SERVER-side (no email/uuid ever reaches this file)
│   ├── collections.js  # Landing page collection definitions
│   ├── analytics.js    # Behavioral analytics tracking
│   ├── utils.js        # Shared utilities (escapeHtml, etc.)
│   ├── audio-unlock.js # iOS audio: SYNC resume inside the tap + ringer-switch escape (never await before calling it)
│   ├── supabase-auth.js # Auth, cloud sync, voting
│   ├── renderers/      # Part renderers
│   │   ├── index.js    # Renderer registry
│   │   ├── chordpro.js # THE ChordPro renderer (parse + render, shared everywhere)
│   │   ├── tablature.js # Tablature display
│   │   ├── tab-player.js # Interactive tab player with playback
│   │   ├── tab-ascii.js # ASCII tab format
│   │   ├── otf-tracks.js # isPercussionTrack / pitchedTracks (shared filter)
│   │   └── measure-timing.js # Measure timing helpers for playback
│   ├── chord-explorer/ # Chord exploration tool (standalone)
│   ├── visual-editor/  # Two-pane editor: interactive preview + ChordPro model
│   ├── otf-editor/     # Tablature editor
│   └── __tests__/      # Vitest unit tests
├── css/style.css       # Dark/light themes, responsive layout
├── posts/              # Blog posts (markdown)
└── data/
    ├── index.jsonl     # SEARCHABLE canon only, no ChordPro (`wc -l` it)
    ├── archive.jsonl   # Pruned rows, same shape, lyrics truncated (lazy)
    ├── songs/{id}.pro  # Full ChordPro per work — fetched when a page opens
    ├── posts.json      # Blog manifest (built by scripts/lib/build_posts.py)
    └── bounty_decisions.json  # Wanted-list verdicts (built from
                        # curation/bounty_decisions.yaml at index build)
```

## Quick Start

```bash
./scripts/server        # Start at http://localhost:8080
```

## Architecture

### App Shell (`shell.js`)

All persistent chrome lives in the app shell — there is no sidebar, hamburger,
quick-controls bar, or bottom sheet anymore:

- **Top band** (`.app-topbar`): back button, brand, nav links, page title,
  per-page action buttons, theme toggle, and an overflow (⋯) menu.
  Pages declare their chrome with `setTopBar({ back, title, actions, overflow, navActive })`.
- **Bottom band** (`.app-bottomband`): the one home for practice/playback
  controls (tab player transport, track mixer, ABC controls). Mount content
  with `setBottomBand(el)`; pass `null` to hide it. Its height is NOT a
  constant — the phone tab strip is 65px, a wrapped desktop band is 88px —
  so shell.js publishes the measured height as `--bottomband-h` on
  `<html>` (ResizeObserver + on every `setBottomBand`). Anything stacked on
  the band (drop-up popovers, the tab settings sheet, `.container`'s
  bottom padding) offsets off that variable, never a literal.
- **Phone tab band** (`tab-controls-sheet.js`): at ≤640px the band keeps
  Play / Stop / tempo / loop / ⚙ and the ⚙ sheet holds everything else
  (size, key, layout, feel, count-in, metronome, mixer, Edit). The controls
  are MOVED into the sheet, not rebuilt — the sheet lives inside
  `.tab-controls`, so `controls.querySelector(...)` in
  `setupTablaturePlayer` and the listeners it attached both survive.
  Widening the viewport moves them back and deletes the sheet, so the
  desktop DOM is byte-identical to `createTablatureControls`' output.
- **Pill primitive**: `pill(label, buildContent, opts)` returns a small
  labeled button that opens a popover. All song-page controls are pills.
- **Auto-hiding chrome** (`setChromeAutoHide(on)`, enabled on song pages):
  the top band hides as you scroll down (`body.chrome-hidden`, 4px peek
  strip) and returns on scroll-up, hover, tapping the strip, or reaching
  the top. There is no focus mode — immersion is automatic.

### Unified Song Page (`work-view.js`)

ONE page per song: title + artist, a pill row (Key / Display / Info /
Arrangement), part tabs when a work has multiple parts, the active part's
content, and the shell's top/bottom bands for actions and playback.

- **Every route lands in `openWork()`** — search results, lists, deep links,
  history. `openSong()` still exists as a thin wrapper that calls
  `openWork(id, { exact: true })`.
- **Pills** are built by `song-controls.js` (`buildKeyPill`, `buildDisplayPill`,
  `buildInfoPill`, `buildExportPill`) plus the Arrangement pill in
  work-view.js (version switching + voting, replacing the old version-picker
  modal and dashboard cards).
- **One renderer**: ChordPro parsing/rendering is shared from
  `renderers/chordpro.js` (`parseChordPro` is re-exported by song-view.js for
  compatibility).
- **Routing**: `#work/{slug}` (optionally `#work/{slug}/{partId}`) is the
  canonical URL. Legacy `#song/{id}` URLs resolve to the work and are
  rewritten with `history.replaceState`. List-context pages keep
  `#list/{listId}/{workId}` URLs.

### State Variables

State is managed via a **reactive pub/sub system** in `state.js`. Variables have getters/setters that notify subscribers on change:

```javascript
// Reactive pattern example:
import { currentSong, setCurrentSong, subscribe } from './state.js';

// Subscribe to state changes
subscribe('currentSong', (newSong, oldSong) => {
    console.log('Song changed from', oldSong?.title, 'to', newSong?.title);
});

// Update state (triggers subscribers)
setCurrentSong(song);
```

**Core state:**
```javascript
let allSongs = [];              // Array of song objects (loaded from index.jsonl)
let songGroups = {};            // Map of group_id → [songs] for versions
let currentSong = null;         // Currently viewed song
let currentChordpro = null;     // Raw ChordPro content
let currentView = 'search';     // 'search' | 'song' | 'work' | 'add-song' | 'blog'
```

**Works/tablature state:**
```javascript
let loadedTablature = null;     // Currently loaded OTF tablature data
let tablaturePlayer = null;     // Active TabPlayer instance
let activePartTab = 0;          // Currently selected part index in work view
```

**Display modes:**
```javascript
let nashvilleMode = false;      // Show Nashville numbers
let compactMode = false;        // Reduce whitespace
let currentDetectedKey = null;  // Current key (for transposition)
let chordDisplayMode = 'all';   // 'all' | 'first' | 'none'
let fontSizeLevel = 2;          // Index into FONT_SIZES array
```

**User data:**
```javascript
let favorites = new Set();      // Song IDs (localStorage or synced)
let userLists = [];             // Custom user lists (via supabase-auth.js)
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `loadIndex()` | Fetch/parse `data/index.jsonl` (canon only), merge, then schedule the archive |
| `ensureArchiveLoaded()` | `window.` hook: await `archive.jsonl` once before declaring an id unknown |
| `getSongContent(song)` | ChordPro for a work: cached fetch of `data/songs/{id}.pro` (song-content.js) |
| `songHasContent(song)` / `songHasAbc(song)` | Cheap, sync "does this work have a lead sheet / ABC" |
| `refreshPendingSongs()` | Re-fetch pending songs from Supabase, merge into allSongs |
| `search(query)` | Filter songs by query, chords, progression |
| `renderResults(songs)` | Display search results list (with version badges) |
| `openWork(workSlug, opts)` | THE song page entry point (parts, pills, tablature) |
| `openSong(songId)` | Thin wrapper: `openWork(id, { exact: true })` |
| `parseChordPro(content)` | Parse ChordPro → structured sections (renderers/chordpro.js) |
| `transposeChord(chord, semitones)` | Transpose individual chord |
| `toNashville(chord, key)` | Convert chord to Nashville number |
| `detectKey(chords)` | Auto-detect key from chord list |
| `setTopBar(config)` / `setBottomBand(el)` | Declare page chrome in the app shell |
| `openPrintView()` | Open print-optimized view in new window |

### Search Features

**Keyword search**: Matches title, artist, lyrics
```
blue moon kentucky
```

**Field-specific filters**: Target specific metadata
```
artist:hank williams      # Filter by artist (multi-word supported)
title:blue moon           # Filter by title
lyrics:lonesome highway   # Filter by lyrics content
tag:bluegrass             # Filter by tag; whole value = tags (commas or spaces)
tag:fiddle                # Instrument tag (see "Instrument tags" below)
composer:bill monroe      # Filter by composer/writer
```

**Instrument tags** are *virtual* — derived per row by
`tags.js getInstrumentTags(song)`, never stored:

| Tag | Comes from |
|-----|------------|
| `tag:banjo` / `mandolin` / `guitar` / `fiddle` / `dobro` / `bass` | a tablature part whose instrument is in that family (`5-string-banjo` also answers to `banjo`, and to `tag:5-string-banjo`) |
| `tag:tenor-banjo` | a tenor banjo part (also matches `tag:banjo`) |
| `tag:fiddle` + `tag:notation` | `has_abc: true` (ABC notation) |
| `tag:multipart` | any part with `tracks > 1`, or an `ensemble` part |

That one function is THE source: `songHasTags` matching (case- and
separator-insensitive), the result-card instrument badges, the Tags
dropdown's Instruments group, and the Instrument facet pill all read it.
Add a facet by adding it to `INSTRUMENT_FACETS` in `tags.js` (and the
matching checkbox in `index.html`).

There is deliberately NO `key:` filter — keys are transposable, so the
detected key is display metadata (song page "Key of G" pill), not a search
dimension (removed 2026-07-31 at Mike's direction). `status:`/`has:` and
all negations except `-tag:` were removed at the same time; typing any of
them degrades to plain text.

**Negative filter** (`-tag:` is the only negation)
```
tag:bluegrass -tag:instrumental    # Bluegrass but not instrumentals
```

**Facet UI**: the search page and the landing page share one-tap facet
chips (Instrumentals/Gospel/Old-Time/Waltzes/Jam-Friendly) plus the
**Chords** and **Instrument** popovers (`#search-facet-pills`, built by
`search-core.js`); all of them write syntax into the search box (helpers in
`search-query.js`) so the box stays the single source of truth. The
Instrument pill routes through `tags.js toggleFacetTag`, so it and the Tags
dropdown checkbox for the same tag can never disagree; any surface can keep
itself in step by registering with `tags.js onTagSync(fn)`.

**Chord search**: Find songs with specific Nashville numbers
```
chord:VII        # Songs with VII chord
chord:VII,II     # Songs with both VII and II
```

**Progression search**: Find songs with chord sequences
```
prog:I-IV-V      # Classic progression
prog:ii-V-I      # Jazz turnaround
```

**Combining filters**: Mix and match
```
artist:hank williams tag:honkytonk chord:VII
```

### Song Rendering Pipeline

```
ChordPro string
    ↓ parseChordPro()
Sections array [{type, label, lines, repeatOf}]
    ↓ renderSong()
HTML with chord highlighting
    ↓ (if nashvilleMode)
Nashville number conversion
    ↓ (if transposed)
Chord transposition applied
```

### Works and Renderers

Works can have multiple parts (lead sheet, tablature, ABC notation). The renderer system handles different formats:

```
work-view.js
    ↓ selectPart(partIndex)
    ↓ getRenderer(part.format)
renderers/
    ├── tablature.js      # OpenTabFormat JSON → interactive tab display
    ├── tab-player.js     # TabPlayer class with playback controls
    └── tab-ascii.js      # ASCII tablature format
```

**TabPlayer features:**
- Play/pause with tempo control
- Note highlighting during playback
- Measure navigation
- Loop sections

### Routing: everything is openWork

There is ONE rendering path. `openWork(id, opts)` handles lead sheets,
tablature-only works, and multi-part works alike (part tabs select the
active part; the track mixer mounts in the bottom band for multi-track
tabs). `openSong(id)` survives only as a compatibility wrapper that calls
`openWork(id, { exact: true })` — it shows exactly the requested version
instead of the group representative.

URL forms:

- `#work/{slug}` — canonical song URL (`#work/{slug}/{partId}` for a part)
- `#song/{id}` — legacy; resolved via `resolveWorkId()` and rewritten to
  `#work/{slug}` with `history.replaceState`
- `#list/{listId}/{workId}` — list-context pages keep list URLs

### Track Mixer (Multi-Track Tablature)

Multi-track tabs (e.g., ensemble arrangements with guitar, banjo, mandolin, bass) show a track mixer:

- Appears above the tablature when OTF has multiple tracks
- Toggle visibility of each track
- Solo a single track
- Shows instrument icon and name per track

**Track detection** is based on the `instrument` field in the OTF:
- `5-string-banjo`, `6-string-guitar`, `mandolin`, `upright-bass`, etc.
- Falls back to track index if no instrument name

**Percussion tracks are excluded from mixer, playback and the OTF editor**
via `isPercussionTrack` / `pitchedTracks` in `renderers/otf-tracks.js`. A
drum track (`percussion: true`, `instrument: 'percussion'`, empty
`tuning`) is not pitched: its `s` is a kit staff line, so `tuning[s-1] + f`
yields nonsense. Use the shared predicate — never sniff track names, which
lie (one drum track is named "Guitar Standard").

On the song page the track IS shown, greyed out (`.percussion-track` +
`.percussion-placeholder`), with a "drum notation is in progress" note,
and it gets a track-view tab like any other. Deliberate: we can detect a
drum track reliably but not yet which drum each line means, so drawing a
stave would be fiction and hiding it would be a lie by omission. See
`sources/banjo-hangout/CLAUDE.md` for what's known about the mapping.

### Transposition

- `currentDetectedKey` tracks the current key
- Key selector dropdown triggers re-render
- `transposeChord()` handles sharps/flats correctly
- `getSemitonesBetweenKeys()` calculates interval

### Song Page Controls (pills)

The song page's controls are pills in a single pill row, built by
`song-controls.js`:

- **Key pill** (`buildKeyPill`): −/+ transpose, key grid, Nashville toggle,
  Strum Machine link when matched
- **Display pill** (`buildDisplayPill`): font size, two columns, section
  labels, compact, chord display mode ('all' | 'first' | 'none')
- **Info pill** (`buildInfoPill`): metadata, covering artists, tags, source
- **Export pill** (`buildExportPill`, in the top band): Print
  (`openPrintView()`), Copy ChordPro/Text, Download .pro/.txt
- **Arrangement pill** (work-view.js): switch between versions of a group,
  with vote counts and voting (replaces the old version-picker modal)

**Print view** has its own controls:
- Same options as song view
- 2-column toggle for print layout
- Labels toggle for section headers

### Editor (Add Song / Edit Song)

Two-pane editor: the raw ChordPro textarea (`#editor-content`, left) beside
a live INTERACTIVE preview (`#editor-preview-container`, right; stacked
below ~800px). The textarea is THE document — the preview renders
`parseSong(textarea.value)` and every preview-side edit writes serialized
ChordPro back into the textarea. In the preview, VERTICAL POSITION IS THE
MODE: the chord strip above each line places/edits chords (hover ghost
slot → click a seam → palette or typed entry; tap a chip → change/delete),
while clicking the lyric text swaps that line for an inline input (blur
commits with word-LCS chord re-anchoring, Enter splits, Backspace at 0
merges, Escape reverts), plus section drag/menu ops. See
`visual-editor/CLAUDE.md` for the preview orchestrator. Submit/copy/
download flows read the textarea unchanged; smart paste converts chord
sheets on paste into the textarea; selecting textarea lines reveals a
Make verse/chorus/bridge mini-bar in the pane header (pure transform in
`visual-editor/wrap-section.js`). Above the panes: compact metadata line,
undo/redo, and a progressive transpose/key/Nashville group that appears
once the song has a chord.

Functions prefixed with `editor*`:
- `enterEditMode(song)` - Open editor with existing song
- `editorConvertToChordPro()` - Smart paste: chord-above-lyrics → ChordPro
- `updateEditorPreview()` - Refresh chrome (key/toolbar) + re-render preview
- Submitting writes a `pending_songs` row and then POSTs its id to the
  `auto-commit-song` edge function (see "Contributing" below). There is no
  `submitSongToGitHub()` any more — the GitHub-issue flow and its
  `create-song-issue` function are both deleted.

### View Navigation

Views are switched through the reactive `currentView` state (`showView(mode)`
in main.js sets it; a subscriber shows/hides panels and updates the top
band's nav links). There is no sidebar — top-band nav links cover Search,
Lists, Add Song, etc., with the rest in the overflow (⋯) menu.

## Testing

```bash
npm test              # Run unit tests (Vitest)
npm run test:e2e      # Run E2E tests (Playwright, requires server)
```

### Chrome DevTools MCP

For issues that tests don't catch, use the `chrome-devtools` MCP with the dev server running:

- Inspecting rendered song/tablature layout
- Debugging state changes visually
- Profiling search performance with large result sets
- Checking network requests for index.jsonl or tablature JSON

**Interactive debugging workflow:**

```javascript
// 1. Navigate to specific deep links
mcp__chrome-devtools__navigate_page({ type: "url", url: "http://localhost:8080/#list/local_123" })

// 2. Inspect localStorage state
mcp__chrome-devtools__evaluate_script({
    function: `() => {
        const lists = JSON.parse(localStorage.getItem('songbook-lists') || '[]');
        return lists.map(l => ({ id: l.id, name: l.name, cloudId: l.cloudId }));
    }`
})

// 3. Take snapshots to find UI elements
mcp__chrome-devtools__take_snapshot()
// Returns UIDs like uid=3_44 for buttons - use these to click

// 4. Click buttons and verify state changes
mcp__chrome-devtools__click({ uid: "3_44" })  // e.g., click Share button

// 5. Check console for errors
mcp__chrome-devtools__list_console_messages({ types: ["error", "warn"] })
```

**Common scenarios:**
- Testing modals: Navigate → take_snapshot → click trigger → take_snapshot → verify modal content
- Testing local vs cloud state: Use evaluate_script to check localStorage before/after actions
- Testing deep links: Navigate directly to `#list/{id}`, `#song/{id}`, `#work/{slug}`

**Unit tests** (`__tests__/`):
- `chords.test.js` - Key detection, transposition, Nashville numbers
- `editor.test.js` - Editor functionality, ChordPro conversion
- `search-core.test.js` - Query parsing, chord/progression filtering
- `song-view.test.js` - ChordPro parsing
- `song-content.test.js` - Content on demand: cache, dedupe, legacy fallback
- `corpus.test.js` - Canon + archive + pending merge, archive gating
- `tags.test.js` - Tag matching + virtual instrument tag derivation
- `state.test.js` - State management, pub/sub system
- `utils.test.js` - Utility functions

**E2E tests** (`../../e2e/`):
- `abc-notation.spec.js` - ABC notation rendering for fiddle tunes
- `arrangement-pill.spec.js` - Arrangement pill (version switching/voting)
- `editor.spec.js` - Song editor flows
- `error-states.spec.js` - Error handling and edge cases
- `favorites.spec.js` - Favorites and lists
- `landing-page.spec.js` - Homepage collections and navigation
- `list-management.spec.js` - List CRUD, sharing, multi-owner
- `navigation.spec.js` - URL routing, deep links
- `otf-editor.spec.js` / `otf-editor-visual.spec.js` - Tablature editor
- `print-options.spec.js` - Print view and export options
- `search.spec.js` - Search and filtering flows
- `search-edge-cases.spec.js` - Complex search scenarios
- `song-view.spec.js` - Song display and controls
- `transposition.spec.js` - Key transposition features
- `ui.spec.js` - UI interactions, modals, navigation
- `visual-editor.spec.js` - Visual editor preview
- `work-view.spec.js` - Unified song page with parts/tablature

## Adding a Feature

1. **Identify the right module** - search in `search-core.js`, song display in `song-view.js`, etc.
2. **Add state** (if needed) in `state.js` and export it
3. **Add DOM element reference** in `main.js` DOM elements section
4. **Implement function** in the appropriate module, export it
5. **Wire up event listener** in `main.js` init function
6. **Add UI** in `index.html` if needed
7. **Style** in `css/style.css`
8. **Test** - Run `npm test` to verify
9. **Push** - CI will syntax-check and run unit tests

## Common Patterns

### Showing/hiding panels
```javascript
element.classList.add('hidden');
element.classList.remove('hidden');
```

### Saving to localStorage
```javascript
localStorage.setItem('songbook-key', JSON.stringify(value));
const value = JSON.parse(localStorage.getItem('songbook-key') || 'default');
```

### Re-rendering after state change
```javascript
showChords = e.target.checked;
renderSong(currentSong, currentChordpro);  // Re-render with new state
```

## Data Format

The index is **split three ways** (2026-07): a lean searchable canon, a lazy
archive, and one ChordPro file per work. Nothing in `index.jsonl` carries song
text beyond `lyrics` / `first_line` (which search snippets need).

```
data/index.jsonl      searchable canon rows              fetched at startup
                      (2,462 on 2026-08-19 — `wc -l` it
                       after a build rather than trusting
                       a number in this file)
data/archive.jsonl    pruned rows, lyrics truncated      fetched when idle
data/songs/{id}.pro   the work's full ChordPro           fetched per song page
```

A row in `index.jsonl` (or `archive.jsonl` — same shape, plus `indexed: false`):
```json
{
  "id": "blue-moon-of-kentucky",
  "title": "Blue Moon of Kentucky",
  "artist": "Bill Monroe",
  "composer": "Bill Monroe",
  "first_line": "Blue moon of Kentucky keep on shining",
  "lyrics": "Blue moon of Kentucky...",
  "has_content": true,
  "has_abc": true,
  "key": "G",
  "mode": "major",
  "nashville": ["I", "IV", "V", "V7"],
  "progression": ["I", "IV", "V", "I", "V7", "I"],
  "group_id": "abc123def456_12345678",
  "chord_count": 4,
  "version_label": "Simplified",
  "version_type": "simplified",
  "arrangement_by": "John Smith"
}
```

**Content flags** (there is no `content` field any more):
- `has_content: true` — a lead sheet exists at `data/songs/{id}.pro`
- `has_abc: true` — that lead sheet contains an ABC notation block

**Reading content — always through `song-content.js`, never `song.content`:**
```javascript
import { getSongContent, songHasContent, songHasAbc, peekSongContent }
    from './song-content.js';

if (songHasContent(song)) {            // sync, flag-based
    const chordpro = await getSongContent(song);   // cached + deduped fetch
}
```
`getSongContent` **degrades to either index generation**: a row that still
carries an inline `content` string (the old fat index, Supabase pending rows,
synthetic editor rows) resolves to that string with no request. Rows with
neither the flag nor a string resolve to `''` — no speculative 404s on
tab-only works. `peekSongContent` returns what's already in hand (or `null`)
for code that cannot await; a failed fetch is never cached, so the song
page's Retry actually retries.

**Corpus assembly** (`corpus.js` + `loadIndex`/`loadArchive` in main.js): the
canon blocks first paint; `archive.jsonl` is fetched on
`requestIdleCallback` (2s `setTimeout` fallback) and re-merged, which notifies
`allSongs` subscribers so list views re-render with archived rows. Archive rows
are forced to `indexed: false`, so search, collection counts and the songbook
total ignore them while deep links, lists and redirects still resolve. Any path
that fails to find an id awaits `window.ensureArchiveLoaded()` **once** before
showing "not found" (openWork, `#song/` redirects, `#edit/` deep links).

**Version fields** (for alternate arrangements):
- `group_id`: Links songs that are versions of each other (stable `grp:` ids
  for curated groups)
- `version_label`: Display name ("Simplified", "Original", etc.)
- `version_type`: Category (alternate, cover, simplified, live)
- `arrangement_by`: Who created this arrangement

**Curation fields** (from `curation/registry.yaml`, applied at index build):
- `canonical`: `true` on the editorially pinned version of a group
- `variant_of`: canonical work id this row is a variant of
- `variant_label`: optional display label for the variant

**Tablature fields** (for works with tabs):
```json
{
  "tablature_parts": [{
    "instrument": "banjo",
    "label": "banjo",
    "file": "data/tabs/red-haired-boy-banjo-1687.otf.json",
    "src_file": "banjo.otf.json",   // the file inside works/{id}/
    "source": "banjo-hangout",
    "source_id": "1687",
    "author": "schlange",
    "tracks": 3          // OTF track count — >1 means "multipart"
  }],
  "has_abc": true        // ABC notation lives in data/songs/{id}.pro
}
```

### Arrangement Pill & Curation Fields

Version selection lives in the Arrangement pill on the song page (the old
version-picker modal is gone). Index rows carry editorial curation fields
from `curation/registry.yaml` (applied by `scripts/lib/curation.py` at
build time):

- `canonical: true` — this row is the editorially pinned version of its group
- `variant_of: "<canonical-id>"` — this row is a variant of a canonical work
- `variant_label: "..."` — optional display label for the variant

The pill lists the group's versions (canonical first), shows vote counts,
and lets signed-in users vote. When picking a group's representative
(search results, non-exact navigation), a `canonical` row wins outright;
otherwise: content > most chords > highest `canonical_rank`.

**Two takes on one work** (`arrangements`, issue #232). Editing a chart you
don't own doesn't overwrite it — the server lands your text as an extra
lead-sheet part on the SAME work, and the build publishes it as
`data/songs/{id}--{slug}.pro` with an entry in the row's `arrangements`:

```json
"arrangements": [
  {"slug": "default", "label": "Original", "default": true,
   "file": "data/songs/how-long-blues.pro", "key": "G", "chord_count": 4},
  {"slug": "simplified", "label": "Simplified", "arrangement_by": "Jane",
   "file": "data/songs/how-long-blues--simplified.pro", "chord_count": 3}
]
```

The field is absent unless a work really holds two charts, so nothing
changes for the rest of the corpus. In the pill, the current work expands
into one row per take; picking one calls `selectLeadSheetArrangement` and
swaps the rendered chart **in place** — same work, same URL, page state
only, exactly like tablature arrangements. Votes are cast per work id and a
part has no id, so only the primary row carries the vote button.

Content per take goes through `getArrangementContent(song, arrangement)`:
an entry's own `content` string wins (a pending submission), else its
`file` is fetched (url-keyed cache), else the work's lead sheet.

**Before the build lands**: `corpus.pendingForkArrangements` synthesizes the
same two-entry list on the pending overlay row — the published original plus
"Your arrangement" (`pending: true`, content inline) — so a fork is listed in
the pill seconds after submission instead of appearing to replace the chart
it forked from. Ownership follows `process_pending.owns_content`: the work is
yours only if a part there records you as its submitter.

## Dependencies

- **Supabase JS** - CDN loaded for auth and database
- Fetches `data/index.jsonl` at startup (canon only), `data/archive.jsonl` when
  the browser idles, and `data/songs/{id}.pro` per song page
- Never calls the GitHub API directly (`grep -r api.github.com docs/js/` is
  empty). Everything that reaches GitHub goes through a Supabase edge
  function, which holds the token server-side

## supabase-auth.js

Handles authentication and cloud sync. It is **not** an ES module — the whole
surface is the `window.SupabaseAuth` object literal at the bottom of the file.
That literal is the definitive list; this table is a partial copy, so read it
directly when a name matters:

```bash
sed -n '/^window.SupabaseAuth = {/,/^};/p' docs/js/supabase-auth.js
```

Note the key on the object is what callers use, and it does not always match
the function's declared name (`init:` exposes `initSupabase`).

| Key on `window.SupabaseAuth` | Purpose |
|----------|---------|
| `init()` | Initialize Supabase client (the function is `initSupabase`) |
| `signInWithGoogle()` | OAuth sign-in flow |
| `signOut()` | Sign out current user |
| `getUser()` | Current authenticated user (sync, from cache) |
| `fetchCloudLists()` | Get user's song lists from cloud |
| `createCloudList(name)` | Create a new list |
| `deleteCloudList(id)` | Delete a list |
| `addToCloudList(listId, songId)` | Add song to a list |
| `removeFromCloudList(listId, songId)` | Remove song from list |
| `fetchGroupVotes(groupId)` | Work-level vote counts for a version group |
| `fetchArrangementVotes(songId)` | Per-arrangement counts for one work (`''` = the work-level vote) |
| `fetchUserArrangementVotes(songId)` | Which of one work's arrangements the user voted for |
| `castVote(songId, groupId, value, arrSlug)` | Vote for a version; `arrSlug` null = the work's own chart |
| `removeVote(songId, arrSlug)` | Remove the user's vote for that same arrangement key |
| `isTrustedUser()` | Check if current user has trusted status |
| `supabase` (getter) | The raw client — how `pending_songs` rows are written; there is no `savePendingSong` helper |

## Recent Features (Jan-Feb 2026)

### Contributing (phase 2b — trust gates edit rights, not speed)

Every logged-in user's submission takes the same path:

- saved to `pending_songs` → visible immediately (`refreshPendingSongs()`
  merges the overlay into `allSongs`)
- `auto-commit-song` classifies it and fires a `pending-commit`
  repository_dispatch; `process-pending.yml` lands it in `works/`
- the response says what happened: `{mode: 'create' | 'update' | 'fork'}`
- **fork**: editing content you didn't submit never overwrites it — the chart
  lands as a new arrangement on the same work and the original stays put
- `isTrustedUser()` (the `trusted_users` table) now only decides whether an
  edit of someone else's chart may land **in place** instead of forking —
  plus who may file a review request (below)
- the GitHub-issue submission flow (`create-song-issue`) is gone

### Review queue (phase 2d — the destructive residue)

`review-queue.js` renders `#review-queue-panel` in the Bluegrass Dungeon.
Deletions, suppressions and merge-redirects are the only asks left that wait
on a human:

- **admin** → instant delete, unchanged (`🗑️ Delete song` in the song
  overflow); admins are the reviewers, so queueing them would be ceremony
- **trusted, not admin** → the same slot becomes `🗑️ Request deletion`,
  which writes a `review_requests` row
- **trusted** (admin or not) also gets `🙈 Request suppression` and
  `🔀 Request merge into another song…` in the overflow — neither kind has
  an instant admin path (approval only ever prints a local command, below),
  so both are offered as requests unconditionally on `isTrusted()`. Each
  opens a small modal (`showSuppressRequestDialog` / `showMergeRequestDialog`
  in review-queue.js, same DOM-built-Promise shape as the editor's
  `showDedupModal`): suppression requires a reason (it's the only context a
  reviewer gets); merge-redirect searches the corpus via `searchWorksForTab`
  (add-song-picker.js — reused, not rebuilt) and previews "Redirect THIS →
  TARGET" before filing `kind: 'merge-redirect'` with
  `payload: {redirect_to: targetId}`
- approving a `delete` in the panel executes it (the `delete_song` RPC) and
  mirrors it into the client corpus; approving a `suppress` or
  `merge-redirect` records the decision and **prints the local command**,
  because those edit files in the repo and no CI path does it from a table

The panel has three sections: **Waiting on you** (pending requests),
**Decided** (history, including any command still owed a local run), and
**Held by dedup backstop** — `pending_songs` rows where 3b's backstop set
`dedup_hold`. Nothing commits a held row; admins get *Release hold*
(`dedup_hold` → null, so the hourly reconciler re-dispatches it — the toast
says "not committed yet" rather than pretending otherwise) and *Reject*
(deletes the pending row, behind a confirm). The hold read is separate from
the request read: if the `dedup_hold` column isn't deployed the section shows
the error and the rest of the queue still renders.

Document upload is gone with 2d (`doc-upload.js`, the `#upload` view, the
picker's Upload card, the editor's "Upload a photo instead" hatch). Document
*parts* already in `works/` still render — `renderDocumentPart` in
`work-view.js`. The intake died; the shelf did not.

### Auto-hiding chrome

The song page enables `setChromeAutoHide(true)`: scrolling down hides the
top band (`body.chrome-hidden`), scrolling up or returning to the top
reveals it. Edit lives in the title row (`#edit-song-btn`); the phone-width
band keeps only back / logo / Lists / overflow.

### Strum Machine Integration

Songs with matching Strum Machine backing tracks show a practice button.

- Matching done via title normalization (handles "The", parenthetical suffixes)
- Opens Strum Machine in new tab with current key
- 605+ songs matched
- Cache in `docs/data/strum_machine_cache.json`

### Covering Artists

Songs display which bluegrass artists have recorded them (from grassiness scoring).

- Shown in song metadata below title
- Sorted by artist tier (founding artists first)
- Searchable via `covering:artist name` filter
- Data from `grassiness_scores.json`

### Unified Feedback Modal (`flags.js`)

ONE modal for all feedback — song issues (wrong chord, lyric error, etc.),
bug reports, and general feedback — no GitHub account needed.

- `openFeedbackModal({ type, song })` with a type selector
  (`song-issue`, `song-correction`, `bug-report`, `general-feedback`)
- Entry points: "🚩 Report issue" in the song page's overflow menu,
  "Send Feedback" in the shell's overflow menu, homepage report-bug link
- Creates GitHub issues via the `create-flag-issue` Supabase edge function
- **No login required** (Phase 2a) — a report is complete at the toast.
  Attribution is derived SERVER-SIDE from the session when one exists, and
  is simply "Anonymous" when it doesn't; the client never sends a name

### Song Requests (`add-song-picker.js`)

Frictionless song requests without a GitHub account.

- `openAddSongPicker({ mode: 'request' })` — reachable via the
  `#request-song` hash and the bounty page's "Request a Song" button
- Goes through the `create-song-request` Supabase edge function, which
  branches on identity: **signed in** → a `pending_songs` placeholder the
  requester owns (and lands on); **anonymous** → a `tune-request` GitHub
  issue and a confirmation, with no placeholder work minted
- The signed-in branch takes the same road as every other contribution
  (2026-08-19): a `pending_songs` row with `status: 'placeholder'` and no
  content, then the `pending-commit` dispatch → `works_writer`. It used to
  PUT `work.yaml` to the GitHub Contents API itself, passing the existing
  file's sha whenever the slug was taken — i.e. **overwriting a real work
  with an empty stub**. See "Contribution Workflow" in `supabase/CLAUDE.md`.
- **A request for a song that already exists is refused with a 409**, whose
  message (`"<title>" is already in the songbook.`) the picker shows in
  `reqStatus`. The dedup warning in front of the form stays advisory; this
  is the answer that binds, and there is deliberately no suffixed fallback
  (an empty placeholder at `foo-1` is a bounty entry for a song we have)

### Contributing a tab (`otf-editor/create-tab-entry.js`, `existing-tabs.js`)

Two entry points open the tab editor pre-targeted at a work — the work
page's "+ Add a tab" / tablature-bounty Contribute, and the add-song
picker's Tablature card — both routing through `create.html` with
`?work=&instrument=&title=&have=`.

**A work that already has tabs for that instrument says so BEFORE the
editor opens** (contract principle 4 — the offramp is offered early, never
discovered at Submit). `tabEntryPlan(song, instrument)` reads
`tablature_parts` straight off the index row (no fetch) and matches
instrument families the way `tags.js getInstrumentTags` does, so a
`5-string-banjo` part answers to `banjo`. When it finds any,
`renderExistingTabsPanel` offers three ways forward:

- **view** an existing take → `#work/{id}/{partId}`
- **add mine as another version** → the editor exactly as before, with the
  sibling count carried into the create-page banner
- **improve this one** → the tab-correction path (`enterTabEditMode`), via
  `requestTabEdit(workId, file)` when the work page isn't already open

Same-instrument siblings are normal (foggy-mountain-breakdown carries
eight banjo takes), so the server **adds** a uniquely-named part rather
than 409ing. A correction names the take it fixes with `src_file` — the
published `file` name can't be mapped back to `works/`.

**Submitting is the same two steps a song takes** (`submit-tab.js`). The
GitHub-PR flow is gone: `create-tab-pr` and `process-tab-pr.yml` are
deleted, and nothing may call them.

1. write the `pending_songs` row → **live in seconds**
2. `POST {id}` to `auto-commit-song` → durable in `works/` in minutes

Three columns make the row a part rather than a song — `part_type`
(`'lead-sheet'` | `'tablature'`), `instrument` (required, and it becomes
the filename), and `part_file` (the works/ filename a CORRECTION targets;
null for a new take) — and a tablature row's `content` is the serialized
OTF document. The client never claims create/add/update; step 2's response
says what the server decided. `submitTab` resolves the moment the tab is
LIVE and reports the durable half separately:
`{id, workId, instrument, partFile, live, synced, mode, syncError}`. A
`synced: false` is **not a failure** — the row is live and the hourly
reconciler retries the commit; say "live, syncing shortly".

**The overlay is parts-aware** (`corpus.js`). A pending tablature row is
never a row of its own in search — `applyPendingTabs` attaches it to the
work it targets as an entry in that work's `tablature_parts`
(`overlayPendingTabParts`: a `part_file` match REPLACES that take keeping
its label/author/`file`; no match APPENDS a take). Only a tab whose work
nothing has published yet becomes a row, shaped like the tab-only works
the index build emits. The work itself is *not* flagged `source: 'pending'`
— it is as durable as it was; only the part is pending.

**Rendering a pending take** (`work-view.js`): `loadPartOtf(part)` parses
the overlay's `content` instead of fetching `data/tabs/…otf.json` (which
does not exist yet); the committed path is unchanged. `otfCacheKey(part)`
keys a pending take by its overlay row, because a correction keeps the
`file` of the take it fixes and would otherwise hit the cache and render
the very version it corrects. The page says so out loud ("Just submitted —
live here now"), and the arrangement bar lists the take as *New submission
· just submitted*.

In **My Submissions** a tab is now `Live` like everything else, through the
generic rule — no tab-specific branch. It used to sit at "Requested" until
a human merged its PR, the inconsistency
`docs/plans/contribution-pipeline.md:204-210` accepted on purpose.

### Editing a work's details (`work-view.js` + `corpus.js` + `utils.js`)

Title / artist / key / notes belong to the WORK, not to any part — so they
get their own affordance and their own kind of pending row. The case that
forced it: a tab-minted work (`works/welcome-to-new-york/`) arrived with a
title and nothing else, and no surface could give it an artist. The metadata
editor existed but was reachable only from `status: 'placeholder'`, which a
tab-minted work never has.

**The affordance**: `🏷️ Details` in the title row (`#edit-meta-btn`, the
same `.focus-btn` shell as Edit — *not* `.qc-btn`, which is the icon-only
32x32 tab-band button and must never hold a word). Deliberately NOT
part-scoped the way `#edit-song-btn` is: a tablature part hides Edit (there
is no chart to edit) but the work still has details, and that is exactly the
work that needs them. It is gated on the viewer instead —
`canEditWorkMetadata(song, {userId, trusted})` in `utils.js`: **own a part of
this work, or be trusted.** The gate is re-asked on every `updateWorkTopBar`
because both halves resolve late. The empty artist line shows an "Artist
unknown" nudge only to someone who can act on it.

**Ownership, client-side**, is read from what the index row publishes
(`workSubmitters`): `submitted_by` (primary chart), `arrangements[]`,
`document_parts[]`, `tablature_parts[].submitted_by`, plus `created_by` on a
pending overlay row. ⚠️ **`build_works_index` does not publish
`submitted_by` on `tablature_parts` yet** — the uuid is in
`work.yaml` (`provenance.submitted_by`) but the row keeps only `author`, a
display name that is not comparable to `auth.uid()`. So a tab submitter has
the affordance from the overlay (corpus attaches `submitted_by` to a pending
part) and loses it once their work is published, until the index carries the
field. Trusted users are unaffected, and the server is authoritative either
way.

**The row** (`submitWorkMetadata`) is neither a chart nor a part:

| field | value |
|---|---|
| `id` | `meta:<slug>:<rand>` — its own namespace (DB CHECK), memoized per work so a double-click updates one row |
| `part_type` | `'metadata'` |
| `content` | `null` — the row owns no bytes |
| `replaces_id` | the work being edited, **required**: it is the row's whole address |
| `title` / `artist` / `key` / `notes` / `created_by` | the edit |

Then `POST {id}` to `auto-commit-song`, like every other contribution. One
deliberate difference in how step 2 failing is read: for a tab, step 2 is
only durability, so any failure is "syncing shortly". For metadata it is also
where **permission** is decided, so a 4xx (403 no claim, 404 no such work,
400 no target — but not 429) means REFUSED: the row is deleted again so the
overlay stops advertising an edit that will never land, and the server's own
message is raised.

**The overlay** (`corpus.applyPendingMetadata`, run last in `mergeCorpus`)
merges the fields onto the work it names and nothing else: it never mints a
row (unlike a tab, there is no song behind it), never touches the parts, and
never flags the work `source: 'pending'`. It drops `_stems` so search follows
the new title, and the newest `created_at` wins when two edits are in flight.
A `pending_metadata` marker on the row drives the "Just edited" badge.

The `savePlaceholderMetadata` path is **gone**, replaced entirely — it wrote
`status: 'placeholder'` and round-tripped the chart through `content`, which
on a tab-only work read `''` and would have stamped `status: placeholder`
onto a legitimate work. `showMetadataEditor` (formerly `showPlaceholderEditor`)
still serves real placeholders through `handleEditAction`, unchanged.

### Bounty board dedupe (`title-match.js` + `bounty-view.js`)

The wanted list used to advertise songs the book already had — "Can the Circle
Be Unbroken" while three `will-the-circle-be-unbroken` works sat indexed.
`partitionWanted()` filters it at render from two sources:

1. **`data/bounty_decisions.json`** — the adjudicated verdicts, built from
   `curation/bounty_decisions.yaml` by `scripts/lib/bounty_decisions.py` during
   the index build. These are the alias calls no algorithm gets right.
2. **A live re-check against `allSongs`** via `title-match.js`. This is what
   keeps the page honest between builds: a contribution in `pending_songs` is
   in `allSongs` before any generator has run again.

`title-match.js` deliberately exposes **no fuzzy ratio**. Scores in the
0.80–0.93 band interleave true and false pairs at identical values
(`Come All Ye Tenderhearted`/`Come All You Tender Hearted` is real at 0.92;
`500 Miles`/`900 Miles` is not at 0.89), so there is nothing safe to do with
the number. It auto-resolves exact and token-set matches only, and returns
**candidate arrays, never a best match** — ranking by score once put
`Carpet on the Floor` ahead of the three real Pallet works.

A covered entry whose work is lyrics-only is dropped from "Missing Jam
Standards" but not deleted: `computeChordGaps()` already lists it under
"Needs Chords". Listing it in both places was the original double-count.

See `sources/bounty-hunt/CLEANUP-PLAN.md` for the full evidence.

### Multi-Owner Lists & Thunderdome

Lists can have multiple owners for collaborative curation.

- **Follow/Unfollow**: Follow someone else's list to see it with your lists
- **Thunderdome**: Claim abandoned lists (owner inactive 1+ year)
- **Shareable URLs**: `#list/{id}` URLs work for any public list
- Lists stored in the Supabase `user_lists` table with an `owners` uuid array

### Shareable Lists

Lists can be shared via URL and viewed by anyone.

- `#list/{list-id}` - View a specific list
- `#favorites/{user-id}` - View someone's favorites
- Public by default, owner can make private

### Submitter Attribution

All user-submitted content tracks who submitted it, and **the client never
says who that is** (Phase 2a). The browser sends its session token; the edge
function calls `supabase.auth.getUser(token)` and builds the attribution
string from the verified user (`full_name` → `email` → `user:<id>`). There is
no `submittedBy` request field and no "Rando Calrissian" fallback.

- **Content writes require login** — song submission/correction AND tab
  submission/correction, all four now the same path (`pending_songs` +
  `auto-commit-song`). No token, no write: `submitTab` refuses to touch the
  table without a session, and the function answers 401.
- **Reports and requests stay anonymous-capable** — `create-flag-issue`
  always, `create-song-request` in its issue branch. Anonymous callers are
  attributed "Anonymous" and throttled by IP.
- Shared helper: `supabase/functions/_shared/identity.ts`
  (`requireUser` / `optionalUser` / `attributionFor` / `rateLimited`)
