-- ============================================================
-- Fall Exhibition — admin-editable end date for the parallel
-- "net Elo gained since Sept 13" leaderboard.
--
-- This is the ONLY schema change the feature needs. The baseline
-- rating each player carries into the fall window is never stored:
-- it's recomputed on every render by replaying the real match log
-- up to the Sept 14 boundary through the same Elo engine the main
-- ladder uses (see computeFallExhibition() in index.html) — same
-- pattern the app already uses for computeStandings() and the
-- Risers & Fallers trailing window. Nothing to migrate for that part.
--
-- What DOES need somewhere to live is the end date, because it has
-- to be the same for every visitor, not a per-browser localStorage
-- value (that's how the admin Divisor toggle works, and it's the
-- wrong pattern here). One row, one column.
--
-- Write is admin-only, checked server-side by the same is_admin()
-- the rest of the app uses (admin-security.sql). A client that lies
-- about being an admin gets a policy violation from Postgres, not a
-- saved date.
--
-- Idempotent; run it in the Supabase SQL editor or psql.
-- ============================================================

create table if not exists public.fall_exhibition (
  id         int primary key default 1,
  end_date   date not null default '2026-11-30',
  updated_at timestamptz not null default now(),
  constraint fall_exhibition_singleton check (id = 1)
);

comment on table public.fall_exhibition is
  'Single-row config: when the Fall Exhibition leaderboard stops counting new games. Everything else about the event (start date, baseline, standings) is computed live from the matches table and never stored.';

alter table public.fall_exhibition enable row level security;

drop policy if exists fall_exhibition_read on public.fall_exhibition;
create policy fall_exhibition_read
  on public.fall_exhibition for select
  using (true);

drop policy if exists fall_exhibition_insert on public.fall_exhibition;
create policy fall_exhibition_insert
  on public.fall_exhibition for insert
  with check (public.is_admin());

drop policy if exists fall_exhibition_update on public.fall_exhibition;
create policy fall_exhibition_update
  on public.fall_exhibition for update
  using (public.is_admin())
  with check (public.is_admin());

insert into public.fall_exhibition (id, end_date)
values (1, '2026-11-30')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Changing the end date by hand, if you'd rather not use the admin panel
-- ------------------------------------------------------------
--   update public.fall_exhibition set end_date = '2026-12-15', updated_at = now() where id = 1;
