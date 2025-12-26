# Frontend (docs/js)

Single-page search application for the Bluegrass Songbook. Main logic is in `search.js`, auth/sync in `supabase-auth.js`.

## Files

```
docs/
├── index.html          # Page structure, sidebar, modals
├── js/search.js        # Main application logic
├── js/supabase-auth.js # Auth, user lists, voting
├── css/style.css       # Dark/light themes, responsive layout
└── data/index.json     # Song index (built by scripts/lib/build_index.py)
```

## Quick Start

```bash
./scripts/server        # Start at http://localhost:8080
```

## Architecture

### State Variables

```javascript
// Core state
let songIndex = null;           // Full index from data/index.json
let allSongs = [];              // Array of song objects
let songGroups = {};            // Map of group_id → [songs] for versions
let currentSong = null;         // Currently viewed song
let currentChordpro = null;     // Raw ChordPro content

// Display modes
let showingFavorites = false;   // Favorites filter active
let nashvilleMode = false;      // Show Nashville numbers
let currentDetectedKey = null;  // Current key (for transposition)
let showChords = true;          // Toggle chord display

// User data
let favorites = new Set();      // Song IDs (localStorage or synced)
let userLists = [];             // Custom user lists (via supabase-auth.js)
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `loadIndex()` | Fetch and parse `data/index.json`, build songGroups |
| `search(query)` | Filter songs by query, chords, progression |
| `renderResults(songs)` | Display search results list (with version badges) |
| `openSong(songId)` | Load and display a song |
| `parseChordPro(content)` | Parse ChordPro → structured sections |
| `renderSong(song, chordpro)` | Render song with chord highlighting |
| `transposeChord(chord, semitones)` | Transpose individual chord |
| `toNashville(chord, key)` | Convert chord to Nashville number |
| `detectKey(chords)` | Auto-detect key from chord list |
| `showVersionPicker(groupId)` | Display version picker modal with voting |

### Search Features

**Keyword search**: Matches title, artist, lyrics
```
blue moon kentucky
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

1. **Add state variable** (if needed) at top of file
2. **Add DOM element reference** in the DOM elements section
3. **Implement function** following existing patterns
4. **Wire up event listener** at bottom of file (in DOMContentLoaded or inline)
5. **Add UI** in `index.html` if needed
6. **Style** in `css/style.css`

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

Songs in `index.json`:
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
- Fetches `data/index.json` at startup
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
