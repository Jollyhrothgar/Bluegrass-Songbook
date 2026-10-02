# UI state inventory

Every screen worth workshopping, as a named state you can open on its own or
screenshot. It exists so the design work in the fix-it list
(`docs/plans/2026-09-30-fix-it-list.md`: F7 tab view, F8 list view, the D
library features) can be done one state at a time.

- `states.js` is the inventory: one entry per state, with its URL, the data
  it needs, and the fix-it items it is evidence for.
- `capture.js` turns each state into four screenshots (phone 390x844 and
  desktop 1440x900, light and dark) and a gallery.
- `proposed/` holds mockups of states that do not exist yet (tier D). They are
  plain HTML using the app's colours, and are meant to be argued with.

## Using it

First time in a worktree: `./scripts/bootstrap --quick` and `npm ci`.

```bash
node design/ui-states/capture.js                    # everything (about 5 minutes)
node design/ui-states/capture.js --group Lists      # one group
node design/ui-states/capture.js list-view tab-editor
open design/ui-states/shots/index.html              # the gallery

node design/ui-states/capture.js --open list-view                  # a live window
node design/ui-states/capture.js --open list-view --phone --dark
node design/ui-states/capture.js --list             # regenerate the tables below
```

`--open` gives you the real app in that state (seeded lists and all) to click
around in. The backend is the e2e Supabase mock, so nothing reaches
production and nothing you do is saved. A proposed mockup can also be opened
straight from disk: `open design/ui-states/proposed/d2-items.html` (add
`?theme=dark` to the address for dark).

`shots/` is gitignored. Screenshots are build output: regenerate them after a
UI change rather than committing them.

Adding a state is one entry in `states.js`. If the screen needs data, put it
in `seed` (localStorage) or `mock` (a backend answer); if it needs a click,
put it in `setup`.

## The states

### Browse

| State | What it shows | Where | For |
|---|---|---|---|
| `home` | Home (collections) | `/` | F3 |
| `search-results` | Search results | `/#search/mountain` | F2, F3 |
| `search-browse-all` | Search with no query (the whole canon) | `/#search` | F2 |
| `search-no-results` | Search with no results | `/#search/zzqqxxyy` | F2 |
| `dungeon` | Bluegrass Dungeon (the archive) | `/#dungeon/hank` | F3 |
| `bounty` | Bounty board (wanted songs) | `/#bounty` | F3 |

### Song page

| State | What it shows | Where | For |
|---|---|---|---|
| `song-lead-sheet` | Lead sheet | `/#work/old-home-place` | F3, F5 |
| `song-key-pill` | Lead sheet, Key pill open | `/#work/old-home-place` (needs clicks) | F2, F4 |
| `song-display-pill` | Lead sheet, Display pill open | `/#work/old-home-place` (needs clicks) | F2, F4 |
| `song-info-pill` | Lead sheet, Info pill open | `/#work/old-home-place` (needs clicks) | F2, F4 |
| `song-abc` | Fiddle tune with ABC notation | `/#work/arkansas-traveler-1` | F5 |
| `song-add-to-list` | Add-to-list picker open | `/#work/old-home-place` (seeded data, needs clicks) | F2, D1 |
| `song-not-found` | Song not found | `/#work/this-song-does-not-exist` | F3 |

### Tab page

| State | What it shows | Where | For |
|---|---|---|---|
| `tab-single-track` | Tab, single track (no repeats: the toggle does nothing) | `/#work/foggy-mountain-breakdown/banjo-tab` | F7, F4 |
| `tab-with-repeats` | Tab with real repeats | `/#work/arkansas-traveler-1/banjo-tab` | F7 |
| `tab-multi-track` | Tab, multi-track ensemble | `/#work/foggy-mountain-breakdown/ensemble` | F7, F4 |
| `tab-default-part` | Tab work at its default part (opens on a mandolin break) | `/#work/foggy-mountain-breakdown` | F7 |
| `tab-settings-sheet` | Tab settings sheet (phone); the full band (desktop) | `/#work/foggy-mountain-breakdown/banjo-tab` (needs clicks) | F7, F4 |

### Editors

| State | What it shows | Where | For |
|---|---|---|---|
| `tab-editor` | Tab editor | `/#work/foggy-mountain-breakdown/banjo-tab` (needs clicks) | E4, E5 |
| `editor-new-song` | Lead-sheet editor, new song | `/#add` | E3 |
| `editor-existing-song` | Lead-sheet editor, existing song | `/#edit/old-home-place` | E3 |
| `add-song-picker` | Add Song picker | `/#search` (needs clicks) | F2 |

### Lists

| State | What it shows | Where | For |
|---|---|---|---|
| `lists-library` | Lists library, with folders | `/#lists` (seeded data) | F8, D1 |
| `lists-library-empty` | Lists library, nothing yet | `/#lists` (seeded data) | F8, D1 |
| `list-view` | List view (a setlist with keys, tempos and notes) | `/#list/local_ui_state_jam` (seeded data) | F8, D2, D3, D4 |
| `list-view-empty` | List view, empty list | `/#list/local_ui_state_gospel` (seeded data) | F8 |
| `list-notes-sheet` | List item notes sheet (the only place notes appear today) | `/#list/local_ui_state_jam` (seeded data, needs clicks) | F8, D3, D4 |
| `list-song` | Song opened from a list (notes are not shown) | `/#list/local_ui_state_jam/old-home-place` (seeded data) | F8, D3, D4, D6 |
| `favorites` | Favorites | `/#list/favorites` (seeded data) | F8 |
| `favorites-empty` | Favorites, empty | `/#list/favorites` (seeded data) | F8 |
| `list-shared` | Someone else's list, signed out (a share link) | `/#list/11111111-1111-4111-8111-111111111111` (mocked backend) | F8, D5 |
| `list-not-found` | Share link to a list that does not exist | `/#list/11111111-1111-4111-8111-111111111111` (mocked backend) | F8 |

### Proposed: library

| State | What it shows | Where | For |
|---|---|---|---|
| `proposed-d1-folders` | D1 Folders: the library as nested folders | [proposed/d1-folders.html](proposed/d1-folders.html) | D1, D5 |
| `proposed-d2-items` | D2 Items: dividers, and the same song twice | [proposed/d2-items.html](proposed/d2-items.html) | D2, D4, F8 |
| `proposed-d3-notes` | D3 Notes: a note beside the chart | [proposed/d3-notes.html](proposed/d3-notes.html) | D3, F8 |
| `proposed-d4-overrides` | D4 Overrides: setlist key, capo and tempo applied | [proposed/d4-overrides.html](proposed/d4-overrides.html) | D4 |
| `proposed-d5-sharing` | D5 Sharing: Shared with me, Following, Leave | [proposed/d5-sharing.html](proposed/d5-sharing.html) | D5 |
| `proposed-d6-play-through` | D6 Play-through: a list played song to song | [proposed/d6-play-through.html](proposed/d6-play-through.html) | D6 |
| `proposed-d7-songbook` | D7 Printable songbook: contents, keys and notes applied | [proposed/d7-songbook.html](proposed/d7-songbook.html) | D7 |

## Proposed states: what each mockup claims

Each of these is a first position, drawn to the fix-it list's rule "hide
setup, show content and resources": hairlines instead of cards, setlist data
(key, tempo, note) on the row instead of tags and first lines, and no search
box above a list. The questions are what the workshop should settle, because
the answers decide what the list store (C1) has to hold.

### D1 Folders (`proposed/d1-folders.html`)

The library is one indented outline: folders open in place, lists show their
count and the first line of their note. A list someone shared with you arrives
under "Not filed yet" and you file it where you like.

- C1 needs: folders that nest, and a per-user placement (user, list, folder),
  not a folder column on the shared list.
- Open: an outline that expands in place, or drill into a folder as its own
  page (`#lists/<folder>` already exists)? Does Favorites stay special, or is
  it one more list? How deep may folders nest? Where does drag-to-move live on
  a phone?

### D2 Items (`proposed/d2-items.html`)

A list is a numbered run of items. An item is a song or a divider ("Set 1",
"If they want one more"). The same song appears twice (opener and reprise)
with different notes and tempos. Each row shows what a player needs: title,
key, tempo, the note's first line.

- C1 needs: items with their own ids (today the song id is the key, so a song
  cannot appear twice and each song has one note per list), and a divider item
  kind.
- Open: do dividers carry a note of their own? Does numbering restart per set?
  Is the list note above the items, or folded? What does a row lose on a phone
  when the title is long: the artist, or the note?

### D3 Notes (`proposed/d3-notes.html`)

The song page, opened from a list, shows the item's note beside the chart: a
side panel on desktop that stays put while the chart scrolls, a card pinned
above the chart on a phone. The note is the small Markdown subset (bold,
lists, checkboxes) and pasted Strum Machine and YouTube links become buttons.
The list's own note and "up next" sit under it on desktop. This restores the
read view lost in July (see F8).

- C1 needs: a note on folders, lists and items; checkbox state stored in the
  note text so it syncs like any other edit.
- Open: is a ticked checkbox shared with the band or private to me? On a
  phone, does the card scroll away with the chart or stay pinned? Does the
  desktop panel collapse, and does it remember? Is there a private per-user
  note on a song, outside any list?

### D4 Overrides (`proposed/d4-overrides.html`)

One line under the title says what the list changed and what the song is on
its own ("Setlist key: A, capo 2, play G shapes, 92 bpm; the song's own key is
G"). "Change" opens the item's settings: key, capo, tempo, and whether chords
are shown as shapes or as they sound.

- C1 needs: key, capo and tempo as typed fields on the item (the app acts on
  them), applied on the song page, in print, in export and for followers.
- Open: does capo change the chords shown (shapes) by default? If a viewer
  transposes while in a list, is that a private change or an edit to the list?
  Minor keys and the full set of keys in the picker (today's are major-only).

### D5 Sharing (`proposed/d5-sharing.html`)

The library separates three things by who can edit: Yours, Shared with me
(co-owned, editable), Following (read-only, updates). Leave and Unfollow are
on the row; leaving confirms inline and says the list survives for the other
owners.

- C1 needs: `getFollowedLists` wired up; a leave that removes only you; a
  delete that a co-owner cannot use to remove the list for everyone.
- Open: do shared lists live in their own section (this mockup), in your
  folders with a "shared" tag (the D1 mockup), or both? The two mockups
  disagree on purpose. What does the last owner see when they try to leave?

### D6 Play-through (`proposed/d6-play-through.html`)

A list played song to song. The top band is gone; what is left is the chart at
a larger size (two columns on a wide screen), the key and the note in one
line, and a bottom bar: previous, position ("2 of 9, Set 1"), next with its
key.

- C1 needs: item order and item ids, so position is right when a song appears
  twice or has several versions (today: "0 of N").
- Open: swipe between songs on a phone? Does the note stay one line or expand?
  Auto-scroll, and where its control goes? How does a tab item look in the
  same frame? Does it keep the screen awake?

### D7 Printable songbook (`proposed/d7-songbook.html`)

A print screen with the choices on the left and real pages on the right: a
contents page with set dividers, keys and page numbers, then each song in its
setlist key with its note.

- C1 needs: nothing new beyond D2 to D4; it is the proof that overrides and
  notes are applied everywhere.
- Open: one song per page, or flow them to save paper? Do tab parts print?
  Is the list note the cover text? Is this a browser print, or a PDF we build?

## Found while building this

- On a phone, the add-to-list picker on the song page is clipped off the left
  edge of the screen (`song-add-to-list`, phone shots).
- On a phone, two chords over a short syllable run together with no gap: "A"
  then "D" over "to Charlottesville" reads as "AD" (`song-lead-sheet`, phone).
