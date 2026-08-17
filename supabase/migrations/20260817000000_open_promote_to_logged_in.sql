-- Open promotion to any logged-in user.
--
-- Promoting rescues an archived work back into search. Gating it on trusted
-- status made the Bluegrass Dungeon a read-only curiosity for almost everyone:
-- the people most likely to notice a missing standard are the ones playing it,
-- not the handful with the trusted flag.
--
-- A new migration rather than an edit to 20260814000000_promote_songs.sql —
-- that one may already be applied, and rewriting applied migrations is how you
-- get environments that disagree about their own schema.
--
-- Scope of the risk: a promoted work is one the corpus already holds, so the
-- worst case is a noisier index, not injected content. Every row records
-- `promoted_by`, and `unpromote_song` reverses it.

-- Anyone signed in may promote.
drop policy if exists "Trusted users can insert" on promoted_songs;
create policy "Logged-in users can promote" on promoted_songs
  for insert with check (auth.uid() is not null);

-- Undo stays narrower than promote, deliberately. If anyone could remove
-- anyone's promotion, two users disagreeing about a song would flip it back
-- and forth and each rebuild would ship a different index. You can undo your
-- own; trusted users can undo any.
drop policy if exists "Trusted users can delete" on promoted_songs;
create policy "Promoter or trusted can unpromote" on promoted_songs
  for delete using (promoted_by = auth.uid() or is_trusted_user());

create or replace function promote_song(p_song_id text, p_reason text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return json_build_object('error', 'Sign in to promote songs');
  end if;

  insert into promoted_songs (song_id, promoted_by, reason)
  values (p_song_id, auth.uid(), p_reason)
  on conflict (song_id) do update set
    promoted_at = now(),
    promoted_by = auth.uid(),
    reason = coalesce(excluded.reason, promoted_songs.reason);

  return json_build_object('success', true, 'song_id', p_song_id);
end;
$$;

create or replace function unpromote_song(p_song_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return json_build_object('error', 'Sign in to undo a promotion');
  end if;

  select promoted_by into v_owner from promoted_songs where song_id = p_song_id;
  if v_owner is null and not found then
    return json_build_object('success', true, 'song_id', p_song_id);
  end if;

  -- security definer bypasses RLS, so the ownership rule is enforced here too.
  if v_owner is distinct from auth.uid() and not is_trusted_user() then
    return json_build_object('error', 'Only the promoter can undo this');
  end if;

  delete from promoted_songs where song_id = p_song_id;

  return json_build_object('success', true, 'song_id', p_song_id);
end;
$$;

grant execute on function promote_song(text, text) to authenticated;
grant execute on function unpromote_song(text) to authenticated;
