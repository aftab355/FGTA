-- ============================================================
-- counts_stats — the optional second switch on an event.
--
-- An event has always carried counts_elo: does what happens here
-- move the ladder? The FF Cup answers no, and for a long time
-- that single flag was doing a second job nobody asked it to do
-- — a game that did not move the ladder was dropped from every
-- stat and every model as well, so three weeks of the year's
-- best-attended tennis produced no form, no streaks, no
-- head-to-head, no rivalries, nothing in the records and no data
-- for any of the predictive models.
--
-- The app now asks the two questions separately:
--
--   counts_elo    does this move the ladder?         (existing)
--   counts_stats  did this happen, for everything    (this file)
--                 that describes or predicts?
--
-- The default is the interesting part: THIS MIGRATION IS
-- OPTIONAL. countsForAnalysis() reads a missing or null column as
-- true, so without running anything at all every event — the cup
-- included — counts toward stats and models while its counts_elo
-- flag still decides the ladder. That is the behaviour you want
-- almost always.
--
-- Run this only when you have an event that genuinely should not
-- be described either: a handicap night, a joke format, a bracket
-- you filled with test rows. Then set counts_stats = false on
-- that one event and it disappears from the analytics the same
-- way it always disappeared from the ladder.
--
-- Idempotent; run it in the Supabase SQL editor or psql.
-- ============================================================

alter table public.tournaments
  add column if not exists counts_stats boolean not null default true;

comment on column public.tournaments.counts_stats is
  'Do this event''s games count toward stats, records, rivalries and the predictive models? Independent of counts_elo, which only governs the ladder. Default true; set false for an event that should not be described at all (handicap formats, joke events, test data). A missing column reads as true.';

-- ------------------------------------------------------------
-- Setting it on one event
-- ------------------------------------------------------------
--   update public.tournaments set counts_stats = false where id = <id>;
--
-- Nothing else changes: the games stay ordinary `matches` rows and
-- the event page still renders. They simply stop appearing in the
-- analytics, exactly as an Elo-exempt event stops appearing in the
-- ladder.
