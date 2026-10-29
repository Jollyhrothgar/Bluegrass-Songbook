---
paths:
  - "docs/js/__tests__/**"
  - "tests/**"
  - "e2e/**"
---

# Tests and the live songs

Anyone can edit or delete a song in the app. The edit lands in `works/` as a
bot commit, and a test that depended on that song's exact contents fails on
`main`, which blocks every deploy. That happened when Old Home Place was edited
on 2026-10-28 (#320).

The rule (Mike, 2026-10-28):

- **A test of the code reads a frozen copy.** If it checks what a particular
  chart or tab says (exact lines, counts, track ids), put a copy in
  `docs/js/__tests__/fixtures/` (Vitest) or `tests/fixtures/` (pytest), with a
  comment naming the work it came from and the date.
- **A test may read live songs only to catch problems in that data**: a smoke
  test such as "a real tab renders end to end", or a sweep of the whole corpus
  ("no chart loses lyric lines", the round-trip of real charts,
  `tests/test_scraped_attribution.py`). A failure there means a real song hit a
  real problem.
- `docs/js/__tests__/no-live-corpus.test.js` fails if a unit test opens one
  song's file under `works/`. A deliberate smoke test ends that line with
  `// live smoke test`.
- **E2E specs use live songs** (`old-home-place`, `house-of-gold`, …) because
  they run against the built site, so assert structure (a pill, a ring, a
  title) rather than a song's exact chords or words; `openFrozenOldHomePlace`
  in `e2e/helpers/lead-editor.js` opens a frozen copy where exact text matters.
