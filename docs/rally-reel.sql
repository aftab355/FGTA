-- ============================================================
-- Rally reel — the one column the feature needs.
--
-- The point tracker already knows when every point ended: the ref
-- taps a button, and that tap is a timestamp. The rally reel keeps
-- those stamps so a match can later be cut down to just the tennis,
-- with no computer vision involved and nothing to upload — see the
-- RALLY REEL section in index.html and docs/rally-reel.md.
--
-- One column on `matches`, holding one JSON document per tracked
-- match:
--
--   {
--     "v": 1,
--     "a": "Alice", "b": "Bob",          -- as the tracker had them
--     "startedAt": 1755000000000,        -- epoch ms, first ball
--     "endedAt":   1755006000000,
--     "video": {                         -- null until a stream is linked
--       "id":    "dQw4w9WgXcQ",          -- YouTube video id
--       "start": 1754999910000,          -- epoch ms of that video's 0:00
--       "drift": 0                       -- manual nudge, seconds
--     },
--     "points": [
--       { "t": 41200,                    -- ms since startedAt, when the ref tapped
--         "w": "a",                      -- who won it
--         "s": 1, "g": 3,                -- set, and game number across the match
--         "b": "30-15",                  -- score as the ball was served
--         "ace": 1, "gp": 1, "mp": 1,    -- optional flags: ace, game point, match point
--         "tb": 1,                       -- played in a tiebreak
--         "gw": "a", "sw": "a", "mw": "a"  -- this point closed a game / set / the match
--       }
--     ]
--   }
--
-- Everything the reel shows is derived from that at render time —
-- the segment boundaries, the filters, the ffmpeg script, the
-- YouTube chapter list. Nothing is precomputed and stored, so
-- retuning the cut months later just re-derives it.
--
-- Run this once against the project's Postgres (Supabase SQL editor
-- or psql). It is idempotent.
-- ============================================================

alter table public.matches
  add column if not exists rallies text;

comment on column public.matches.rallies is
  'Rally reel timing as JSON: {v, a, b, startedAt, endedAt, video{id,start,drift}, points[{t,w,s,g,b,...}]}. Null for matches not scored point-by-point.';

-- Attaching a video to an old match, or saving a corrected sync
-- offset, is an UPDATE of this column from the app. Whoever may
-- already update a match may update it; no new policy is needed if
-- `matches` has an admin update policy. If it does not, the reel
-- still plays for the person who attached the video — their change
-- just stays in their own browser session and the toast says so.


-- ------------------------------------------------------------
-- Without this migration
-- ------------------------------------------------------------
-- The app still works, and matches still submit. ptSubmit() detects
-- the missing column from the PostgREST error, drops `rallies` from
-- the row and retries — the same way it already handles `games` and
-- `umpire_rating` being absent.
--
-- What you lose is the reel: with nowhere to store the timings, no
-- match ever has any, so the "🎬 Rally reel" button never appears on
-- a match card. Nothing breaks and nothing complains; the feature is
-- simply not there. Run the column in and every match tracked from
-- that point on has one.
--
-- Matches played BEFORE this migration cannot be recovered — the
-- taps were never written down. The reel starts with the next match
-- somebody refs.
