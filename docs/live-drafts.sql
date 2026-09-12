-- ============================================================
-- match_drafts — a running backup of whatever the Point Tracker is
-- doing, on ANY device, written on every point.
--
-- The tracker's own safety net is local: every point is saved to
-- the phone tracking it (localStorage), and Submit game files the
-- real result. Both of those live on exactly one device. If that
-- phone is lost, dies, or the ref simply forgets to press Submit
-- after a match that clearly finished, there was — until this —
-- nothing anywhere else that knew the match had even happened.
--
-- This is the same PT object the tracker already keeps (score,
-- sets, games, every rally with its timestamp — see rally-reel.sql
-- for the shape of it), pushed to the server on every point instead
-- of only at the end. Nobody watches it live; it's a break-glass
-- table an admin opens only when something's gone wrong.
--
-- Read is admin-only, on purpose — this is somebody's match still
-- in progress, and a page anyone can load should not be able to
-- watch it in real time behind the ref's back. Write is open to
-- match how the tracker itself already works: reporting a match at
-- all needs no special privilege, only approving one does.
--
-- Run once against the project's Postgres (Supabase SQL editor or
-- psql). It is idempotent. Skipping it is a supported way to run
-- the site — the app's backup write already treats a missing table
-- as "nothing to do here" the same way every optional column does
-- elsewhere (see docs/rally-reel.sql) — matches still submit
-- normally either way. See docs/live-drafts.md.
-- ============================================================

create table if not exists public.match_drafts (
  id         text primary key,             -- client-generated, one per tracking session
  p1         text not null,
  p2         text not null,
  status     text not null default 'live', -- 'live' | 'ended' (has a winner/draw, not yet submitted)
  pt         jsonb not null,               -- the tracker's own PT object, whole
  updated_at timestamptz not null default now()
);

comment on table public.match_drafts is
  'Running backup of an in-progress Point Tracker match, overwritten on every '
  'point and deleted once the match is actually submitted or abandoned. '
  'Admin-only read — a recovery net, not a spectator feed. See docs/live-drafts.md.';

create index if not exists match_drafts_updated_at_idx
  on public.match_drafts (updated_at desc);


-- ============================================================
-- Row level security
-- ============================================================

alter table public.match_drafts enable row level security;

-- Anyone tracking a match may write its backup — the same trust level as
-- submitting the match itself, which needs no special role either.
drop policy if exists match_drafts_insert on public.match_drafts;
create policy match_drafts_insert
  on public.match_drafts for insert
  with check (true);

drop policy if exists match_drafts_update on public.match_drafts;
create policy match_drafts_update
  on public.match_drafts for update
  using (true)
  with check (true);

-- Only an admin may read the list — this is the one that actually matters:
-- nobody but an admin can see a match in progress before it's filed.
drop policy if exists match_drafts_read on public.match_drafts;
create policy match_drafts_read
  on public.match_drafts for select
  using (public.is_admin());

-- Delete is open, same as insert/update: the app clears its OWN backup the
-- instant the real match is submitted or abandoned, from whatever device was
-- tracking it — usually not an admin's. The id is an unguessable client-
-- generated one, the same trust boundary the session code already runs on
-- elsewhere in this app (see docs/youtube-live.md) — not a password, just
-- not something a stranger can stumble onto.
drop policy if exists match_drafts_delete on public.match_drafts;
create policy match_drafts_delete
  on public.match_drafts for delete
  using (true);


-- ============================================================
-- Realtime — an admin who has the recovery panel open sees a match
-- appear/update/clear without refreshing, the same as site_config.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'match_drafts'
  ) then
    alter publication supabase_realtime add table public.match_drafts;
  end if;
end $$;
