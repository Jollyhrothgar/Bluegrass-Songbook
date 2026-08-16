-- Phase 3b: park a submission the dedup backstop refused to write.
--
-- The backstop (scripts/lib/process_pending.py) can conclude that an incoming
-- row is a straight duplicate of a work already in works/. It then writes
-- nothing — but the row still has github_committed = false, which is exactly
-- what the hourly reconciler looks for. Left alone, the reconciler would
-- re-dispatch it every hour, the backstop would refuse it every hour, and the
-- review issue would grow a comment an hour forever.
--
-- `dedup_hold` is the brake: non-null means "a human owes this row a decision".
-- reconcile-pending skips held rows; cleanup-pending is unaffected (it only
-- reaps rows that ARE committed, and a held row never is).
--
-- Clearing the flag (set it back to null) is how a reviewer says "no, land it"
-- — the next reconciler pass then re-dispatches it normally.
--
-- NOT APPLIED by this branch — apply with the rest of the phase.

alter table pending_songs add column if not exists dedup_hold text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_dedup_hold_len') then
    alter table pending_songs
      add constraint pending_songs_dedup_hold_len
      check (dedup_hold is null or char_length(dedup_hold) <= 5000);
  end if;
end
$$;

comment on column pending_songs.dedup_hold is
  'Non-null: the dedup backstop refused to write this row (value = why). '
  'reconcile-pending skips it until a human clears the flag.';

-- The reconciler''s hot query is "uncommitted and not held".
create index if not exists idx_pending_songs_uncommitted_unheld
  on pending_songs(created_at)
  where github_committed = false and dedup_hold is null;
