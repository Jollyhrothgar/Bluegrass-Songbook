# Migration tests (local stack only)

Replays `supabase/migrations/` from zero in a throwaway Supabase stack and
asserts what the list-ownership migrations (`20260930000000`, `20260930010000`)
are supposed to guarantee. **Nothing here touches production**: the stack is
local Docker, the script never reads `supabase/.temp`, never links, never
pushes.

```bash
supabase/tests/run.sh          # start stack, run everything, tear it down
supabase/tests/run.sh --keep   # leave it up (prints the workdir + how to stop it)
```

Needs Docker and the Supabase CLI. First run pulls images (a few minutes).
Own `project_id` (`bb-migration-test`) and ports 544xx, so it does not collide
with a normal `supabase start`.

| File | What it does |
|---|---|
| `baseline/00000000000000_dashboard_baseline.sql` | Recreates the few objects that were made by hand in the dashboard and have no `CREATE` in `migrations/` (`user_lists`, `user_list_items`, `song_flags`, `submit_flag`, `get_visitor_flag_count`). Without it `supabase db reset` dies on `20251231110000`. A reconstruction, not a dump. Test-only: it is copied into the throwaway workdir, never into `migrations/`. |
| `list_security.test.sql` | One rolled-back transaction. Plays anon, an unrelated signed-in user, an owner, a follower, an invitee by switching role + `request.jwt.claims`, and asserts reads, writes, grants, claim / leave / orphan / delete and `log_events`. |
| `rest_smoke.py` | The same guarantees over HTTP through PostgREST with signed JWTs, using the exact calls `docs/js/supabase-auth.js` makes (`rpc('remove_list_owner', { p_list_id })`, `.contains('owners', [me])`, the followed-list reads). |
| `post_deploy_check.sql` | **Read-only, for production.** One SELECT: every policy on the list tables, RLS flags, who can execute what, function attributes, and the bodies of the functions whose source is not in the repo. `run.sh` runs it locally to prove it passes. |
| `post_deploy_probe.sql` | **For production, rolled back.** Role-switched probes (anon and an unrelated user see no list rows; `log_events` inserts; `add_list_owner` is refused). Everything, including the one `log_events` row, is rolled back. |

`run.sh` also runs `scripts/lib/schema_assert.py` (the `db-check` invariants)
against a dump of the local schema.

## After `./scripts/utility db-push` to production

```bash
./scripts/utility db-check                                   # invariants, incl. lists.reads-closed
psql "$PROD_DB_URL" -X -f supabase/tests/post_deploy_check.sql   # no FAIL rows; read the INSPECT rows
psql "$PROD_DB_URL" -X -f supabase/tests/post_deploy_probe.sql   # ends with PASS
```

`post_deploy_check.sql` also pastes into the Supabase dashboard SQL editor. The
probe file works there too (it runs as `postgres`, which may `set local role`).

Read the INSPECT rows: `submit_flag` and `get_visitor_flag_count` exist only in
production, and `20260107010000` gave both an empty `search_path`. If either
body names a table without `public.`, it has the `log_events` bug.
