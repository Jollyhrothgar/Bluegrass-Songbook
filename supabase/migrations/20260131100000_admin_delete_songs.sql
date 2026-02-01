-- Admin users and soft-deleted songs

-- Admin users table (separate from trusted_users for clarity)
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- RLS: only service role can manage admin users, but users can check own membership
alter table admin_users enable row level security;
create policy "Service role only" on admin_users for all using (false);
create policy "Users can check own membership" on admin_users for select using (user_id = auth.uid());

-- Function to check if current user is admin
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from admin_users where user_id = auth.uid())
$$;

-- Grant execute to authenticated users
grant execute on function is_admin() to authenticated;

-- Deleted songs table (soft delete)
create table if not exists deleted_songs (
  song_id text primary key,
  deleted_at timestamptz default now(),
  deleted_by uuid references auth.users(id),
  reason text
);

-- RLS: only admins can insert/update/delete, anyone can read (for build process)
alter table deleted_songs enable row level security;

create policy "Anyone can read deleted songs" on deleted_songs
  for select using (true);

create policy "Admins can insert" on deleted_songs
  for insert with check (is_admin());

create policy "Admins can delete" on deleted_songs
  for delete using (is_admin());

-- Function to mark a song as deleted
create or replace function delete_song(p_song_id text, p_reason text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Check if user is admin
  if not is_admin() then
    return json_build_object('error', 'Not authorized');
  end if;

  -- Insert into deleted_songs (or update if already exists)
  insert into deleted_songs (song_id, deleted_by, reason)
  values (p_song_id, auth.uid(), p_reason)
  on conflict (song_id) do update set
    deleted_at = now(),
    deleted_by = auth.uid(),
    reason = coalesce(excluded.reason, deleted_songs.reason);

  return json_build_object('success', true, 'song_id', p_song_id);
end;
$$;

-- Function to undelete a song
create or replace function undelete_song(p_song_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Check if user is admin
  if not is_admin() then
    return json_build_object('error', 'Not authorized');
  end if;

  -- Remove from deleted_songs
  delete from deleted_songs where song_id = p_song_id;

  return json_build_object('success', true, 'song_id', p_song_id);
end;
$$;

-- Grant execute to authenticated users
grant execute on function delete_song(text, text) to authenticated;
grant execute on function undelete_song(text) to authenticated;
