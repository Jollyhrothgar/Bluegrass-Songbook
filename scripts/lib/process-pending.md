# process_pending.py and dedup_scorer.py (reference)

Read from `scripts/lib/CLAUDE.md`.

## process_pending.py: the live contribution path

Run by `.github/workflows/process-pending.yml` on the `pending-commit`
dispatch. A logged-in user saves a song or tab; the row lands in Supabase
`pending_songs`; the edge function classifies it and dispatches; this script
makes it durable in `works/`.

Env: `PENDING_ROW_ID`, `PENDING_MODE`, `PENDING_WORK_ID`, `PENDING_ACTOR`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The mode is decided server-side in
`supabase/functions/_shared/pending-dispatch.ts`; the client cannot claim
"update" on someone else's chart.

| mode | writer call |
|------|-------------|
| `create` | `create_work(on_collision='suffix')` |
| `update` | `update_part` on the part chosen by `update_target` |
| `fork` | `fork_to_arrangement` (`x_version_*` from the submitter) |
| `metadata` | `update_metadata`: title / artist / key / notes only, never a part |
| `placeholder` | `create_work(part=None, on_collision='fail')` |
| tab `create` / `add` / `update` | `create_work` / `add_part` / `update_part` matched on `{'type': 'tablature', 'file': part_file}` |

Rules that break silently if you forget them:

- Idempotence: every part written carries
  `provenance.source_id = pending:<row id>:<content sha>`. A replayed dispatch
  finds it and no-ops; a real re-edit changes the sha. A metadata or
  placeholder row has no content, so `metadata_marker` hashes the fields and
  stamps `metadata_provenance.source_id` on the work. Hashing the null content
  would give every metadata row the same marker and make later edits look like
  replays.
- Ownership is asked per part type (`owns_content(..., part_type)` and the edge
  function's `submittersOf(yaml, partType)`). Counting all parts would let
  someone who submitted a banjo tab "own" a stranger's lyrics and overwrite the
  primary chart.
- `update_target`: the mode alone is not enough, because a user who owns only a
  fork is dispatched as `update`, and a bare `{'type': 'lead-sheet'}` match
  prefers the primary. Rule: the part this row landed on before, else the
  primary if the actor owns it, else their most recent chart. An actor owning
  no chart was admitted by `classifyChange`'s `trusted` branch
  (`pending-dispatch.ts`, caller in `trusted_users`) and may edit the primary.
  Work-level fields ride along only when the primary is edited.
- Tab rows: `pending_songs` has one row per song, so tab ids are
  `tab:<slug>:<rand>` and target `replaces_id`. `tab_work_slug()` re-derives the
  slug from the title; `create_work` resolves collisions against the checkout.
  `validate_otf` is the only structural check an incoming OTF gets. A
  non-owner's tab "correction" becomes a sibling take (`add`). The OTF's
  `x_source` block is dropped (the build fails when it disagrees with
  `provenance.source_id`) and kept as `provenance.x_derived_from`. The
  submitter's comment lands on the part as `x_submission_notes` /
  `x_correction_notes`, not in work-level `notes`.
- The dedup backstop is skipped for tab, metadata and placeholder rows (no
  lyrics to score).
- A placeholder is recognised by shape (`is_placeholder_row`: status
  `placeholder` and no content; the `status` column is sticky: a chart save upserts on the same id, and
  nothing clears it, so a request that later got a chart still says
  `placeholder`; the open insert policy lets clients write it; `content`
  settles it). An existing work
  at the id is a refusal parked via `hold_reason`, not a suffix: an empty
  `foo-1` would be a bounty entry for a song already here.
- Metadata drops fields the row does not carry (null means "not touched";
  there is no clear-a-field gesture). Who may send one is decided by
  `classifyChange`: own any part, or be trusted.

## dedup_scorer.py: is this submission already a work?

Per-submission check; `dedup_works.py` does whole-corpus merge plans.

- Metric is containment, `|A ∩ B| / |smaller side|`, over full normalized lyric
  word sets (`CONTAINMENT_MATCH` = 0.65). Order-independent, and a lyrics-only
  scrape is nearly a subset of a fuller chart, which Jaccard punishes. The
  `how-long-blues` pair scores 0.886 here and 0.043 under `dedup_works.py`.
- Signal order is lyrics, then title (only narrows candidates), then chords
  (not a signal: half the canon is I-IV-V in G; only whether each side has chords picks
  the outcome: existing without chords plus incoming with chords is `enrich`).
- Outcomes: `enrich` / `duplicate` / `arrangement-candidate` / `no-match`. Only
  `enrich` is ever `auto_actionable`, above 0.85.
- With no usable lyrics (instrumentals) it needs a 0.95+ title match, sets
  `low_confidence=True`, and is never auto-actionable.

```bash
uv run python scripts/lib/dedup_scorer.py how-long-blues how-long-blues-1
uv run python scripts/lib/dedup_scorer.py --scan submission.pro --json
```

Tests: `tests/test_dedup_scorer.py` (fixtures in `tests/fixtures/dedup/`).

