---
paths:
  - "docs/js/editor.js"
  - "docs/js/smart-paste.js"
  - "docs/js/auth-return.js"
---

# The lead-sheet editor shell (`docs/js/editor.js`)

`editor.js` hosts the CodeMirror editor in `docs/js/lead-editor/` (its own
`CLAUDE.md` covers the modes).

- Smart paste (`smart-paste.js`) turns a heading for a played part (`[Intro]`,
  `[Interlude]`, `[Instrumental]`, `[Break]`, `[Solo]`, `[Outro]`, `[Tag]`,
  `[Ending]`) into a real section, and a line of chords with no words under it
  into a chords-only line (`[G]   [B7]    [C]`), so its chords transpose. Other
  headings (`[Capo 2]`) stay `{comment: …}` notes. A pasted chord that sits a
  letter or two into a word (chord sites draw it over the word: `t[G]en`) moves
  to the start of that syllable, `[G]ten`; deeper into a long syllable it backs
  up only to the start of its sound (`Charlottes[G]ville`)
  (`smart-paste.js::chordColumnToLyric`). The downbeat isn't in the text, so
  placing it exactly stays the charter's job in Chords mode.
- Every reader of the song text goes through `getText()` / `setText()` (submit,
  copy, download, dirty check, sign-in return record, transpose).
  `#editor-content` is only a hidden fallback textarea.
- The editor is a view entered through `currentView` (`enterEditMode` calls
  `setCurrentView('add-song')`); do not hide the song page by hand. Leaving with
  unsaved edits shows `promptUnsavedChanges` (never `window.confirm`; a test
  forbids native dialogs), and `main.js::guardEditorExit` defers `exitEditMode()`
  until the answer because the navigation has already happened.
- Ownership wording mirrors the server (`pending-dispatch.ts`): the submitter and
  trusted users update in place ("Submit Correction"); everyone else forks
  ("Save as My Arrangement"). `editsInPlace()` decides.
- There is deliberately no Edit Comment field: `pending_songs.notes` becomes the
  work's `notes` when an edit lands on the primary chart (`process_pending.py`),
  so a free-text comment would overwrite the song's description.
- The sign-in redirect (`auth-return.js`) restores the route and the editor's
  text; see `CONTRIBUTIONS.md` before changing it.
