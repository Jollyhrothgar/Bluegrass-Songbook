---
paths:
  - "supabase/functions/_shared/pending-dispatch.ts"
  - "supabase/functions/_shared/commit-song.ts"
  - "supabase/functions/_shared/testdata/**"
  - "supabase/functions/auto-commit-song/**"
  - "supabase/functions/create-song-request/**"
  - "supabase/functions/reconcile-pending/**"
  - "scripts/lib/process_pending.py"
  - "tests/test_ownership_parity.py"
  - "tests/test_process_pending.py"
---

# The change gate: who may change what

`classifyChange` in `supabase/functions/_shared/pending-dispatch.ts` decides
what a `pending_songs` row is allowed to do, and `scripts/lib/process_pending.py`
mirrors it when the row lands in `works/`. The row kinds (`part_type`) are in
`supabase/CLAUDE.md` under "Contribution pipeline".

## `classifyChange` outcomes

| Kind | Situation | Result |
|---|---|---|
| lead sheet | no work at the id | `create` |
| lead sheet | caller is in a lead-sheet part's `provenance.submitted_by`, or in `trusted_users` | `update` in place |
| lead sheet | anything else | `fork`: a new arrangement part, original untouched |
| tablature | no work at the id | `create` (slug from the title; the row id is synthetic) |
| tablature | `part_file` names a tab part the caller authored, or caller is trusted | `update` in place |
| tablature | anything else | `add`: a new sibling part |
| metadata | caller is trusted, or appears on any part of the work | `metadata` |
| metadata | no claim / no work at `replaces_id` / no `replaces_id` | refused: 403 / 404 / 400 (`MetadataRefusedError`), never a fork or create |
| placeholder | no work at the slug | `placeholder` (mint it) |
| placeholder | work exists / bad id / also sets `replaces_id` | refused: 409 / 400 / 400 (`PlaceholderRefusedError`), never an overwrite or a suffix |

Rules behind the table:

- Ownership is asked per part type: `submittersOf(yaml, 'lead-sheet')` for a
  chart, `tabPartOwners(yaml, file)` for a tab, mirrored in Python by
  `process_pending.owns_content(..., part_type)`. Owning a tab must not buy an
  in-place rewrite of someone's chart. The expectations live in one table,
  `functions/_shared/testdata/ownership-cases.json`, read by both
  `deno task test` and `uv run pytest tests/test_ownership_parity.py`. Add a row
  there when you change either side.
- `anyPartOwners(yaml)` is deliberately looser, and only the `metadata` branch of
  `classifyChange` (not a database column) calls it. Do not "fix" it into `submittersOf`. Contributing anything earns the
  right to say who wrote a song; it does not earn a rewrite of lyrics.
- Metadata refuses when the work is missing; a placeholder refuses when the
  work is present. A placeholder gets no trust bonus (trust used to turn on the
  overwrite). If `apply_placeholder_row` finds the work present at write time,
  the row is parked with `dedup_hold` for the Dungeon.
- `DispatchRefusedError` is the base of the typed refusals; callers catch it.
- The metadata action is logged as `metadata_edit`, which `get_leaderboard()`
  does not score but the rate limit does count.
