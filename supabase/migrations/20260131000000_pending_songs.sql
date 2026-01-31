-- Pending Songs: Instant edits for trusted users
-- Songs are stored here for instant visibility, then auto-committed to GitHub

-- Trusted users (simple list, can evolve later)
create table trusted_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- RLS: only service role can manage trusted users, but users can check own membership
alter table trusted_users enable row level security;
create policy "Service role only" on trusted_users for all using (false);
create policy "Users can check own membership" on trusted_users for select using (user_id = auth.uid());

-- Pending songs (additions and corrections)
create table pending_songs (
  id text primary key,                    -- slug (matches works/ structure)
  replaces_id text,                       -- null = new song, set = correction
  title text not null,
  artist text,
  composer text,
  content text not null,                  -- full ChordPro
  key text,                               -- detected key
  mode text,                              -- major/minor
  tags jsonb default '{}',                -- tag object
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  github_committed boolean default false  -- tracks if commit was sent
);

-- RLS: anyone can read, trusted users can write
alter table pending_songs enable row level security;

create policy "Anyone can read pending songs"
  on pending_songs for select using (true);

create policy "Trusted users can insert"
  on pending_songs for insert
  with check (auth.uid() in (select user_id from trusted_users));

create policy "Trusted users can update own"
  on pending_songs for update
  using (created_by = auth.uid() and auth.uid() in (select user_id from trusted_users));

create policy "Trusted users can delete own"
  on pending_songs for delete
  using (created_by = auth.uid() and auth.uid() in (select user_id from trusted_users));

-- Function to check if current user is trusted
create or replace function is_trusted_user()
returns boolean as $$
  select exists (
    select 1 from trusted_users where user_id = auth.uid()
  );
$$ language sql security definer stable;

-- Grant execute to authenticated users
grant execute on function is_trusted_user() to authenticated;

-- Index for faster lookups when merging pending with static
create index idx_pending_songs_replaces on pending_songs(replaces_id) where replaces_id is not null;
create index idx_pending_songs_committed on pending_songs(github_committed) where github_committed = false;
