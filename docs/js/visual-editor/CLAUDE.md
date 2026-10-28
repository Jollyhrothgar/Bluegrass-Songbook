# visual-editor/ (shared model + helpers)

The directory name is a leftover. The interactive-preview editor that lived here was replaced
by the CodeMirror editor in `../lead-editor/` (read its CLAUDE.md). What remains is a pure,
DOM-free layer that is still live: `editor.js` imports `model.js`; `lead-editor/doc-model.js`
imports `syllables.js`; `lead-editor/section-ops.js` imports `wrap-section.js`. All three are
listed in `LAZY_MODULE_URLS` (`../lazy-modules.js`), so they must never enter `main.js`'s
static import graph.

- `model.js`: `SongDocument`, `parseSong` / `serializeSong` plus pure edit ops. A line is
  `{lyrics, chords:[{chord, position}]}`; chords anchor to character offsets. Invariant:
  `serializeSong(parseSong(x))` equals `x` after normalisation (trailing whitespace,
  blank-line runs); metadata and unknown directives ride through. `editor.js` builds the
  submitted ChordPro with it. `renderers/chordpro.js` splits implicit verses on blank lines by
  the same rule; keep the two in step.
- `wrap-section.js`: `wrapSelectionAsSection` extends a selection to whole lines, strips
  section directives inside it, trims edge blanks and numbers the label by position.
- `syllables.js`: `syllabify(word)` and `tokenizeLine`, the seams for chord placement.
  `syllabify(w).join('') === w` always. It is Liang hyphenation over US English patterns
  (`docs/vendor/hyph-en-us.js`, regenerate with `./scripts/vendor-hyphenation`) plus lyric
  rules (a-way, to-night, ev-ery; silent e is never its own syllable). The pattern module loads
  lazily with the editor. `tokenizeLine` adds seams for hyphens and chords already inside a word.
  Regression guard: `docs/js/__tests__/fixtures/syllable-corpus.json`, built by
  `./scripts/build-syllable-corpus` and scored by `syllable-corpus.test.js` (threshold in that
  test; no common one-syllable word may be split). Re-run it after touching the rules.

Tests: `visual-editor-model*.test.js`, `visual-editor-syllables.test.js`,
`visual-editor-wrap-section.test.js`.
