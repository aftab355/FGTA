-- ============================================================
-- client_errors — uncaught errors from visitors' browsers.
--
-- The 🩺 diagnostics panel already records every uncaught error,
-- but only in the memory of the phone it happened on: nobody sees
-- it unless the person holding that phone opens the panel and
-- sends the report on. So a bug that only bites on somebody
-- else's phone is a bug nobody ever hears about. This table is
-- where the page sends them instead.
--
-- Insert is open to anyone (the site is public and most errors
-- happen to signed-out visitors), but the row shape is capped:
-- a message is at most 300 characters, nothing else is free text
-- longer than the page path and a short user-agent. The client
-- also caps itself at 10 distinct errors per page load.
--
-- Read and delete are admin-only — the same is_admin() the rest of
-- the app uses. It is a debugging record, not a public feed.
--
-- Run once against the project's Postgres (Supabase SQL editor).
-- It is idempotent. Not running it is supported: the page gets
-- "relation does not exist" once, stops trying for that visit,
-- and everything else works exactly as before.
--
-- Trim it by hand when it gets long:
--   delete from public.client_errors where at < now() - interval '30 days';
-- ============================================================

create table if not exists public.client_errors (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  kind     text not null,                 -- 'error' | 'rejection'
  message  text not null,
  source   text,                          -- file:line where the browser gave one
  page     text,                          -- location.pathname + hash
  ua       text,                          -- trimmed user agent
  count    int  not null default 1,       -- repeats of the same error in that page load
  constraint client_errors_kind    check (kind in ('error','rejection')),
  constraint client_errors_message check (char_length(message) <= 300),
  constraint client_errors_source  check (source is null or char_length(source) <= 200),
  constraint client_errors_page    check (page is null or char_length(page) <= 200),
  constraint client_errors_ua      check (ua is null or char_length(ua) <= 160),
  constraint client_errors_count   check (count between 1 and 1000)
);

comment on table public.client_errors is
  'Uncaught browser errors reported by the page itself. Public insert with '
  'capped row size, admin-only read/delete. See docs/client-errors.sql.';

create index if not exists client_errors_at_idx
  on public.client_errors (at desc);

alter table public.client_errors enable row level security;

drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert
  on public.client_errors for insert
  with check (true);

drop policy if exists client_errors_read on public.client_errors;
create policy client_errors_read
  on public.client_errors for select
  using (public.is_admin());

drop policy if exists client_errors_delete on public.client_errors;
create policy client_errors_delete
  on public.client_errors for delete
  using (public.is_admin());
