-- Promoted songs: trusted users rescue archived works into the main index
-- (the inverse of deleted_songs). The hourly sync workflow materializes this
-- table into docs/data/promoted_songs.json, which the index build unions with
-- curation/registry.yaml's keep list.

create table if not exists promoted_songs (
  song_id text primary key,
  promoted_at timestamptz default now(),
  promoted_by uuid references auth.users(id),
  reason text
);

-- RLS: trusted users can insert/delete, anyone can read (for build process)
alter table promoted_songs enable row level security;

create policy "Anyone can read promoted songs" on promoted_songs
  for select using (true);

create policy "Trusted users can insert" on promoted_songs
  for insert with check (is_trusted_user());

create policy "Trusted users can delete" on promoted_songs
  for delete using (is_trusted_user());

-- Function to promote a song into the main index
create or replace function promote_song(p_song_id text, p_reason text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Check if user is trusted
  if not is_trusted_user() then
    return json_build_object('error', 'Not authorized');
  end if;

  -- Insert into promoted_songs (or update if already exists)
  insert into promoted_songs (song_id, promoted_by, reason)
  values (p_song_id, auth.uid(), p_reason)
  on conflict (song_id) do update set
    promoted_at = now(),
    promoted_by = auth.uid(),
    reason = coalesce(excluded.reason, promoted_songs.reason);

  return json_build_object('success', true, 'song_id', p_song_id);
end;
$$;

-- Function to undo a promotion
create or replace function unpromote_song(p_song_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Check if user is trusted
  if not is_trusted_user() then
    return json_build_object('error', 'Not authorized');
  end if;

  -- Remove from promoted_songs
  delete from promoted_songs where song_id = p_song_id;

  return json_build_object('success', true, 'song_id', p_song_id);
end;
$$;

-- Grant execute to authenticated users
grant execute on function promote_song(text, text) to authenticated;
grant execute on function unpromote_song(text) to authenticated;
