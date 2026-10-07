-- ============================================================
-- tier — the optional TS Race tier on an event.
--
-- THIS MIGRATION IS OPTIONAL. Without it raceTier() reads the
-- event's format and name:
--
--   name contains "FF Cup"   TS 500   500 / 330
--   format = 'roundrobin'    TS 250   250 / 165
--   anything else            TS 300   300 / 200   (knockout, hybrid, Robin+)
--
-- That covers the season as planned — fortnightly round robins,
-- the odd bracket, the FF Cup — with no setup at all. Run this
-- only when an event's format says the wrong thing about it: a
-- knockout that should only be worth a 250, or a renamed cup.
-- Then set the column on that one row; 250, 300 and 500 are the
-- only values the race reads, and anything else falls back to
-- the format.
-- ============================================================
alter table public.tournaments add column if not exists tier smallint;

alter table public.tournaments drop constraint if exists tournaments_tier_check;
alter table public.tournaments add constraint tournaments_tier_check
  check (tier is null or tier in (250, 300, 500));

-- e.g.  update public.tournaments set tier = 250 where id = 7;
