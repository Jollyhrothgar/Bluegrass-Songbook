# Bluegrass Songbook - Complete Application Specification

> A searchable collection of 18,300+ bluegrass and country songs with chords, tablature, and ABC notation. Built as a single-page web application with offline-first design.

## Overview

This is a music reference app for bluegrass musicians. Users search a large song catalog, view chord charts with transposition, manage setlists, view and play tablature, and contribute content. The app loads its entire song database at startup as a static file (JSONL), enabling instant client-side search with no server round-trips. User-specific data (lists, votes, analytics) is stored in Supabase.

The app has no build step. All JavaScript is native ES modules served directly by a static file server (GitHub Pages). External dependencies are loaded from CDNs.

---

## Data Model

### Song Index (index.jsonl)

The entire song catalog is a newline-delimited JSON file loaded at page load. Each line is a self-contained song object:

```json
{
  "id": "blue-moon-of-kentucky",
  "title": "Blue Moon of Kentucky",
  "artist": "Bill Monroe",
  "composer": "Bill Monroe",
  "key": "G",
  "mode": "major",
  "first_line": "Blue moon of Kentucky keep on shining",
  "lyrics": "Blue moon of Kentucky keep on shining...",
  "content": "{meta: title Blue Moon of Kentucky}\n{meta: artist Bill Monroe}\n{key: G}\n\n{start_of_verse: Verse 1}\n[G]Blue moon of Ken[C]tucky keep on [G]shining...\n{end_of_verse}",
  "nashville": ["I", "IV", "V"],
  "progression": ["I", "IV", "I", "V", "I", "IV", "I"],
  "chord_count": 3,
  "tags": {
    "Bluegrass": {"score": 80, "source": "llm"},
    "JamFriendly": {"score": 50, "source": "work"},
    "BluegrassStandard": {"score": 80, "source": "llm"}
  },
  "group_id": "a1b2c3d4_e5f6a7b8",
  "canonical_rank": 0,
  "source": "golden-standard",
  "covering_artists": ["Elvis Presley", "Patsy Cline"],
  "strum_machine_url": "https://strummachine.com/app/songs/...",
  "tablature_parts": [
    {
      "instrument": "banjo",
      "label": "Scruggs Style",
      "file": "data/tabs/blue-moon-of-kentucky-banjo.otf.json",
      "source": "banjo-hangout",
      "source_id": "12345",
      "author": "username",
      "source_page_url": "https://www.banjohangout.org/tab/...",
      "author_url": "https://www.banjohangout.org/my/username"
    }
  ],
  "abc_content": "X:1\nT:Blue Moon of Kentucky\nM:4/4\nK:G\n...",
  "version_label": "Original",
  "version_type": "alternate",
  "status": "complete"
}
```

Key fields:
- `content`: Full ChordPro source text with inline `[Chord]` markers
- `nashville`: Unique Nashville numbers used (for chord search)
- `progression`: Full ordered chord sequence as Nashville numbers (for progression search)
- `group_id`: Hash that links different versions/arrangements of the same song
- `canonical_rank`: Sort rank within a version group (0 = canonical/best)
- `tags`: Map of tag name to `{score, source}` - used for filtering and display
- `covering_artists`: Which well-known artists recorded this song
- `tablature_parts`: Array of tablature files (OTF JSON format) with attribution
- `abc_content`: ABC notation for fiddle tunes
- `strum_machine_url`: Link to backing track on Strum Machine
- `status`: `"complete"` or `"placeholder"` (placeholder = song exists but needs content)

### ChordPro Format

Songs use ChordPro syntax with chords inline in brackets:

```
{meta: title Your Cheatin Heart}
{meta: artist Hank Williams}
{meta: composer Hank Williams}
{key: G}

{start_of_verse: Verse 1}
Your cheatin' [G]heart will make you [C]weep
You'll cry and [C]cry and try to [G]sleep
{end_of_verse}

{start_of_chorus}
Your cheatin' [D7]heart will tell on [G]you
{end_of_chorus}
```

Section types: `verse` (with label), `chorus`, `bridge`. The `{chorus}` directive repeats the last chorus.

### OpenTabFormat (OTF) - Tablature

Tablature is stored as JSON:

```json
{
  "otf_version": "1.0",
  "metadata": {
    "title": "Cripple Creek",
    "time_signature": "4/4",
    "tempo": 120,
    "key": "G"
  },
  "timing": { "ticks_per_beat": 480 },
  "tracks": [
    {
      "id": "track_1",
      "instrument": "5-string-banjo",
      "tuning": [62, 57, 55, 50, 67],
      "strings": 5,
      "capo": 0
    }
  ],
  "notation": {
    "track_1": [
      {
        "measure_number": 1,
        "events": [
          { "tick": 0, "notes": [{"s": 3, "f": 0, "tech": "h"}] },
          { "tick": 240, "notes": [{"s": 2, "f": 0}] }
        ]
      }
    ]
  },
  "reading_list": [
    { "label": "A", "start": 1, "end": 4, "repeats": 2 },
    { "label": "B", "start": 5, "end": 8, "repeats": 1 }
  ]
}
```

Note articulations: `h` (hammer-on), `p` (pull-off), `/` (slide up), `\` (slide down), `~` (tie).

### Supabase Database Tables

The app uses Supabase (PostgreSQL) for user data:

| Table | Purpose |
|-------|---------|
| `user_favorites` | User's favorited song IDs |
| `user_lists` | Named song lists with `owners UUID[]` for multi-owner support |
| `user_list_items` | Songs in lists, with position and per-item metadata (key, tempo, notes) |
| `list_followers` | Users following (but not owning) a list |
| `list_invites` | 7-day invite tokens for co-owner invitations |
| `song_votes` / `song_vote_counts` | Version voting (which arrangement is best) |
| `tag_votes` / `tag_vote_counts` | Tag voting (upvote/downvote tags on songs) |
| `genre_suggestions` | User-suggested tags |
| `pending_songs` | Trusted user edits visible immediately before git commit |
| `trusted_users` | Users with elevated permissions (instant edits) |
| `admin_users` | Admin users (can delete songs) |
| `deleted_songs` | Soft-deleted songs |
| `bounties` | Community requests for specific content types |
| `doc_staging` | Uploaded documents (PDFs) pending approval |
| `analytics_events` | Behavioral analytics (batched insert via RPC) |
| `visitor_stats` / `visitors` | Visitor counting |
| `submission_log` | Audit trail for all user submissions |
| `song_flags` | Reported issues on songs |

Key design: `user_lists.owners` is a UUID array enabling multi-owner lists. Lists are public-readable by UUID. The `orphaned_at` timestamp enables "Thunderdome" claiming of abandoned lists.

### localStorage Keys

All prefixed with `songbook-`:

| Key | Data |
|-----|------|
| `songbook-lists` | Cached lists array (offline-first) |
| `songbook-folders` | Folder organization for lists |
| `songbook-view-prefs` | Display preferences (compact, nashville, fontSize, chordDisplayMode, etc.) |
| `songbook-deleted-lists` | Deleted list IDs to prevent resurrection on sync |
| `songbook-visitor-id` | Anonymous visitor tracking ID |
| `theme` | `"dark"` or `"light"` |
| `quickBarCollapsed` | Quick controls bar state |
| `infoBarCollapsed` | Song info section state |

---

## Features

### 1. Landing Page

The home screen shows:
- A large centered search input with placeholder text
- A grid of **collection cards** (6 collections): Bluegrass Standards, All Bluegrass, Gospel, Fiddle Tunes, All Songs, Waltz
- Each card shows the collection name and song count
- Clicking a card executes a pre-defined search query (e.g., `tag:BluegrassStandard`)
- Collections have **pinned songs** that always appear first in results, followed by remaining matches sorted by canonical rank
- Below the collections: visitor stats (total visitors, page views), a link to the bounty/wanted page, and footer links

### 2. Search

Full-text search across 18,300+ songs with advanced filter syntax. Search is instant (client-side, no server round-trip).

**Basic search**: Type any text to search across title, artist, and lyrics simultaneously. Results are ranked by `canonical_rank`.

**Filter syntax** (prefix-based):
- `artist:hank williams` - Filter by performing artist
- `title:blue moon` - Filter by title
- `lyrics:lonesome` - Search within lyrics
- `composer:bill monroe` - Filter by songwriter
- `key:G` - Filter by musical key
- `tag:Bluegrass` - Filter by genre/vibe tag
- `chord:VII,II` - Find songs using specific Nashville chord numbers
- `prog:I-IV-V` - Find songs with a specific chord progression sequence
- `status:placeholder` - Find songs that need content
- `has:bounty` - Find songs with open community requests

**Negative filters**: Prefix any filter with `-` to exclude (e.g., `-tag:Instrumental`, `-key:C`)

**Short aliases**: `a:` = artist, `t:` = tag, `k:` = key, `c:` = chord, `p:` = prog, `l:` = lyrics

**Stemmed search**: When exact text matching fails, falls back to stemmed word matching (e.g., "bluegrassing" matches "bluegrass").

**Version deduplication**: When multiple versions of a song exist (same `group_id`), only the canonical version appears in search results. A version badge indicates alternatives exist.

**Results display**: Each result card shows:
- Song title (with search term highlighting)
- Artist name
- First line of lyrics (truncated, italic)
- Key badge
- Tag badges (color-coded by category: genre=blue, vibe=green, structure=purple, instrument=orange)
- Covering artists (which well-known artists recorded it)
- Version badge (if multiple arrangements exist)
- Favorite heart button (fills red when favorited)
- Add-to-list button (+ icon)
- Infinite scroll (50 results per page, loads more on scroll via IntersectionObserver)

**Tag dropdown**: A checkbox filter panel for browsing tags by category (Genre, Vibe, Structure). Selecting tags adds them to the search query.

**Search tips**: A `?` button reveals syntax examples.

### 3. Song View (Lead Sheet)

Opening a song displays the full chord chart with these features:

**ChordPro rendering**: Chords appear above the lyrics they apply to. Each chord-lyric pair is an inline-block "segment" with the chord on top and lyrics below, using the accent color for chords and monospace font for the body.

**Sections**: Verse, Chorus, Bridge sections have labels. Sections can be collapsed in compact mode (consecutive identical sections show a repeat indicator instead).

**Transposition**:
- Key selector dropdown showing all 12 keys (major or minor based on detected mode)
- Transpose up/down buttons (semitone steps)
- All chords update instantly
- The original key is marked with `*` in the dropdown
- Key detection uses chord frequency analysis with diatonic scoring

**Nashville Numbers**: Toggle to replace chord names with Roman numerals relative to the current key (I, ii, iii, IV, V, vi, vii). Uppercase = major, lowercase = minor.

**Chord display modes**:
- "All" - Show all chords
- "First Only" - Show chords only on their first occurrence in each section (subsequent appearances hidden)
- "None" - Hide all chords (lyrics only)

**Font size**: Adjustable from 0.5x to 2.0x via +/- buttons

**Two-column layout**: Optional CSS multi-column layout for wider displays

**Section labels**: Toggle visibility of "Verse 1", "Chorus", etc. labels

**Compact mode**: Reduces whitespace between sections

**Quick controls bar**: A collapsible toolbar below the song title providing one-click access to all display options:
```
[(-) Aa (+)]  [(-) G dropdown (+)]  [Layout dropdown]  [Nashville toggle]  [Strum Machine link]  [collapse arrow]
```
The key dropdown opens a 4-column grid of all 12 keys. Collapse state is saved to localStorage.

**Song metadata section**: Expandable/collapsible disclosure showing:
- Composer/songwriter (if different from artist)
- All performing artists
- Tag badges with voting controls (for logged-in users: upvote/downvote tags)
- Source attribution

**Version badge**: If the song has alternate versions, shows a colored badge. Clicking opens the version picker modal.

**Export actions** (dropdown menu in header):
- Print (opens new window with print-optimized layout)
- Copy ChordPro (raw source to clipboard)
- Copy as plain text (lyrics only)
- Download .pro file
- Download .txt file

**Strum Machine integration**: If the song matches a Strum Machine backing track (605+ songs), a music note icon button opens the backing track in a new tab.

**Source attribution**: Bottom of song shows where the content came from with a link.

### 4. Focus Mode (Fullscreen Practice)

A distraction-free mode for practicing with a song:
- Hides header, sidebar, search, and all chrome
- Song content fills the entire viewport
- A minimal sticky header shows: song title, position in list (e.g., "3 of 12"), and nav buttons
- Quick controls bar remains accessible via a gear icon toggle
- Previous/Next navigation buttons (when browsing from a list)
- Press `F` or a focus button to enter; `Escape` or `F` to exit
- A brief "Press F or Esc to exit" hint appears at the top

**Focus Notes Panel** (when viewing from a setlist):
- A resizable bottom panel for per-song notes
- Shows: Key override dropdown, Tempo BPM input, free-text notes textarea
- Drag handle to resize height (saved to localStorage)
- Collapse/expand toggle
- Notes are saved as per-list-item metadata

### 5. Work View (Multi-Part Dashboard)

When a song has multiple parts (lead sheet + tablature, or tablature only), it opens in "work view" - a dashboard showing all available parts as cards:

**Part cards**: Each available part (lead sheet, banjo tab, guitar tab, etc.) shows:
- Part type icon and instrument name
- Source attribution (e.g., "Banjo Hangout" with link to original)
- Author name
- "Open" button to expand that part inline

**Version cards**: If multiple arrangements exist, version cards show key, chord count, and a "View" button.

**Inline expansion**: Clicking a part card expands it within the work view:
- Lead sheet parts → renders the full ChordPro song view
- Tablature parts → fetches the OTF JSON file and renders interactive SVG tablature
- Document parts → renders an embedded PDF/image viewer

### 6. Tablature Renderer

Renders OTF (OpenTabFormat) JSON as interactive SVG tablature:

**Visual layout**:
- Horizontal rows of measures that fill the container width
- String lines (e.g., 5 for banjo) with fret numbers placed at note positions
- Time signature and measure numbers shown
- Stems and flags for rhythmic notation
- Beams connecting eighth and sixteenth notes
- Articulation markers: `h` (hammer-on), `p` (pull-off), `/` or `\` (slides), bracket notation for ties

**Auto-scaling**: Measures auto-size to fit the container width, with configurable min/max widths.

**Theme-aware**: Reads CSS variables for colors, adapts to dark/light mode.

**Tuning display**: Detects named tunings (Open G, Standard, Double C, etc.) from pitch arrays and displays in the track header.

**Repeat handling**: OTF files can have a `reading_list` defining repeat structure. The renderer can show repeats compactly (with repeat signs) or unrolled (linear).

### 7. Tablature Player

Audio playback for tablature using Web Audio API:

- **Play/Pause/Stop** controls
- **Tempo control**: Adjustable BPM with increase/decrease buttons
- **Note highlighting**: During playback, the current note lights up in the SVG with accent color
- **Beat cursor**: A red semi-transparent overlay tracks the current beat position
- **Auto-scroll**: Automatically scrolls to keep the current measure visible
- **Loop mode**: Toggle to loop the entire piece
- **Measure navigation**: Click any measure to jump playback to that position

**Sound synthesis**: Uses WebAudioFont with instrument-specific samples:
- 5-string banjo → FluidR3 GM banjo
- Guitar → GeneralUserGS acoustic guitar
- Fiddle → GeneralUserGS violin
- Bass → acoustic bass

### 8. Track Mixer (Multi-Track Tablature)

For ensemble arrangements with multiple instruments:
- Toggle bar above the tablature showing each track with instrument emoji + name
- **Mute/unmute** each track (toggle visibility)
- **Solo** a single track (mutes all others)
- Tracks render stacked in the same view when multiple are visible

### 9. ABC Notation (Fiddle Tunes)

For fiddle tunes with ABC notation content:

**Rendering**: Uses the ABCJS library to render standard music notation as inline SVG.

**View toggle**: A segmented button switches between "Lead Sheet" (chord chart) and "Notation" (sheet music) views.

**Notation controls** (in quick controls bar):
- Size +/- for notation scaling
- Transposition up/down (semitone steps, applied visually)
- Playback controls: Play/Pause button
- Tempo BPM input

**Playback**: ABCJS synth creates audio from the notation using MIDI soundfont. Active notes highlight during playback. A session counter prevents stale async callbacks from updating the UI after navigation.

**Dark mode**: SVG path strokes and text fills are recolored via CSS attribute selectors.

### 10. Song Lists & Favorites

**Favorites**: A special list that every user has. Toggle a song as favorite from any result card or song view. Favorites heart turns red when active.

**Custom lists**: Users can create named lists (setlists, practice lists, etc.):
- Create new list (name input)
- Add songs via the list picker dropdown (appears when clicking + on a result card)
- Remove songs from a list
- Drag-and-drop reorder songs within a list
- Rename lists
- Delete lists (with undo toast for 5 seconds)

**Folder organization** (local only):
- Create folders to organize lists
- Drag lists into folders
- Nested folder hierarchy
- Collapse/expand folders in sidebar

**Batch operations** (when in list view):
- Multi-select songs via checkbox or shift-click
- Batch bar slides up from bottom: [count] | Select All | Clear | Copy to... | Move to... | Remove
- Copy/Move open a dropdown of other lists as targets

**Per-song metadata in lists**:
- Key override (play this song in G instead of its default key)
- Tempo BPM
- Free-text notes
- Accessed via a notes button on each list item, opens a bottom sheet

**Undo/redo**: All list operations support undo (Cmd+Z) and redo (Cmd+Shift+Z). Undo toast shows for 5 seconds with an undo button. History depth: 50 operations.

### 11. Cloud Sync

When signed in, lists sync to Supabase:

**Offline-first**: Lists are stored in localStorage first, then synced to the cloud. Changes work offline and merge when connectivity returns.

**Sync strategy**:
- Local-only lists (no `cloudId`) are uploaded on sync
- Cloud lists not in local are downloaded
- Song arrays merge (union), deduplicates
- In-flight write tracking prevents sync from overwriting pending changes

**Deleted list tracking**: When a list is deleted locally, its ID and name are tracked to prevent cloud sync from resurrecting it.

### 12. Multi-Owner Lists & Sharing

**Share URL**: Every list has a public URL (`#list/{uuid}`) viewable by anyone.

**Co-owner invitations**:
- Generate a 7-day invite link
- Recipient clicks link → added as co-owner of the list
- All co-owners can add/remove/reorder songs

**Follow/Unfollow**: Users can follow others' lists (read-only, appears in sidebar under "Following").

**Thunderdome**: Abandoned lists (owner inactive > 1 year) can be claimed by any follower. Orphaned lists show a pulsing warning badge.

### 13. Song Editor

Two modes: adding new songs and editing existing songs.

**Add new song**:
- Title, Artist, Composer fields
- ChordPro content textarea (monospace font)
- Live preview panel (side-by-side on desktop, stacked on mobile)
- Preview has its own transpose and Nashville controls
- Auto-format detection and conversion

**Smart paste converter**:
- Paste chord-above-lyrics format (common on guitar tab sites) → auto-converts to ChordPro
- Detects chord lines (>50% of words are chord patterns)
- Pairs chord lines with following lyric lines, inserting `[Chord]` at the correct character positions
- Maps section markers (`[Verse 1]`, `[Chorus]`) to ChordPro directives

**Site-specific paste cleaners**:
- ChordU format detection and cleanup
- Ultimate Guitar format detection and cleanup (removes boilerplate, tuning/capo blocks)

**Transpose in editor**: Transpose all chords in the editor content by semitone offset.

**ChordPro hints panel**: A reference panel showing syntax examples (title/artist directives, verse/chorus markers, chord brackets). Docks to right side on wide screens, overlays on narrow screens.

**Submission flow**:
- **Trusted users**: Song saved directly to `pending_songs` table, visible immediately in the app. Background process commits to git.
- **Regular users**: Creates a GitHub issue with the ChordPro content for review.

**Edit existing song**:
- Pre-populates all fields from the existing song
- Shows a "Comment" field for describing the correction
- Submit button says "Submit Correction" instead of "Submit to Songbook"

### 14. Tablature Editor (Planned Feature)

A browser-based tablature editor for creating and editing OTF tablature, targeting 5-string banjo first with multi-instrument support planned.

**Layout**:
```
TOOLBAR:     [prev][next]  Duration buttons  [triplet]  [h][p][/]  [undo][redo]
CANVAS:      SVG tablature (existing TabRenderer) + cursor overlay + ghost note preview
STATUS BAR:  Mode | Beat position | String | Duration | "Press ? for help"
```

**Two input methods**:

1. **Mouse/Touch (casual users)**:
   - Double-click a position → opens Note Entry Popover
   - Popover shows: string selector [1]-[5], 3x3 fret numpad (+10/+20 for high frets), technique row [h][p][/][~], Insert/Cancel buttons
   - Ghost note preview shows semi-transparent note at cursor before insertion

2. **Keyboard (power users)** - Vim-style modal system with 5 modes:

   **Normal mode** (gray): Navigation and manipulation
   - `h/j/k/l` - move cursor (left/down/up/right = prev beat/next string/prev string/next beat)
   - `w/b` - jump forward/backward by beat
   - `0/$` - start/end of measure
   - `gg/G` - start/end of document
   - `{N}G` - jump to measure N
   - `i` - enter Insert mode
   - `x` - delete note at cursor
   - `dd` - delete current beat
   - `y/p` - copy/paste
   - `.` - repeat last action

   **Insert mode** (green): Note entry
   - `1-5` - select string
   - `0-9` - enter fret number (two digits for 10+)
   - `f` prefix for high frets (f12 = fret 12)
   - `Space` - advance to next beat
   - Duration keys: `q`=quarter, `e`=eighth, `s`=sixteenth, `t`=triplet
   - `Escape` - return to Normal mode

   **Visual mode** (blue): Selection
   - Movement keys extend selection
   - `d` - delete selection
   - `y` - copy selection

   **Roll mode** (orange): Banjo-specific rapid pattern entry
   - `T/I/M/R/P` - thumb/index/middle/ring/pinch finger assignments on specific strings
   - Entering a Scruggs forward roll = typing `TIMIMTIM` (~2 seconds)
   - Auto-advances after each note

   **Annotation mode**: Add text annotations to measures

**Supported instruments** (data-driven, MVP = banjo only):
- 5-string banjo (5 strings, Roll mode enabled)
- 6-string guitar (6 strings, Roll mode enabled)
- Mandolin (4 strings)
- Upright bass (4 strings)
- Tenor banjo (4 strings)
- Dobro (6 strings)

**Save modes**:
- Download OTF JSON file
- Submit correction (via GitHub issue, same as song corrections)
- Save draft to localStorage

**Integration**: "Edit Tab" button appears on work view for existing tablature parts. URL routing: `#edit-tab/{work-slug}`, `#new-tab`.

### 15. Bounty / Wanted Songs

A community-driven content request system:

**Bounty view** (`#bounty`): A grid of cards showing songs the community wants:
- **Placeholder songs**: Songs that exist in the catalog but have no content yet (just title/artist). Inferred needs based on tags (e.g., instrumental → needs ABC notation).
- **Explicit bounties**: Community requests for specific content types (lead sheet, tablature, ABC notation, document).

**Filters**: All | Lyrics & Chords | Tabs | ABC Notation | Documents

**Cards show**: Song title, artist, what's needed, existing parts, "Contribute" button.

**Contribute flow**: Opens the add-song picker targeted at the specific work.

### 16. Version Picker

When multiple arrangements of a song exist (same `group_id`):

- Modal listing all versions with: version label, source, instrument type, first-line preview
- Vote count and upvote button per version
- Current version highlighted with accent border
- Clicking a version opens it
- Version labels auto-generated: "Tab by {author}" for tab-only, "Fiddle notation" for ABC, "Key of {key}" for lead sheets

### 17. Authentication

**Google OAuth**: Primary sign-in method via Supabase Auth. One-click Google button.

**Email/Password**: Secondary auth method with sign-up, sign-in, and password reset (3-step flow: enter email → check email → set new password).

**User roles**:
- **Anonymous**: Search, view songs, use localStorage favorites/lists
- **Signed in**: Cloud sync, voting, following lists, submitting content
- **Trusted user**: Instant edits (bypass review), tag voting
- **Admin**: Delete songs, manage users

**Auth UI**: Top-right header shows "Sign in" button (accent color) or user avatar (Google photo or initials in accent circle) + truncated name. Account modal shows sync status indicator (colored dot: gray=offline, blue=syncing, green=synced, red=error).

**Trusted user request**: Users can request trusted status via a modal that creates a GitHub issue.

### 18. Report Issue / Flags

Users can report problems with songs without needing a GitHub account:

- Report button on song view opens a modal
- Radio options: Wrong chord, Wrong lyric, Missing section, Other
- Optional description field
- Creates a GitHub issue via Supabase edge function
- Attribution: logged-in user name or "Rando Calrissian" for anonymous

### 19. Song Request

Users can request songs be added:

- Accessible from bounty page, sidebar, and `#request-song` URL
- Form: Title, Artist, Key (optional), Notes (optional)
- **Live duplicate detection**: As user types, checks existing songs and shows warning with links to matches
- Creates a GitHub issue via Supabase edge function

### 20. Document Upload

Users can upload images/PDFs of song sheets:

- Drag-and-drop zone accepting JPG, PNG, HEIC, WebP, PDF (max 10MB)
- Preview with rotate controls
- Uploads to Supabase Storage
- Links to a specific work
- Creates a review issue

### 21. Analytics

Behavioral analytics tracked client-side and batched to Supabase:

**Tracked events**: song_view, transpose, version_picker, tag_vote, tag_suggest, search, search_result_click, navigation, theme_toggle, deep_link, export, editor actions, collection_click, list actions, bottom_sheet interactions

**Batching**: Events queue locally and flush to Supabase RPC (`log_events`) every 30 seconds or when queue hits 50 events.

**Visitor tracking**: Anonymous visitor ID from localStorage. Visitor stats (total visitors, page views) shown on landing page.

### 22. Blog

A separate static page (`blog.html`) with:
- Post listing from a `posts.json` manifest
- Click a post → fetches markdown file, strips frontmatter, renders via `marked` library
- Hash-based deep linking to specific posts
- Same dark/light theme as main app (reads from shared localStorage)
- Back/forward browser navigation

### 23. Chord Explorer (Standalone Tool)

An interactive chord progression builder on a separate page:

**Chord palette**: Two rows showing diatonic chords (I-vii of selected key) and non-diatonic chords (secondary dominants, borrowed chords). Each chord is draggable.

**Beat grid**: A visual sequencer where users drop chords onto beats. Cells show chord names. Click a cell to adjust chord quality (maj/min/7th/sus, inversion, octave). Grid resizable by bars (1-8) and time signature.

**Playback**: Web Audio polyphonic synth (sawtooth oscillators with ADSR envelope). Loop and vibrato toggles. Beat cursor animates across grid during playback.

**State persistence**: Full grid state saved to localStorage.

### 24. Print View

Print-optimized view opening in a new window:

- Clean layout: white background, black text, no UI chrome
- Own controls: two-column toggle, section labels toggle, font size, key selector, Nashville toggle
- Same rendering pipeline as song view
- Chord colors forced to black for print
- `@media print` CSS hides all controls

### 25. Sidebar Navigation

A slide-out drawer (280px wide) triggered by hamburger menu:

**Nav items**: Home, Search, Add Song, Favorites, Song Lists

**Lists section**: Shows user's lists with:
- Drag handles for reordering
- Context menu (right-click): rename, move to folder, delete
- Folder grouping with collapse arrows
- "Following" section for followed lists (blue left border)
- Orphaned lists shown with orange border and pulsing badge

**Footer**: Theme toggle (sun/moon icon), About, Patreon link, Buy Me a Coffee link, Feedback, Blog link, Standards Board link

---

## Visual Design

### Theme

**Light mode**: Clean white (#fafafa) background, black text, blue (#2563eb) accent for interactive elements and chords.

**Dark mode**: Pure black (#000000) background, white text, lighter blue (#60a5fa) accent. Toggle via sun/moon icon in sidebar.

### Typography

- **UI text**: System font stack (SF Pro, Segoe UI, Roboto, etc.)
- **Song body**: Monospace (SF Mono, Fira Code, Consolas)
- **Editor textarea**: Courier New monospace

### Tag Badge Colors

| Category | Background | Text |
|----------|-----------|------|
| Genre (Bluegrass, ClassicCountry) | Blue tint (rgba 37,99,235,0.15) | Blue (#2563eb) |
| Vibe (JamFriendly, Modal) | Green tint | Green (#16a34a) |
| Structure (Instrumental, Waltz) | Purple tint | Purple (#9333ea) |
| Instrument (fiddle, banjo) | Orange tint | Orange (#ea580c) |

### Layout

- Max container width: 800px centered (expands to 1800px during song/editor view)
- Collections grid: `auto-fill, minmax(280px, 1fr)`
- Editor: Two-column grid (input | preview), single column on mobile
- Cards: 8px border radius, secondary background, subtle hover lift

### Responsive Breakpoints

- **Mobile** (≤600px): Single-column collections, hidden header badges, bottom sheet slide-up animation, song body horizontal scroll, simplified controls
- **Tablet** (≤800px): Editor goes single column
- **Desktop** (≥1200px): ChordPro hints panel docks to right side

### Key Animations

- Song view entrance: fade + slide up (0.2s)
- Bottom sheet (mobile): slide up from bottom (0.3s)
- Sidebar: slide from left (0.3s)
- Favorite heart: pulse on toggle
- Orphaned list badge: breathing opacity pulse (2s)
- Sync indicator: dot pulse (1s)
- Toast notification: slide up (0.3s)
- Theme transition: background/color crossfade (0.2s)

---

## URL Routing

All routing is hash-based (SPA on static hosting):

| Route | View |
|-------|------|
| `#` | Landing page with collections |
| `#search` | Empty search |
| `#search/{query}` | Search with pre-filled query |
| `#song/{id}` | Song view (lead sheet) |
| `#work/{id}` | Work dashboard (multi-part) |
| `#work/{id}/{partId}` | Work with specific part expanded |
| `#edit/{id}` | Edit existing song |
| `#add` | Add new song |
| `#upload` | Document upload |
| `#bounty` | Bounty/wanted songs |
| `#list/favorites` | Favorites list |
| `#list/{uuid}` | View a specific list |
| `#list/{uuid}/{songRef}` | Song within a list context |
| `#lists` | Manage song lists |
| `#lists/{folderId}` | Lists in a specific folder |
| `#invite/{token}` | Accept co-owner invitation |
| `#request-song` | Song request modal |
| `#edit-tab/{work-slug}` | Edit tablature (planned) |
| `#new-tab` | Create new tablature (planned) |

**Routing decision**: Songs with multiple parts or tablature-only content open in work view; single lead sheets open in song view.

**Legacy redirects**: Old `#song/{filename-id}` URLs redirect to `#work/{slug}` via a redirects.json map.

---

## External Dependencies

| Dependency | Source | Purpose |
|-----------|--------|---------|
| Supabase JS v2 | CDN | Authentication, database, storage, edge functions |
| ABCJS v6 | CDN | ABC music notation rendering and playback |
| WebAudioFont | CDN (dynamic) | Instrument samples for tablature playback |
| marked | CDN | Markdown rendering for blog |
| Google Analytics | CDN | Traffic analytics |

No build tools, bundlers, or framework. Pure ES modules served directly.
