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
│   ├── search-core.js  # Search logic, query parsing, filtering
│   ├── work-view.js    # THE unified song page (openWork) — all routes land here
│   ├── song-view.js    # Lead-sheet rendering helpers, ABC notation, list nav
│   ├── song-controls.js # Pill builders: Key / Display / Info / Export
│   ├── chords.js       # Transposition, Nashville numbers, key detection
│   ├── tags.js         # Tag dropdown, filtering, instrument tags
│   ├── lists.js        # User lists, favorites, multi-owner, Thunderdome
│   ├── list-picker.js  # List picker popup component
│   ├── editor.js       # Song editor (Raw tab), re-exports smart-paste pipeline
│   ├── smart-paste.js  # Shared chord-sheet→ChordPro conversion (Raw + Visual paste)
│   ├── flags.js        # Unified feedback modal (song issues, bugs, general feedback)
│   ├── add-song-picker.js # Add/request-a-song picker (also serves #request-song)
│   ├── superuser-request.js # Super-user request modal and submission
│   ├── collections.js  # Landing page collection definitions
│   ├── analytics.js    # Behavioral analytics tracking
│   ├── utils.js        # Shared utilities (escapeHtml, etc.)
│   ├── supabase-auth.js # Auth, cloud sync, voting
│   ├── renderers/      # Part renderers
│   │   ├── index.js    # Renderer registry
│   │   ├── chordpro.js # THE ChordPro renderer (parse + render, shared everywhere)
│   │   ├── tablature.js # Tablature display
│   │   ├── tab-player.js # Interactive tab player with playback
│   │   ├── tab-ascii.js # ASCII tab format
│   │   └── measure-timing.js # Measure timing helpers for playback
│   ├── chord-explorer/ # Chord exploration tool (standalone)
│   ├── visual-editor/  # Two-pane editor: interactive preview + ChordPro model
│   ├── otf-editor/     # Tablature editor
│   └── __tests__/      # Vitest unit tests
├── css/style.css       # Dark/light themes, responsive layout
├── posts/              # Blog posts (markdown)
└── data/
    ├── index.jsonl     # Song index (built by scripts/lib/build_works_index.py)
    └── posts.json      # Blog manifest (built by scripts/lib/build_posts.py)
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
  with `setBottomBand(el)`; pass `null` to hide it.
- **Pill primitive**: `pill(label, buildContent, opts)` returns a small
  labeled button that opens a popover. All song-page controls are pills.
- **Focus mode = `body.immersive`**: `setImmersive(on)` toggles it. The top
  band slides off-screen (a 4px peek strip remains; hover/focus reveals it)
  while content, the pill row, and the bottom band stay. No separate focus
  header or view fork exists. `F` toggles, `Esc` exits.

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
| `loadIndex()` | Fetch and parse `data/index.jsonl`, build songGroups |
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
key:G                     # Filter by key
tag:bluegrass             # Filter by genre tag
tag:fiddle                # Filter by instrument tag (fiddle, banjo, guitar, etc.)
composer:bill monroe      # Filter by composer/writer
```

**Negative filters**: Exclude results with `-` prefix
```
tag:bluegrass -tag:instrumental    # Bluegrass but not instrumentals
artist:george jones -lyrics:drinking
-key:C                             # Exclude songs in C
```

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
- `submitSongToGitHub()` - Create GitHub issue for submission

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

Songs in `index.jsonl`:
```json
{
  "id": "yourcheatingheartlyricschords",
  "title": "Your Cheatin Heart",
  "artist": "Hank Williams",
  "composer": "Hank Williams",
  "first_line": "Your cheatin heart will make you weep",
  "lyrics": "Your cheatin heart...",
  "content": "{meta: title...}[full ChordPro]",
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
    "file": "data/tabs/red-haired-boy-banjo.otf.json",
    "source": "banjo-hangout",
    "source_id": "1687",
    "author": "schlange"
  }],
  "abc_content": "X:1\nT:Red Haired Boy\n..."  // For fiddle tunes
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

## Dependencies

- **Supabase JS** - CDN loaded for auth and database
- Fetches `data/index.jsonl` at startup
- Uses GitHub API for issue submission (no auth required)

## supabase-auth.js

Handles authentication and cloud sync. Key exports:

| Function | Purpose |
|----------|---------|
| `initSupabase()` | Initialize Supabase client |
| `signInWithGoogle()` | OAuth sign-in flow |
| `signOut()` | Sign out current user |
| `getCurrentUser()` | Get current authenticated user |
| `fetchUserLists()` | Get user's song lists from cloud |
| `createList(name)` | Create a new list |
| `deleteList(id)` | Delete a list |
| `addSongToList(listId, songId)` | Add song to a list |
| `removeSongFromList(listId, songId)` | Remove song from list |
| `fetchGroupVotes(groupId)` | Get vote counts for versions |
| `castVote(songId, groupId)` | Vote for a song version |
| `removeVote(songId)` | Remove user's vote |
| `isTrustedUser()` | Check if current user has trusted status |
| `savePendingSong(song)` | Save song to pending_songs table |

## Recent Features (Jan-Feb 2026)

### Trusted User Editing

Trusted users can make instant edits without waiting for approval:

- `isTrustedUser()` checks the `trusted_users` table
- Trusted users see "Save Changes" instead of "Submit for Review"
- Edits saved to `pending_songs` table, visible immediately
- `refreshPendingSongs()` merges pending songs into `allSongs`
- Regular users can request trusted status via super-user request modal

### Focus Mode (immersive)

Distraction-free practice view: `body.immersive` (toggled via
`setImmersive()` in shell.js). The top band slides off-screen (hover the
top edge to reveal it); the content, pill row, and bottom band stay. `F`
toggles, `Esc` exits. Opening a song from a list auto-enters focus and
shows the list nav bar for prev/next.

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
- Attribution tracks who submitted (logged-in user or "Rando Calrissian")

### Song Requests (`add-song-picker.js`)

Frictionless song requests without a GitHub account.

- `openAddSongPicker({ mode: 'request' })` — reachable via the
  `#request-song` hash and the bounty page's "Request a Song" button
- Creates GitHub issues via the `create-song-request` Supabase edge function

### Multi-Owner Lists & Thunderdome

Lists can have multiple owners for collaborative curation.

- **Follow/Unfollow**: Follow someone else's list to see it with your lists
- **Thunderdome**: Claim abandoned lists (owner inactive 1+ year)
- **Shareable URLs**: `#list/{id}` URLs work for any public list
- Lists stored in Supabase `song_lists` table with `owner_ids` array

### Shareable Lists

Lists can be shared via URL and viewed by anyone.

- `#list/{list-id}` - View a specific list
- `#favorites/{user-id}` - View someone's favorites
- Public by default, owner can make private

### Submitter Attribution

All user-submitted content tracks who submitted it.

- Uses logged-in user's display name or email
- Falls back to "Rando Calrissian" for anonymous submissions
- Included in GitHub issue body for submissions, corrections, flags, requests
