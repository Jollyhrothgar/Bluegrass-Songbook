# Plan: AlphaTab-Based Tab Viewer, Player & Editor

## Context

The current OTF editor (`feature-otf-editor`) has a custom SVG renderer, Web Audio
playback, and vim-style modal editing. It works for simple tabs but is buggy, not
fluid enough, and the UX needs more exploration. Rather than continuing to invest in
a custom rendering/playback engine, we pivot to **AlphaTab** — a battle-tested library
that handles rendering (tab + standard notation), playback (Web Audio + SoundFont),
and Guitar Pro format support out of the box.

**What we keep** from the existing work:
- OTF format as our canonical storage format (JSON, human-readable, git-friendly)
- TEF parser and conversion pipeline (separate concern, outputs OTF)
- Content library (100+ tabs, 17K songs, fiddle tunes)
- Supabase auth and infrastructure
- Lessons learned about UX (what worked, what didn't)

**What we replace**:
- Custom SVG tablature renderer → AlphaTab renderer
- Custom Web Audio playback → AlphaTab's built-in player (SoundFont-based)
- Custom cursor/note-entry system → new editing UX (TBD, not necessarily vim-style)

**What's out of scope** (separate projects/concerns):
- TuxGuitar (not needed — AlphaTab handles GP formats better)
- PDF-to-tab ML pipeline (separate project, just needs to output OTF)
- Further TEF reverse-engineering (separate concern, already works for 100+ files)

## Decision: AlphaTab Directly, Not an its-mytabs Fork

[louislam/its-mytabs](https://github.com/louislam/its-mytabs) is a Vue+TypeScript+Deno
app built on AlphaTab. It's a great reference implementation, but forking it would mean
inheriting a Deno backend, Docker deployment, and Vue framework that don't match
bluegrassbook.com's vanilla JS, no-build-step architecture.

Instead: use AlphaTab directly as a library, reference its-mytabs for integration
patterns (especially AlphaTab initialization, file loading, and track controls).

## Architecture: Dual-Use Module

Build a **self-contained module** that works in two modes:

### 1. Embedded in bluegrassbook.com

```
bluegrassbook.com work view
└── <div id="tab-container">
    └── AlphaTabModule.init(container, { otf: tabData, mode: 'viewer' })
        ├── AlphaTab renderer (tab + optional standard notation)
        ├── Playback controls (play/pause, tempo, loop)
        ├── Track mixer (mute/solo for multi-track tabs)
        └── [Future] Edit button → switches to editor mode
```

Replaces the current `TabRenderer` + `TabPlayer` in `docs/js/renderers/`.

### 2. Standalone Application

```
tab-editor.html (or separate deployed app)
└── AlphaTabModule.init(container, { mode: 'editor' })
    ├── File picker (open OTF, GP, MusicXML)
    ├── Full AlphaTab renderer + player
    ├── Editing UI (note entry, articulations, measures)
    ├── Save/export (OTF, GP, MusicXML, MIDI, PDF)
    └── Instrument/tuning configuration
```

Could be deployed at e.g. `editor.bluegrassbook.com` or bundled as the same site.

## Format Strategy

```
Storage (on disk / in git):
  OTF JSON files  ←→  the canonical format, human-readable, diffable

Import:                          Export:
  TEF → OTF  (existing parser)    OTF → Guitar Pro (via AlphaTab)
  GP  → Score (AlphaTab native)   OTF → MusicXML  (via AlphaTab)
  ABC → MusicXML → Score          OTF → MIDI      (via AlphaTab)
  PDF → OTF  (future ML pipeline) OTF → PDF       (via AlphaTab canvas)

Runtime (in memory):
  OTF JSON  →  AlphaTab Score object  →  rendered tab + audio
                    ↕ (bidirectional for editing)
  AlphaTab Score  →  OTF JSON  (serialize back after edits)
```

**Key conversion**: OTF ↔ AlphaTab Score. This is the critical bridge code.
AlphaTab's Score model is rich (tracks, bars, beats, notes, effects, bends,
etc.). OTF maps cleanly to a subset of it. The converter must:

- Map OTF tracks → AlphaTab Track objects (instrument, tuning, capo)
- Map OTF measures/events → AlphaTab Bar/Beat/Note objects
- Map OTF ticks → AlphaTab durations
- Map OTF articulations (h/p//) → AlphaTab effects (HammerOn, Slide, etc.)
- Map reading_list → AlphaTab repeat groups / section markers
- Reverse all of the above for serializing edits back to OTF

**ABC notation for fiddle tunes**: Convert ABC → MusicXML (using abcjs or a
lightweight converter), then let AlphaTab render it as standard notation. This
eliminates the separate abcjs rendering path and gives fiddle tunes proper
standard notation display — solving the current ABC-only limitation.

## AlphaTab Integration Details

**Library**: [@coderline/alphatab](https://www.npmjs.com/package/@coderline/alphatab)
**License**: MPL-2.0 (modifications to AlphaTab must be shared; our app code is ours)
**Size**: ~500KB JS + SoundFont files (10-50MB depending on quality)
**Docs**: https://alphatab.net

### What AlphaTab Gives Us For Free

- Tab rendering for any stringed instrument (banjo, guitar, mandolin, bass, etc.)
- Standard notation rendering (simultaneous with tab — solves fiddle tunes)
- Guitar Pro format import (.gp3/.gp4/.gp5/.gpx/.gp)
- MusicXML import
- Built-in audio playback with SoundFont2 instruments
- Track muting/soloing
- Tempo control
- Beat cursor during playback
- Note highlighting
- Responsive layout
- All guitar/string techniques (bends, slides, hammer-ons, pull-offs, harmonics, etc.)
- Chord diagrams
- Lyrics display

### What We Build

1. **OTF ↔ AlphaTab Score bridge** (the critical piece)
2. **Module wrapper** (initialization, configuration, lifecycle)
3. **bluegrassbook.com integration** (replace TabRenderer/TabPlayer)
4. **Editor UI** (note entry, editing interactions — the hard part)
5. **ABC → MusicXML converter** (for fiddle tunes)

### Loading AlphaTab in a No-Build Environment

AlphaTab is distributed as an npm package but also provides UMD/ESM bundles.
Options for our vanilla JS, no-build setup:

- **CDN**: Load from unpkg/jsdelivr (`<script src="...">`), reference as global
- **Vendored**: Download the bundle into `docs/js/vendor/alphatab/`
- **ES module import map**: Use browser-native import maps to resolve the package

Vendored approach is most consistent with the existing architecture (no external
CDN dependency, works offline). The SoundFont file can be lazy-loaded on first
playback.

## Phased Implementation

### Phase 0: Spike / Proof of Concept

**Goal**: Get AlphaTab rendering an existing OTF tab in the browser.

- [ ] Set up AlphaTab in a standalone HTML page (no bluegrassbook.com integration yet)
- [ ] Write the OTF → AlphaTab Score converter (core bridge code)
- [ ] Load one of our OTF files (e.g., Salt Creek) and render it
- [ ] Verify: correct notes, correct strings, correct articulations, correct timing
- [ ] Get playback working with a SoundFont
- [ ] Compare rendering quality against current SVG renderer
- [ ] Test with a multi-track tab (if we have one)
- [ ] Document any OTF features that don't map cleanly to AlphaTab's model

**Deliverable**: A single HTML page that loads an OTF JSON file and renders
playable tablature via AlphaTab. This validates the approach before we invest
in integration.

**Key risk to retire**: Can we accurately convert OTF's tick-based timing to
AlphaTab's duration model? OTF uses absolute tick positions; AlphaTab uses
relative durations (quarter, eighth, etc.). The converter needs to infer
durations from tick gaps.

### Phase 1: Replace Viewer in bluegrassbook.com

**Goal**: Swap the existing TabRenderer + TabPlayer for AlphaTab in the live site.

- [ ] Create `docs/js/renderers/alphatab-renderer.js` module
- [ ] Implement the AlphaTabModule API (init, load, destroy)
- [ ] Integrate into `work-view.js` (replace TabRenderer instantiation)
- [ ] Handle the OTF → Score conversion on load
- [ ] Playback controls (play/pause/stop, tempo slider, loop)
- [ ] Track mixer for multi-track tabs (mute/solo/volume)
- [ ] Dark/light theme support (AlphaTab is CSS-styleable)
- [ ] Handle ABC notation: convert to MusicXML, render as standard notation
- [ ] Responsive layout (works on mobile)
- [ ] Performance: lazy-load AlphaTab JS + SoundFont only when a tab is viewed
- [ ] Fallback: if AlphaTab fails to load, show a message (not a blank page)
- [ ] Remove or deprecate old TabRenderer + TabPlayer

**Deliverable**: bluegrassbook.com renders all existing tabs via AlphaTab, with
playback, and fiddle tunes show standard notation.

### Phase 2: Guitar Pro Import + Format Expansion

**Goal**: Accept Guitar Pro files directly, expanding our content library.

- [ ] File upload UI (drag-and-drop or file picker)
- [ ] AlphaTab natively parses GP files → render directly
- [ ] GP → OTF conversion (serialize AlphaTab Score to our format for storage)
- [ ] MusicXML import (AlphaTab supports this natively too)
- [ ] Test with a variety of GP files (GP3, GP4, GP5, GPX, GP7)
- [ ] Handle edge cases: multi-track, tempo changes, alternate tunings

**Deliverable**: Users can open Guitar Pro files in the viewer. We can convert
community GP tabs into our OTF library.

### Phase 3: Editor — UX Exploration

**Goal**: Build editing capabilities. The UX is the hardest part and needs
exploration — we're NOT committing to vim-style or any specific paradigm yet.

#### UX Research First

Before building, study how existing editors work:
- **Soundslice**: Click-to-place, property panel, very visual
- **Guitar Pro desktop**: Traditional toolbar + click interaction
- **Flat.io**: Click on staff, type to enter notes, toolbar for durations
- **MuseScore**: Similar to Flat — select duration, click to place
- **Noteflight**: Browser-based, click-to-place with smart defaults
- **its-mytabs**: Viewer only (no editing), but good playback UX reference

Common patterns across successful editors:
1. Select a duration first (toolbar or keyboard shortcut)
2. Click on a string/position to place a note
3. Type a fret number (0-9, then the note appears)
4. Arrow keys to navigate between positions
5. Delete/backspace to remove
6. Undo/redo (Ctrl+Z/Y)

The vim-style modal approach may appeal to power users but creates a learning
curve. Consider starting with a more conventional click-to-place UX and adding
keyboard acceleration as an enhancement.

#### Editor Implementation

- [ ] **Note entry**: Click on a string position → type fret number → note placed
- [ ] **Duration selection**: Toolbar buttons + keyboard shortcuts (1-6 for whole→32nd)
- [ ] **Navigation**: Arrow keys move between beat positions, Tab moves between strings
- [ ] **Deletion**: Delete/Backspace removes note at cursor
- [ ] **Articulations**: Select from toolbar or keyboard shortcut, then click to apply
- [ ] **Undo/redo**: Ctrl+Z / Ctrl+Shift+Z (standard, not vim-style)
- [ ] **Measure operations**: Insert/delete measures, copy/paste measures
- [ ] **Instrument setup**: Choose instrument, tuning, capo, time signature, tempo
- [ ] **Save**: Serialize AlphaTab Score → OTF JSON → download or save to server
- [ ] **Real-time preview**: Changes immediately reflected in rendered tab

#### Open Questions

- How does AlphaTab handle Score mutations? Is there an API for modifying the
  Score model programmatically, or do we need to rebuild the Score from scratch
  on each edit? (This determines our editing architecture.)
- Should the editor be a separate page/route or an inline mode on the work view?
- Do we want collaborative editing eventually? (Affects data model decisions.)
- Should we support creating tabs from scratch or only editing existing ones?

### Phase 4: Standalone App + Polish

**Goal**: Package the editor as a standalone tool that works independently.

- [ ] Standalone HTML page with full editor
- [ ] File open/save (OTF, GP, MusicXML)
- [ ] Export to MIDI, PDF
- [ ] PWA support (installable, works offline)
- [ ] Print layout / PDF export via AlphaTab's canvas rendering
- [ ] Keyboard shortcut help overlay
- [ ] Instrument library (preset tunings for common instruments)
- [ ] Template tabs (blank 12-bar blues, 32-bar standard, etc.)

## Technical Risks

1. **OTF ↔ AlphaTab Score conversion fidelity**: Our tick-based timing must
   map accurately to AlphaTab's duration model. Triplets, ties, and irregular
   rhythms need careful handling. Phase 0 spike retires this risk.

2. **AlphaTab editing API**: AlphaTab is primarily a renderer/player. Mutating
   the Score model for editing may require working with internal APIs or
   rebuilding Score objects. Need to investigate during Phase 0.

3. **SoundFont size**: Quality SoundFonts are 10-50MB. Need lazy loading and
   possibly a reduced SoundFont with just banjo/guitar/mandolin/bass/fiddle.

4. **No-build integration**: AlphaTab is distributed as an npm package. Using
   it without a bundler requires either vendoring the UMD bundle or using
   import maps. Need to verify this works cleanly.

5. **MPL-2.0 license**: If we modify AlphaTab source code, those modifications
   must be shared. Our application code remains ours. Should avoid modifying
   AlphaTab itself — extend via wrapper code instead.

## What Carries Forward

### From feature-otf-editor (reusable)
- OTF format specification (DESIGN.md) — the format is solid
- Test suite patterns (384+ tests) — adapt for new module
- UX lessons (what felt good/bad about modal editing)
- Toolbar design patterns (duration/articulation selection)
- Note entry popover concept (good for touch/click)

### From its-mytabs (reference, not fork)
- AlphaTab initialization patterns
- Track mixer UI approach
- Playback control layout
- Dark/light theme handling
- File loading patterns

### From the TEF parser (unchanged, separate concern)
- Continues to output OTF JSON
- New renderer consumes OTF the same way
- Parser improvements happen independently

### From pdf_to_tabledit (unchanged, separate concern)
- Will eventually output OTF JSON
- Intermediate format spec is OTF
- ML pipeline development continues independently

## File Structure (Proposed)

```
docs/js/
├── alphatab/                    # New module
│   ├── module.js                # Main entry: init, load, destroy
│   ├── otf-bridge.js            # OTF ↔ AlphaTab Score conversion
│   ├── abc-bridge.js            # ABC → MusicXML conversion
│   ├── editor.js                # Editor UI (Phase 3)
│   ├── controls.js              # Playback controls, track mixer
│   └── CLAUDE.md                # Module documentation
├── vendor/
│   └── alphatab/                # Vendored AlphaTab library
│       ├── alphaTab.min.js
│       ├── alphaTab.min.css
│       └── soundfont/           # Lazy-loaded SoundFont files
├── renderers/
│   ├── tablature.js             # [DEPRECATED after Phase 1]
│   ├── tab-player.js            # [DEPRECATED after Phase 1]
│   └── alphatab-renderer.js     # Thin adapter for work-view.js
└── work-view.js                 # Updated to use AlphaTab module
```

## Success Criteria

- [ ] All 100+ existing OTF tabs render correctly in AlphaTab
- [ ] Playback sounds better than current Web Audio oscillators
- [ ] Fiddle tunes render as standard notation (not just ABC text)
- [ ] Guitar Pro files can be opened and viewed
- [ ] Editor allows creating a simple 8-measure banjo tab from scratch
- [ ] Module works both embedded in bluegrassbook.com and standalone
- [ ] No build step required (stays vanilla JS / ES modules)
- [ ] Mobile-friendly rendering and playback
