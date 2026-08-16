-- NOT YET APPLIED. Phase 2d of docs/plans/contribution-pipeline.md.
--
-- The reviewed residue. Additive contributions go live instantly (2b/2c); what
-- is left is the small set of DESTRUCTIVE asks, which stay reviewed:
--
--   delete          soft-delete a work (deleted_songs / delete_song())
--   suppress        drop a work from the index via curation/registry.yaml
--   merge-redirect  fold a duplicate into another work and redirect its URL
--
-- Trusted users may REQUEST these. Only admins may act on the request; admins
-- keep their existing instant path (they are the reviewers, so queueing them
-- would just be a round trip).
--
-- Approving a `delete` is executed by the app (delete_song RPC). Approving a
-- `suppress` or `merge-redirect` only RECORDS the decision: both edit files in
-- the repo, and nothing in CI is wired to do that from a table. The UI prints
-- the local command to run and says so plainly rather than pretending.

create table if not exists review_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('delete', 'suppress', 'merge-redirect')),
  target_id text not null,
  -- kind-specific extras, e.g. {"redirect_to": "blue-moon-of-kentucky"}
  payload jsonb not null default '{}'::jsonb,
  reason text,
  requested_by uuid not null references auth.users(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_review_requests_status
  on review_requests (status, created_at desc);
create index if not exists idx_review_requests_target
  on review_requests (target_id);

alter table review_requests enable row level security;

-- Trusted users file requests, and only as themselves. Not "anyone logged in":
-- a destructive ask costs a reviewer's attention, so it carries the same trust
-- bar as promote.
create policy "Trusted users can request" on review_requests
  for insert with check (is_trusted_user() and requested_by = auth.uid());

-- The requester can follow their own request; trusted users see the whole
-- queue (that is what makes it a queue rather than a private inbox).
create policy "Requester and trusted users can read" on review_requests
  for select using (requested_by = auth.uid() or is_trusted_user());

-- Only admins decide. Deliberately narrower than the insert policy: a trusted
-- user may ask, and may watch, but may not approve — including their own ask.
create policy "Admins can review" on review_requests
  for update using (is_admin()) with check (is_admin());

-- No delete policy: nobody removes rows. The queue is the audit trail of what
-- was asked for and what was decided.

-- Stamp the reviewer from the session rather than trusting the client, and
-- keep the immutable fields immutable on the review update.
create or replace function stamp_review_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by = auth.uid();
    new.reviewed_at = now();
  end if;
  new.kind = old.kind;
  new.target_id = old.target_id;
  new.payload = old.payload;
  new.requested_by = old.requested_by;
  new.created_at = old.created_at;
  return new;
end;
$$;

drop trigger if exists trg_stamp_review_request on review_requests;
create trigger trg_stamp_review_request
  before update on review_requests
  for each row execute function stamp_review_request();
