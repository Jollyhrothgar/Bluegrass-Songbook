# G20: a stand-alone tab editor

G15 gave the tab editor a private round trip: open a `.tef` or `.otf.json` at
`/tab-editor/`, edit it, and save it back with File ▸ Save as… (#345). Mike
checked Save as on his iPhone on 2026-10-30. On that check he also found that,
with a multi-track `.tef` open, nothing showed how to switch tracks. Mike's
sequence (2026-10-30): first make the editor work as a tab editor on its own,
then spend a period on the mobile and desktop UI.

This file is the spec and the orchestrator's running state. The fix-it list's
Status column (`docs/plans/2026-09-30-fix-it-list.md`, rows G20, G20a, G20b)
remains the backlog's source of truth.

## What was missing (checked in the code, 2026-10-30)

- **Phone track switching.** The editor draws one track at a time. G17 (#341)
  hid the toolbar's Track row on phones (`toolbar.js`, the `.track-section`
  rule under `PHONE_MAX_WIDTH`). Since then the only path is ☰ ▸ Score
  (folded) ▸ Tracks, and nothing on screen says the file has more than one
  track.
- **A tab's setup can't be changed after it is created.** There is no editor
  path to change tuning, capo, time signature, key, a track's instrument, or
  the file's composer:
  - the front door asks for a title and an instrument only;
  - `EditingFacade` only sets tempo and Tab by;
  - Score ▸ Tuning… and Score ▸ Time signature… exist in `menu-bar.js`, but
    the editor registers no handler, so they never show.
- **The title box doesn't reach the file.** On a new tab, the title box above
  the editor writes only `currentWork.title` (`work-view.js`). Save as and the
  `.tef` writer read `otf.metadata.title`, so a renamed tab saves under its old
  title.

## Mike's decisions (2026-10-30)

- Phones switch tracks with the **track name ▾** above the tab:
  - shown only on multi-track files, as "Mandolin ▾ 1 of 4";
  - tap it for the list of tracks;
  - it adds no row.
- G20 is **Tab setup** only. Not in G20, and still open:
  - time-signature changes at a measure;
  - repeats with first and second endings (`facade.repeatSpanWithEndings` has
    no caller);
  - naming sections;
  - creating chord diagrams;
  - print or PDF from the editor.
- **The page shell waits for the UI phase.** A file you open still lands as a
  "new take" on a song page, with Submit tab as the band's big button.

## Pieces

### G20a: phone track switcher (`feature/g20a-phone-tracks`)

- On a phone (≤ `PHONE_MAX_WIDTH`) with two or more tracks, the track's name
  above the tab becomes a button, "Mandolin ▾ 1 of 4".
  - Tapping it lists the tracks, with a checkmark on the current one.
  - Choosing a track does what Score ▸ Tracks does (`state.setTrack`).
  - The list follows renames, reorders, adds, deletes and undo.
  - One track: no ▾ and no count.
- Desktop is unchanged. Its toolbar Track row and Score ▸ Tracks stay.
- The read view's track header is unchanged. It belongs to G19, on another
  branch.
- **Done when:**
  - e2e at phone width: open a 4-track `.tef`, switch with ▾, then edit a note
    on the chosen track;
  - a one-track file shows no ▾;
  - unit tests for the label and the list;
  - the desktop toolbar specs still pass.

### G20b: Tab setup (`feature/g20b-tab-setup`)

- **Score ▸ Tab setup…** opens one panel. It is a popover on desktop and a
  bottom sheet on a phone, like `SaveAsPopover`, and never a
  `window.prompt`. It replaces the dead Tuning… and Time signature… entries.
- **The whole tab:** title, composer, key, time signature, tempo.
- **The current track:** instrument, tuning and capo. Tuning is a preset for
  the instrument (the names the renderer already uses), or Custom with one
  pitch per string.
- **Undo.** One Apply is one undo step, through new `EditingFacade` setters
  that have unit tests.
- **The title box and the file agree.** The title box above a new tab writes
  `metadata.title`, and Tab setup's title updates the box. The box's Artist
  ("who plays it") is not the composer, and stays as it is.
- **The front door asks for a time signature too.** `openNewTabPage` already
  takes one.
- **Design calls (orchestrator, 2026-10-30; flagged to Mike):**
  - *Tuning or instrument change on a track with notes:* every note keeps its
    string and fret, so the tab as written stays and the sound follows the new
    tuning. A change that removes a string some notes are on is refused, with
    a sentence giving the count and the first measure.
  - *Whole-tab time signature:* applied only when every note still fits its
    measure. Otherwise it is refused, with a sentence naming the first measure
    that doesn't fit. Mid-piece changes already in the file stay.
  - *Key:* stored in OTF. A `.tef` can't hold it yet; Save as already says so.
- **Done when:**
  - facade unit tests: each setter, undo and redo, every refusal;
  - a round trip: setup values → `writeTef` → parse → same values (key as a
    notice);
  - e2e on desktop and phone: open Tab setup, change capo, tuning and time
    signature, Save as `.tef`, reopen it and see the change;
  - an e2e for the front door's time signature;
  - a renamed new tab saves under its new title.

## Orchestration

| ID | Piece | Model / effort | Worktree | Status | Checked |
|----|-------|----------------|----------|--------|---------|
| G20a | Phone track switcher | Sonnet / medium | `g20a-phone-tracks` | dispatched 2026-10-30 | |
| G20b | Tab setup + title sync + front door meter | Sonnet / high | `g20b-tab-setup` | dispatched 2026-10-30 | |

The batch branch is `feature/g20-stand-alone-editor`. Both pieces merge into
it, and one PR follows. G19 (the song page docks) is building on
`feature/g19c-tab-dock` at the same time. The split agreed with that session:
the editor and everything inside it is G20's; the song page chrome and read
views are G19's. The two branches share these seams, and each side pings the
other before changing them:

- `work-view.js` `mountTabEditor` / `enterTabEditMode`;
- `shell.js` `setTopBar`;
- `e2e/helpers/tab-edit.js`.

Whichever PR merges second merges main in and reruns the full e2e.

## Log

- 2026-10-30 · Mike: "Fix the oneline docs, then proceed with the next phase
  of work." Docs PR #347 (G15 rows → done) is open; its merge is waiting for
  Mike.
  - The triage (Sonnet medium) and the gap audit (Sonnet medium) are the
    "What was missing" section above. I checked the toolbar rule, the missing
    hooks and setters, and the title path in the code.
  - Mike's answers: track name ▾; scope = Tab setup; shell in the UI phase.
- 2026-10-30 · Dispatched G20a (general-purpose, Sonnet medium, e2e on 8311)
  and G20b (general-purpose, Sonnet high, e2e on 8312). Both are off
  16e5d8567, in their own worktrees, with no push.
  - The briefs keep `renderers/` to an `export` (G20b's tuning names), and
    keep the read view's output byte-identical (G20a).
  - G19's session (mean-insect) agreed to both `work-view.js` touch points:
    the `#new-tab-title` handler, and the front door passing `timeSignature`
    to `openNewTabPage`. Its c1 rewrites the section right after
    `renderTitleHeader`, so expect a small textual merge there.
  - It is drafting G21 (renderer lanes: roll fingering, left-hand fingers,
    chord names, text). Its recommendation to Mike:
    - G21b, the OTF chord-annotation type and the importer, to G19's session;
    - G21c, the chord-picker entry in the editor, to this orchestrator after
      G20.
