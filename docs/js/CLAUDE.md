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
│   ├── chords.js       # Transposition, Nashville numbers, key detection
│   ├── tags.js         # Tag dropdown, filtering
│   ├── favorites.js    # Favorites management, sync
│   ├── lists.js        # Custom lists, list picker
│   ├── editor.js       # Song editor, ChordPro conversion
│   ├── utils.js        # Shared utilities (escapeHtml, etc.)
│   └── supabase-auth.js # Auth, cloud sync, voting
├── css/style.css       # Dark/light themes, responsive layout
├── posts/              # Blog posts (markdown)
└── data/
    ├── index.jsonl     # Song index (built by scripts/lib/build_index.py)
    └── posts.json      # Blog manifest (built by scripts/lib/build_posts.py)
```

## Quick Start

```bash
./scripts/server        # Start at http://localhost:8080
```

## Architecture

### State Variables

```javascript
// Core state
let allSongs = [];              // Array of song objects (loaded from index.jsonl)
let songGroups = {};            // Map of group_id → [songs] for versions
let currentSong = null;         // Currently viewed song
let currentChordpro = null;     // Raw ChordPro content

// Display modes
let showingFavorites = false;   // Favorites filter active
let nashvilleMode = false;      // Show Nashville numbers
let currentDetectedKey = null;  // Current key (for transposition)
let chordDisplayMode = 'all';   // 'all' | 'first' | 'none'
let currentFontSize = 16;       // Font size in pixels

// User data
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
| `parseChordPro(content)` | Parse ChordPro → structured sections |
| `renderSong(song, chordpro)` | Render song with chord highlighting |
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
tag:bluegrass             # Filter by tag
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

## Adding a Feature

1. **Identify the right module** - search in `search-core.js`, song display in `song-view.js`, etc.
2. **Add state** (if needed) in `state.js` and export it
3. **Add DOM element reference** in `main.js` DOM elements section
4. **Implement function** in the appropriate module, export it
5. **Wire up event listener** in `main.js` init function
6. **Add UI** in `index.html` if needed
7. **Style** in `css/style.css`
8. **Push** - CI will syntax-check all modules

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
