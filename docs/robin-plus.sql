-- ============================================================
-- Robin+ — the one column the format needs.
--
-- Robin+ stores a tournament's field and its generated draw (the
-- group shape, the ring order and the order of play) as JSON on the
-- tournament row. Results themselves are ordinary `matches` rows,
-- tagged with tournament_id and a round key, exactly like every
-- other format:
--
--   grp1..grpN   group games
--   qual1..qualN qualification deciders
--   semi1 semi2 final bronze   the knockout
--
-- Everything else — standings, the cut, who has to play a decider,
-- the bracket, the champion — is derived from those rows at render
-- time, so editing a result months later re-resolves the whole
-- event correctly.
--
-- The group has two shapes and the size of the field picks between
-- them, so the number of grpN rounds is not fixed:
--
--   shape:"ring"  5+ players, each plays their two neighbours.
--                 N players -> grp1..grpN. Top 4 qualify.
--   shape:"drr"   exactly 4, everyone plays everyone twice.
--                 grp1..grp12, six games each, nobody is cut — the
--                 table seeds the bracket instead.
--
-- State written before the four-player format existed has no
-- `shape` key; the app reads a missing shape as "ring", which is
-- what those events were.
--
-- Run this once against the project's Postgres (Supabase SQL editor
-- or psql). It is idempotent.
-- ============================================================

alter table public.tournaments
  add column if not exists bracket text;

comment on column public.tournaments.bracket is
  'Robin+ event state as JSON: {v, roster[], shape, cycle[], order[{p1,p2,round,leg}], metrics, seed, bronze, createdAt}. shape is "ring" (5+ players, two games each) or "drr" (exactly 4, everyone twice); absent means "ring". Null for every other format.';

-- Whoever may already update a tournament may update this column;
-- no new policy is needed if tournaments already has an admin
-- update policy. If it does not, the app falls back to localStorage
-- and tells the admin so in the UI.


-- ------------------------------------------------------------
-- Without this migration
-- ------------------------------------------------------------
-- The app still works. rpWrite() detects the missing column
-- (PGRST204 / 42703), mirrors the draw to localStorage instead, and
-- shows a warning in the event panel. The catch is that the draw
-- then lives on the admin's browser only — everyone else sees the
-- event stuck at the roster step, because there is nowhere shared
-- to read the pairings from. Results are unaffected either way:
-- they are always real `matches` rows.
