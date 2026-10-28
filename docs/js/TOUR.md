# Feature tour: rules

Read this before changing `tour.js`, `tour-editor-demo.js`, the tour copy, or
the `lead.present` hooks in `lead-editor/index.js`.

- Steps are data (`TOUR_STEPS`); a step's `targets` are tried in order and the
  first visible one is ringed. Three steps type a song into the real editor
  (`tour-editor-demo.js`) by pressing real buttons. Its only editor hooks are
  `lead.present.select / boxAt / end` (`lead-editor/index.js`): a selection that
  shows the section bar without focusing the editor (focus raises a phone
  keyboard). It calls `resetEditorForNewSong()` on leaving the editor.
- The `.tef` step copy was checked against the app: a drop opens the editor
  signed out, while Add Song > Tablature asks for sign-in first. Re-check the
  card text if either flow changes.
- The invitation (`setTourInvite`) sets `localStorage['songbook-tour-seen']`;
  after that the tour is the first overflow item (`setOverflowLead`). It never
  opens itself. `?tour` starts it, `?tour=reset` re-arms the invitation.
- No backdrop: the card (`z-index: 899`) sits under both bands, the ring (`901`)
  never takes a click. `main.js::startFeatureTour` refuses to start (toast) while the lyrics & chords
  editor is open (`currentView === 'add-song'`) or the URL is a tab-editor route
  (`parseTabRoute`).
- Tests: `__tests__/tour*.test.js`, `e2e/tour.spec.js`, `e2e/tour-mobile.spec.js`.
