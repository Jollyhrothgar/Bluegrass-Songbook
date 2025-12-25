# Frontend (docs/js)

Single-page search application for the Bluegrass Songbook. All logic is in `search.js`.

## Files

```
docs/
├── index.html          # Page structure, sidebar, modals
├── js/search.js        # All application logic (~2000 lines)
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
let songIndex = null;           // Full index from data/index.json
let allSongs = [];              // Array of song objects
let currentSong = null;         // Currently viewed song
let currentChordpro = null;     // Raw ChordPro content
let showingFavorites = false;   // Favorites filter active
let nashvilleMode = false;      // Show Nashville numbers
let currentDetectedKey = null;  // Current key (for transposition)
let showChords = true;          // Toggle chord display
let favorites = new Set();      // Song IDs in localStorage
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `loadIndex()` | Fetch and parse `data/index.json` |
| `search(query)` | Filter songs by query, chords, progression |
| `renderResults(songs)` | Display search results list |
| `openSong(songId)` | Load and display a song |
| `parseChordPro(content)` | Parse ChordPro → structured sections |
| `renderSong(song, chordpro)` | Render song with chord highlighting |
| `transposeChord(chord, semitones)` | Transpose individual chord |
| `toNashville(chord, key)` | Convert chord to Nashville number |
| `detectKey(chords)` | Auto-detect key from chord list |

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
  "progression": ["I", "IV", "V", "I", "V7", "I"]
}
```

## Dependencies

- **None** - Vanilla JavaScript, no build step
- Fetches `data/index.json` at startup
- Uses GitHub API for issue submission (no auth required)
