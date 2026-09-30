-- TEST-HARNESS ONLY. Never applied to production (it lives under
-- supabase/tests/, not supabase/migrations/).
--
-- Why this exists: a few objects the migration chain depends on were created by
-- hand in the Supabase dashboard and have no CREATE in supabase/migrations/ --
-- user_lists, user_list_items, song_flags, and the functions submit_flag() and
-- get_visitor_flag_count(). `supabase db reset` therefore dies on
-- 20251231110000_public_lists.sql ("relation user_lists does not exist").
-- This file recreates the minimum shape of those objects, at a version older
-- than every real migration, so the real chain can be replayed from zero in a
-- throwaway local stack (see supabase/tests/README.md).
--
-- It is a RECONSTRUCTION from how the client and the later migrations use the
-- objects, not a dump of production. The list tables start out the way they
-- were before 20251231110000: RLS on, owner-only.

create table public.user_lists (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    name        text not null,
    position    integer not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (user_id, name)
);
alter table public.user_lists enable row level security;
create policy "Users can view own lists" on public.user_lists
    for select using (auth.uid() = user_id);

create table public.user_list_items (
    id          uuid primary key default gen_random_uuid(),
    list_id     uuid not null references public.user_lists(id) on delete cascade,
    song_id     text not null,
    position    integer not null default 0,
    created_at  timestamptz not null default now(),
    unique (list_id, song_id)
);
alter table public.user_list_items enable row level security;
create policy "Users can view own list items" on public.user_list_items
    for select using (exists (
        select 1 from public.user_lists l
         where l.id = list_id and l.user_id = auth.uid()));

create table public.song_flags (
    id          uuid primary key default gen_random_uuid(),
    song_id     text not null,
    status      text not null default 'open',
    created_at  timestamptz not null default now()
);
alter table public.song_flags enable row level security;

-- Bodies are placeholders: the real ones live only in production, which is
-- exactly why supabase/tests/post_deploy_check.sql prints them.
create function public.submit_flag(p_song_id text)
returns void language sql security definer as $$
    insert into public.song_flags (song_id) values (p_song_id);
$$;

create function public.get_visitor_flag_count(p_visitor_id text)
returns integer language sql security definer as $$
    select 0;
$$;
