-- Phase 2b: additive contributions are instant for ANY logged-in user.
--
-- pending_songs was built as a trusted-user perk: only members of
-- trusted_users could insert or update, so everyone else was routed to the
-- GitHub-issue review queue and waited hours. Under the new contract
-- (docs/plans/contribution-pipeline.md, "The contract") the Live overlay is
-- the delivery mechanism for EVERY contribution, and trust decides only
-- whether an in-place edit is allowed — not how fast a submission appears.
--
-- What changes here:
--   1. `created_by` defaults to auth.uid(), so a row can never be inserted
--      without an owner even if a client forgets the field.
--   2. Insert is open to any authenticated user, for rows they own.
--   3. Update stays owner-or-trusted. This is the RLS half of "hard to
--      destroy": user B cannot overwrite user A's in-flight row. B's edit of
--      A's content goes through the fork classification in auto-commit-song
--      instead, and lands as a new arrangement in works/.
--   4. Select stays world-readable — the overlay is public data.
--   5. Size caps as CHECK constraints. Opening the write path to everyone
--      means the row size is now attacker-controlled; 200KB of ChordPro is
--      ~4x the largest chart in the corpus, so the bound is generous and
--      still bounds the blast radius. Per-user rate limiting is the other
--      half of this rail and lives in the edge function (durable, counted
--      from submission_log).
--
-- NOT APPLIED by this branch — apply with the rest of the phase.

-- ============================================
-- 1. Ownership
-- ============================================

alter table pending_songs alter column created_by set default auth.uid();

-- ============================================
-- 2/3/4. Policies
-- ============================================

drop policy if exists "Trusted users can insert" on pending_songs;
drop policy if exists "Trusted users can update any" on pending_songs;
drop policy if exists "Trusted users can delete own" on pending_songs;

-- Any signed-in user may add a row, but only as themselves. `created_by`
-- defaults to auth.uid(), so a client that omits it still satisfies this.
create policy "Authenticated users can insert own"
  on pending_songs for insert to authenticated
  with check (created_by = auth.uid());

-- In-place edit rights: the row's own author, or a trusted user. A trusted
-- user editing someone else's row leaves created_by alone (the WITH CHECK
-- allows either), so attribution never silently transfers.
create policy "Owners and trusted users can update"
  on pending_songs for update to authenticated
  using (created_by = auth.uid() or is_trusted_user())
  with check (created_by = auth.uid() or is_trusted_user());

create policy "Owners and trusted users can delete"
  on pending_songs for delete to authenticated
  using (created_by = auth.uid() or is_trusted_user());

-- "Anyone can read pending songs" (select using true) is unchanged.

-- ============================================
-- 5. Size caps
-- ============================================

-- Constraints have no IF NOT EXISTS, so guard each one for re-runs.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_content_size') then
    alter table pending_songs
      add constraint pending_songs_content_size
      check (content is null or octet_length(content) <= 204800);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pending_songs_id_len') then
    alter table pending_songs
      add constraint pending_songs_id_len
      check (char_length(id) <= 200);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pending_songs_replaces_len') then
    alter table pending_songs
      add constraint pending_songs_replaces_len
      check (replaces_id is null or char_length(replaces_id) <= 200);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pending_songs_title_len') then
    alter table pending_songs
      add constraint pending_songs_title_len
      check (char_length(title) <= 300);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pending_songs_artist_len') then
    alter table pending_songs
      add constraint pending_songs_artist_len
      check (artist is null or char_length(artist) <= 200);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pending_songs_composer_len') then
    alter table pending_songs
      add constraint pending_songs_composer_len
      check (composer is null or char_length(composer) <= 300);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pending_songs_notes_len') then
    alter table pending_songs
      add constraint pending_songs_notes_len
      check (notes is null or char_length(notes) <= 5000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pending_songs_tags_size') then
    alter table pending_songs
      add constraint pending_songs_tags_size
      check (tags is null or octet_length(tags::text) <= 8192);
  end if;
end
$$;

-- Rate limiting reads submission_log; make the (user, time) lookup cheap.
create index if not exists idx_submission_log_user_created
  on submission_log(user_id, created_at desc);
