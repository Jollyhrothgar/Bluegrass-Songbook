---
paths:
  - "docs/js/__tests__/**"
  - "tests/**"
  - "e2e/**"
---

# Tests read pinned copies, not the live songs

Anyone can edit or delete a song in the app. The edit lands in `works/` as a
bot commit, and a test that read that song fails on `main`, which blocks every
deploy. That happened when Old Home Place was edited on 2026-10-28.

- **A test of code reads a pinned copy.** Put it in
  `docs/js/__tests__/fixtures/` (Vitest) or `tests/fixtures/` (pytest), with a
  comment saying which work it was copied from and when.
  `docs/js/__tests__/no-live-corpus.test.js` fails if a unit test opens a file
  under `works/`.
- **A check of the data itself reads the live corpus on purpose**, and its
  failure means bad data, not broken code (for example
  `tests/test_scraped_attribution.py`). Say so at the top of the file.
- **E2E specs still use live songs** (`old-home-place`, `house-of-gold`, …),
  because they run against the built site. They aren't in CI, but an edit or a
  deletion can still break them locally, so assert structure (a pill, a ring,
  a title) rather than a song's exact chords or words.
