-- ============================================================
-- The stream log — the league's own record that a broadcast existed.
--
-- YouTube keeps the video. This keeps the knowledge of it, which
-- turned out to be the fragile half:
--
--   · /api/youtube can only see the most recent couple of dozen
--     uploads on one public channel, so an older match drops off
--     "past broadcasts" while the recording itself sits on YouTube
--     untouched, findable by nobody;
--   · an unlisted stream is never in that listing at all;
--   · and a missing API key or a spent quota takes the whole
--     listing down at once.
--
-- So every app that sees a stream — the host's phone, and every
-- viewer's — writes a row here. No video data, nothing to upload:
-- an id, what it was called, when it started, when it stopped.
-- "Past broadcasts" then reads YouTube and this table and merges
-- them, YouTube's copy winning wherever both know a video.
--
-- Run this once against the project's Postgres (Supabase SQL
-- editor or psql). It is idempotent.
--
-- Not running it is a supported way to run the site: the app tries
-- once, notes in its diagnostics that there is no stream_log on
-- this project, and carries on with the shorter memory. Nothing
-- else changes. See docs/youtube-live.md.
-- ============================================================

create table if not exists public.stream_log (
  video_id   text primary key,          -- the 11-character YouTube id
  title      text,                      -- as YouTube had it when we saw it
  code       text,                      -- the FGTA session code, if one was carrying the score
  started_at timestamptz,               -- liveStreamingDetails.actualStartTime
  ended_at   timestamptz,               -- set when the broadcast finishes; null while it is on
  thumb      text,
  seen_at    timestamptz default now()  -- last time any app confirmed this stream
);

comment on table public.stream_log is
  'Every broadcast the app has seen, so past matches stay findable after YouTube stops listing them. Written by any client that sees a stream live; read by the Point Tracker''s "past broadcasts".';

create index if not exists stream_log_started_idx
  on public.stream_log (started_at desc);

-- ------------------------------------------------------------
-- Policies
-- ------------------------------------------------------------
-- Anyone using the site may add to it and read it back. There is
-- nothing private in a row — the same video ids are already public
-- on the channel — and requiring an admin would defeat the point:
-- the record has to be written by whoever happens to have the app
-- open while a match is on, which is usually not an admin.
--
-- Deletes and hard edits are deliberately not granted. A row is
-- only ever written by the app, and rewriting one after the fact
-- is not something the app does.
alter table public.stream_log enable row level security;

drop policy if exists stream_log_read on public.stream_log;
create policy stream_log_read on public.stream_log
  for select using (true);

drop policy if exists stream_log_insert on public.stream_log;
create policy stream_log_insert on public.stream_log
  for insert with check (true);

-- The app upserts (on conflict video_id), so an update has to be
-- allowed too — that is how a broadcast gets its ended_at, and how
-- a stream first seen by a viewer later gains the session code.
drop policy if exists stream_log_update on public.stream_log;
create policy stream_log_update on public.stream_log
  for update using (true) with check (true);

-- ------------------------------------------------------------
-- Without this migration
-- ------------------------------------------------------------
-- "Past broadcasts" shows exactly what it showed before: whatever
-- /api/youtube still lists, which is the last dozen finished
-- streams on the configured public channel. Live discovery, the
-- live strip, auto-linking and everything else are unaffected —
-- none of them read this table.
