# Bluegrass Songbook - Roadmap

## Vision

Build the integrated practice and performance tool for the bluegrass community - combining chord sheets, fiddle tunes, rhythm backing, tablature, and library management in one place.

**What exists today (fragmented):**
- Strum Machine → rhythm backing tracks
- TuneFox → fiddle tune tabs
- Ultimate Guitar → chord sheets
- Scattered PDFs, fakebooks, loose sheets

**What we're building (integrated):**
- Songs with chords and lyrics ✅
- Fiddle tunes with notation and tab
- Rhythm playback for practice
- Tab generation for any instrument
- Personal library and setlist management
- Shareable collections

## Format Strategy

**ChordPro-compatible core** with extensions:

```chordpro
# Standard ChordPro (portable to other apps)
{meta: title Salt Creek}
{meta: artist Traditional}
{meta: composer Traditional}
{key: A}
{tempo: 120}
{time: 4/4}

# ChordPro ABC embedding (for melody/fiddle tunes)
{start_of_abc}
X:1
T:Salt Creek
M:4/4
K:A
|: E2AB c2BA | E2AB c2Bc :|
{end_of_abc}

# Bluegrass Songbook extensions (x_ prefix)
{meta: x_source classic-country}
{meta: x_strum_pattern boom-chick}
{meta: x_difficulty intermediate}
```

**Why this approach:**
- Songs export/import to other ChordPro tools
- ABC notation is the folk music standard
- Custom extensions (`x_*`) for our features
- Other tools ignore what they don't understand

---

## Current State (v1.0) ✅

**Parser & Content**
- 17,122 songs from classic-country-song-lyrics.com (98.5% success)
- Three HTML structure parsers (pre_plain, pre_tag, span_br)
- Manual song submission workflow via GitHub Issues
- Protected files for human-corrected songs

**Search & Discovery**
- Keyword search (title, artist, lyrics)
- Chord search with Nashville numbers (e.g., `chord:VII`)
- Progression search (e.g., `prog:I-IV-V`)
- Key detection using diatonic heuristics

**Viewing & Editing**
- Song display with chord highlighting
- Real-time transposition
- Toggle chords on/off (lyrics-only view)
- Song editor with smart paste (chord-above-lyrics → ChordPro)
- Dark/light theme

**Library (Basic)**
- Favorites stored in localStorage
- Favorites count badge in sidebar

---

## Phase 2: Library Management

**Goal:** Personal collections, setlists, and sharing

### 2.1 Personal Lists
- [ ] Create custom lists beyond favorites
- [ ] Rename/delete lists
- [ ] Drag-and-drop ordering (setlists)
- [ ] List metadata (name, description, created date)

### 2.2 Persistence
- [ ] localStorage for offline/anonymous use
- [ ] Optional cloud sync (future - requires accounts)
- [ ] Export/import lists as JSON

### 2.3 Sharing (v2.x)
- [ ] Generate shareable link for a list
- [ ] Public "community lists" (Jam Standards, Festival Tunes)
- [ ] Follow/subscribe to shared lists

---

## Phase 3: Playback Engine

**Goal:** Practice with rhythm backing (like Strum Machine)

### 3.1 Basic Playback
- [ ] Parse tempo from `{tempo: 120}` directive
- [ ] Parse time signature from `{time: 4/4}`
- [ ] Click track / metronome
- [ ] Play/pause/stop controls
- [ ] Tempo adjustment (slower for learning)

### 3.2 Chord Backing
- [ ] Boom-chick pattern for 4/4
- [ ] Waltz pattern for 3/4
- [ ] Basic chord voicings (root + chord tones)
- [ ] Web Audio API synthesis or samples

### 3.3 Advanced Rhythm
- [ ] Multiple strum patterns per time signature
- [ ] Pattern switching mid-song
- [ ] Custom pattern editor
- [ ] `{x_strum_pattern: ...}` directive support

### 3.4 Playback UX
- [ ] Highlight current chord during playback
- [ ] Loop sections (verse, chorus)
- [ ] Count-in before start
- [ ] A/B loop for practice

---

## Phase 4: Fiddle Tunes & ABC Notation

**Goal:** Support instrumental tunes with melody notation

### 4.1 ABC Parser
- [ ] Parse `{start_of_abc}` / `{end_of_abc}` blocks
- [ ] Extract melody, key, time signature, tempo
- [ ] Validate ABC syntax

### 4.2 Notation Rendering
- [ ] Render ABC as standard music notation (staff)
- [ ] Use abcjs or VexFlow library
- [ ] Responsive sizing for mobile

### 4.3 ABC Playback
- [ ] Play melody from ABC notation
- [ ] Sync with rhythm backing
- [ ] Slow down for learning
- [ ] Loop sections

### 4.4 Tune Library
- [ ] Import common fiddle tune collections
- [ ] Categorize: reels, jigs, waltzes, breakdowns
- [ ] Tag by difficulty, tradition (old-time, Irish, contest)

---

## Phase 5: Tablature Generation

**Goal:** Generate instrument-specific tab from ABC/chords

### 5.1 Instrument Definitions
- [ ] Guitar (standard tuning)
- [ ] Banjo (open G, various styles)
- [ ] Mandolin
- [ ] Dobro
- [ ] Bass
- [ ] Fiddle fingerings

### 5.2 Tab Generation
- [ ] ABC melody → tab for selected instrument
- [ ] Multiple position options (open, up the neck)
- [ ] Chord diagrams inline with lyrics
- [ ] `{start_of_tab}` / `{end_of_tab}` output

### 5.3 Tab Display
- [ ] Render tab notation
- [ ] Toggle between notation and tab
- [ ] Side-by-side notation + tab view
- [ ] Print-optimized tab layout

### 5.4 Smart Tab
- [ ] Suggest fingerings based on context
- [ ] Account for open strings, capo position
- [ ] Bluegrass-specific patterns (rolls, slides, hammer-ons)

---

## Phase 6: Enhanced Content

**Goal:** Grow and improve the song library

### 6.1 Additional Sources
- [ ] Public domain songs (traditional, pre-1926)
- [ ] User-contributed songs (moderated)
- [ ] Partner with existing collections

### 6.2 Quality Improvements
- [ ] AI-assisted chord correction
- [ ] Community voting on quality
- [ ] Professional transcriptions for key songs

### 6.3 Rich Metadata
- [ ] Album/recording references
- [ ] Historical notes, song origins
- [ ] Related songs (same artist, same progression)

---

## Phase 7: Social & Community

**Goal:** Build the bluegrass community hub

### 7.1 User Accounts
- [ ] Sign in (Google, email, etc.)
- [ ] Profile with instrument, skill level
- [ ] Sync favorites/lists across devices

### 7.2 Contributions
- [ ] Submit new songs
- [ ] Submit corrections/improvements
- [ ] Review queue for moderators
- [ ] Reputation system

### 7.3 Community Features
- [ ] Comments on songs
- [ ] "I play this at jams" indicator
- [ ] Regional jam standards collections
- [ ] Teacher/student list sharing

---

## Technical Debt & Infrastructure

### Near-term
- [ ] Compress index.json (gzip to ~5MB from 33MB)
- [ ] Parser: change `{meta: writer}` → `{meta: composer}`
- [ ] Add `{meta: x_source}` provenance to parsed files
- [ ] Service worker for offline access

### Medium-term
- [ ] Semantic search with embeddings
- [ ] SQLite/IndexedDB for client-side search
- [ ] PWA for mobile install

### Long-term
- [ ] Native mobile app (React Native or Flutter)
- [ ] Backend API for cloud features
- [ ] Real-time collaboration on setlists

---

## Design Principles

### 1. ChordPro Compatibility
Standard ChordPro files work everywhere. Our extensions are optional enhancements.

### 2. Offline-First
Core features work without internet. Cloud sync is a convenience, not a requirement.

### 3. Community-Owned Content
Songs are in plain text files, easily exported. No lock-in.

### 4. Progressive Enhancement
Start simple (chord sheets), add complexity (playback, tab) as users need it.

### 5. Bluegrass-Native
Built for how bluegrass musicians actually practice and jam - not generic music software with bluegrass as an afterthought.

---

## Success Metrics

| Milestone | Target |
|-----------|--------|
| Songs in library | 20,000+ |
| Monthly active users | 1,000+ |
| Fiddle tunes with ABC | 500+ |
| Shared public lists | 50+ |
| Community contributions | 100+ songs/month |

---

*This is a living document. Updated as the project evolves.*
