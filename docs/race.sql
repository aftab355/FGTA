-- ============================================================
-- tier — the optional FGTA leaderboard tier on an event.
--
-- THIS MIGRATION IS OPTIONAL. Without it raceTier() reads the
-- event's format and name:
--
--   name contains "FF Cup"   TS 800   800 / 320
--   format = 'roundrobin'    TS 400   400 / 160
--   anything else            TS 500   500 / 200   (knockout, hybrid, Robin+)
--
-- That covers the season as planned — fortnightly round robins,
-- the odd bracket, the FF Cup — with no setup at all. Run this
-- only when an event's format says the wrong thing about it: a
-- knockout that should only be worth a 400, or a renamed cup.
-- Then set the column on that one row; 400, 500 and 800 are the
-- only values the race reads, and anything else falls back to
-- the format.
-- The tiers were 250 / 300 / 500 before a win went from 30 to 50
-- points; re-running this file moves the check to the new values
-- (clear any row still holding an old one first).
-- ============================================================
alter table public.tournaments add column if not exists tier smallint;

alter table public.tournaments drop constraint if exists tournaments_tier_check;
alter table public.tournaments add constraint tournaments_tier_check
  check (tier is null or tier in (400, 500, 800));

-- e.g.  update public.tournaments set tier = 400 where id = 7;
