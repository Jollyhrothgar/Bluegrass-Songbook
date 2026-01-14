# Frontend (docs/js)

Single-page search application for the Bluegrass Songbook. Modularized into ES modules.

## Files

```
docs/
├── index.html          # Page structure, sidebar, modals
├── blog.html           # Dev blog
├── js/
│   ├── main.js         # Entry point, initialization, event wiring
│   ├── state.js        # Shared state (allSongs, currentSong, etc.)
│   ├── search-core.js  # Search logic, query parsing, filtering
│   ├── song-view.js    # Song rendering, controls, ABC notation
│   ├── work-view.js    # Work display with parts, tablature integration
│   ├── chords.js       # Transposition, Nashville numbers, key detection
│   ├── tags.js         # Tag dropdown, filtering, instrument tags
│   ├── lists.js        # User lists, favorites, multi-owner, Thunderdome
│   ├── list-picker.js  # List picker dropdown component
│   ├── editor.js       # Song editor, ChordPro conversion
│   ├── flags.js        # Report Issue feature (creates GitHub issues)
│   ├── song-request.js # Song request feature (frictionless)
│   ├── collections.js  # Landing page collection definitions
│   ├── analytics.js    # Behavioral analytics tracking
│   ├── utils.js        # Shared utilities (escapeHtml, etc.)
│   ├── supabase-auth.js # Auth, cloud sync, voting
│   ├── renderers/      # Part renderers (tablature, etc.)
│   │   ├── index.js    # Renderer registry
│   │   ├── tablature.js # Tablature display
│   │   ├── tab-player.js # Interactive tab player with playback
│   │   └── tab-ascii.js # ASCII tab format
│   ├── chord-explorer/ # Chord exploration tool (standalone)
│   ├── otf-editor/     # Tablature editor (design phase)
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
| `search(query)` | Filter songs by query, chords, progression |
| `renderResults(songs)` | Display search results list (with version badges) |
| `openSong(songId)` | Load and display a song |
| `openWork(workSlug)` | Load and display a work with parts |
| `parseChordPro(content)` | Parse ChordPro → structured sections |
| `renderSong(song, chordpro)` | Render song with chord highlighting |
| `loadTablature(tabPath)` | Load tablature JSON for a work part |
| `transposeChord(chord, semitones)` | Transpose individual chord |
| `toNashville(chord, key)` | Convert chord to Nashville number |
| `detectKey(chords)` | Auto-detect key from chord list |
| `showVersionPicker(groupId)` | Display version picker modal with voting |
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

### openSong vs openWork Routing

There are two rendering paths for displaying content:

| Function | Use Case | Features |
|----------|----------|----------|
| `openSong(id)` | Lead sheets, songs with lyrics | ChordPro rendering, transposition |
| `openWork(id)` | Tablature-only works, multi-part works | Part tabs, track mixer, full tablature controls |

**Important**: For tablature-only works (no `content` field), always use `openWork` to get the track mixer. The search-core.js and version picker both check for this:

```javascript
const hasTabOnly = song.tablature_parts?.length > 0 && !song.content;
if (hasTabOnly) {
    openWork(songId);  // Shows track mixer for multi-track tabs
} else {
    openSong(songId);  // Standard song view
}
```

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

### Song View Controls

**Export actions** (in song-actions bar):
- Print button → `openPrintView()` (new window)
- Copy dropdown → Copy ChordPro / Copy as Text
- Download dropdown → Download .pro / Download .txt

**Render options** (in song view):
- Key selector → transpose and re-render
- Font size +/- → adjust `currentFontSize`
- Chord mode dropdown → 'all' | 'first' | 'none'
- Compact checkbox → reduce whitespace
- Nashville checkbox → show Nashville numbers

**Print view** has its own controls:
- Same options as song view
- 2-column toggle for print layout
- Labels toggle for section headers

### Editor (Add Song / Edit Song)

Functions prefixed with `editor*`:
- `enterEditMode(song)` - Open editor with existing song
- `editorConvertToChordPro()` - Smart paste: chord-above-lyrics → ChordPro
- `updateEditorPreview()` - Live preview while editing
- `submitSongToGitHub()` - Create GitHub issue for submission

### Sidebar Navigation

```javascript
function navigateTo(mode) {
    // mode: 'search' | 'add-song' | 'favorites'
    closeSidebar();
    // Show/hide appropriate panels
}
```

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
- `editor.spec.js` - Song editor flows
- `error-states.spec.js` - Error handling and edge cases
- `favorites.spec.js` - Favorites and lists
- `landing-page.spec.js` - Homepage collections and navigation
- `list-management.spec.js` - List CRUD, sharing, multi-owner
- `navigation.spec.js` - URL routing, deep links
- `print-options.spec.js` - Print view and export options
- `search.spec.js` - Search and filtering flows
- `search-edge-cases.spec.js` - Complex search scenarios
- `song-view.spec.js` - Song display and controls
- `transposition.spec.js` - Key transposition features
- `ui.spec.js` - UI interactions, modals, navigation
- `version-picker.spec.js` - Song version selection
- `work-view.spec.js` - Work display with parts/tablature

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
- `group_id`: Links songs that are versions of each other
- `version_label`: Display name ("Simplified", "Original", etc.)
- `version_type`: Category (alternate, cover, simplified, live)
- `arrangement_by`: Who created this arrangement

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

### Version Picker Labels

The version picker (`showVersionPicker()`) generates labels based on content type:

| Content Type | Label | Metadata |
|-------------|-------|----------|
| Tab-only work | "Tab by {author}" or title suffix | "Banjo Hangout • banjo" |
| ABC notation | "Fiddle notation" | "Notation • TuneArch • Key: G" |
| Lead sheet | "Key of {key}" | "{N} chords" |

This prevents confusing labels like showing "Banjo Hangout" for a work that primarily displays ABC notation.

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

## Recent Features (Jan 2026)

### Focus Mode

Full-screen distraction-free view for practicing. Toggle via button in song view or keyboard shortcut.

- Hides header, sidebar, and search
- Shows minimal navigation (Song button to exit)
- Quick controls bar remains visible
- ESC key exits focus mode (closes bottom sheet first if open)

### Quick Controls Bar

Always-visible controls below song title for one-click access during practice:

```
[(−) Aa (+)]  [(−) G ▼ (+)]  [Layout ▼]  [Nashville]  [🎵]  [▲]
```

- **Size**: Decrease/increase font size
- **Key**: Transpose down/up, dropdown for key selection
- **Layout**: Two columns, section labels, chord display mode
- **Nashville**: Toggle Nashville numbers
- **Strum Machine**: Opens backing track (if available)
- **Collapse**: Hide/show the bar (preference saved)

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

### Report Issue / Flags (`flags.js`)

Users can report song issues (wrong chord, lyric error, etc.) without GitHub account.

- Modal with radio options for issue type
- Optional description field
- Creates GitHub issue via Supabase edge function
- Attribution tracks who submitted (logged-in user or "Rando Calrissian")

### Song Request (`song-request.js`)

Frictionless song requests without GitHub account.

- Modal with title, artist, details fields
- Creates GitHub issue via Supabase edge function
- Available from bounty page and `#request-song` hash

### Multi-Owner Lists & Thunderdome

Lists can have multiple owners for collaborative curation.

- **Follow/Unfollow**: Follow someone else's list to see it in your sidebar
- **Thunderdome**: Claim abandoned lists (owner inactive 30+ days)
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
