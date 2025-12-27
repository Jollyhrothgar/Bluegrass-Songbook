# Bluegrass Songbook - Vision

## What We're Building

The integrated practice and performance tool for the bluegrass community - combining chord sheets, fiddle tunes, rhythm backing, tablature, and library management in one place.

**What exists today (fragmented):**
- Strum Machine → rhythm backing tracks
- TuneFox → fiddle tune tabs
- Ultimate Guitar → chord sheets
- Scattered PDFs, fakebooks, loose sheets

**What we're building (integrated):**
- Songs with chords and lyrics
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
```

**Why this approach:**
- Songs export/import to other ChordPro tools
- ABC notation is the folk music standard
- Custom extensions (`x_*`) for our features
- Other tools ignore what they don't understand

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

## Roadmap

See [GitHub Milestones](https://github.com/Jollyhrothgar/Bluegrass-Songbook/milestones) for current work.

**Quick reference:**
```bash
gh issue list --milestone "Milestone Name"
gh issue list --label quick-win
```
