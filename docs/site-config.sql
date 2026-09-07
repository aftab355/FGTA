-- ============================================================
-- site_config — the one row the Admin Studio publishes to.
--
-- Everything the studio can change (colours, type, copy, which
-- sections exist and in what order, feature switches, raw CSS)
-- is one JSON document. It is deliberately ONE ROW, id = 1:
-- there is one site, the whole document is written at once, and
-- a single row means a visitor's first paint costs one indexed
-- primary-key lookup rather than a scan and a merge.
--
-- Read is public and unauthenticated, because the config IS the
-- site — a signed-out visitor has to get the published look, so
-- anon has to be able to select it. Nothing secret goes in here;
-- see the note on `css` below.
--
-- Write is admin-only, checked server-side by the same is_admin()
-- the rest of the app uses (admin-security.sql). A client that
-- lies about being an admin gets a policy violation from Postgres,
-- not a saved config: the studio's own `isAdmin` check is a UI
-- affordance, this is the actual control.
--
-- Run once against the project's Postgres (Supabase SQL editor or
-- psql). It is idempotent.
--
-- Not running it is a supported way to run the site. The app asks
-- once, gets "relation does not exist", notes it in diagnostics
-- and renders the built-in defaults — which is exactly what the
-- site looked like before this table existed. The studio then
-- says the table is missing instead of pretending a publish
-- worked. See docs/admin-studio.md.
-- ============================================================

create table if not exists public.site_config (
  id          int primary key default 1,
  config      jsonb       not null default '{}'::jsonb,
  version     int         not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text,                       -- admin email, for the audit trail
  -- there is one site. Without this the table is a bag of configs and
  -- "which one is live" becomes a question the client has to answer.
  constraint site_config_singleton check (id = 1)
);

comment on table public.site_config is
  'Single-row runtime configuration for the FGTA site: theme tokens, typography, '
  'copy overrides, layout order/visibility, feature flags and custom CSS. '
  'Public read, admin-only write. See docs/admin-studio.md.';

-- seed the row so the studio always has something to update rather than
-- having to branch between insert and update on the very first publish
insert into public.site_config (id, config, version)
values (1, '{}'::jsonb, 1)
on conflict (id) do nothing;


-- ============================================================
-- site_config_history — every publish, kept.
--
-- The studio's undo is a database row, not a browser tab. An admin
-- who publishes a palette they hate at 11pm on a phone needs to get
-- the old one back from a different device tomorrow, and a diff of
-- who changed what is the only way to answer "when did the ladder
-- page lose its chart".
--
-- Insert-only from the app's point of view: the studio writes a row
-- on every successful publish and never updates one. Reading it is
-- admin-only — it is an audit trail, and the copy overrides in it
-- can include text that was drafted and pulled.
--
-- Trimming is left to a manual delete; at one row per publish this
-- will not be a problem in this league's lifetime.
-- ============================================================

create table if not exists public.site_config_history (
  id         bigserial primary key,
  version    int         not null,
  config     jsonb       not null,
  label      text,                        -- optional note the admin typed
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists site_config_history_created_at_idx
  on public.site_config_history (created_at desc);

comment on table public.site_config_history is
  'One row per Admin Studio publish. Admin-only read; the studio restores from it.';


-- ============================================================
-- Row level security
-- ============================================================

alter table public.site_config          enable row level security;
alter table public.site_config_history  enable row level security;

-- Anyone, signed in or not, may read the live config. This is the
-- published appearance of a public website.
drop policy if exists site_config_read on public.site_config;
create policy site_config_read
  on public.site_config for select
  using (true);

-- Only an admin may change it. Split into insert/update rather than
-- `for all` so a delete is impossible from the API at all — the row
-- is a singleton and deleting it would take the site's config with it.
drop policy if exists site_config_insert on public.site_config;
create policy site_config_insert
  on public.site_config for insert
  with check (public.is_admin());

drop policy if exists site_config_update on public.site_config;
create policy site_config_update
  on public.site_config for update
  using (public.is_admin())
  with check (public.is_admin());

-- History: admin-only in both directions.
drop policy if exists site_config_history_read on public.site_config_history;
create policy site_config_history_read
  on public.site_config_history for select
  using (public.is_admin());

drop policy if exists site_config_history_insert on public.site_config_history;
create policy site_config_history_insert
  on public.site_config_history for insert
  with check (public.is_admin());

drop policy if exists site_config_history_delete on public.site_config_history;
create policy site_config_history_delete
  on public.site_config_history for delete
  using (public.is_admin());


-- ============================================================
-- Realtime
--
-- Two admins on two devices, or an admin publishing while the league
-- has the site open on a phone at the court: the new look should
-- arrive without a reload. Adding the table to the realtime
-- publication is what makes the app's subscription in
-- SITE.subscribe() fire.
--
-- Guarded because adding a table twice is an error, and this file is
-- meant to be re-runnable.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'site_config'
  ) then
    alter publication supabase_realtime add table public.site_config;
  end if;
end $$;


-- ============================================================
-- publish_site_config() — write the config and its history entry
-- in one statement.
--
-- Doing this from the client as two calls has a real failure mode:
-- the config lands, the history insert fails, and the version an
-- admin wants to roll back to was never recorded. A function runs
-- both inside one transaction, so either the publish is complete
-- and revertable or it did not happen.
--
-- It also owns the version number. Two admins publishing within the
-- same second from client-computed versions would both write
-- version N; here the increment is read-modify-write inside the
-- transaction and the row lock makes it correct.
--
-- SECURITY INVOKER (the default) on purpose: the RLS policies above
-- still apply, so this is a convenience, never a privilege
-- escalation. A non-admin calling it gets the same policy violation
-- they would get writing the table directly.
-- ============================================================

create or replace function public.publish_site_config(
  new_config jsonb,
  note       text default null
) returns int
language plpgsql
as $$
declare
  next_version int;
  actor        text;
begin
  if not public.is_admin() then
    raise exception 'not authorised to publish site config';
  end if;

  actor := coalesce(auth.jwt() ->> 'email', 'unknown');

  update public.site_config
     set config     = new_config,
         version    = version + 1,
         updated_at = now(),
         updated_by = actor
   where id = 1
  returning version into next_version;

  -- the seed insert above should make this unreachable; it is here so a
  -- project whose row was deleted by hand recovers instead of silently
  -- publishing nothing
  if next_version is null then
    insert into public.site_config (id, config, version, updated_by)
    values (1, new_config, 1, actor)
    returning version into next_version;
  end if;

  insert into public.site_config_history (version, config, label, created_by)
  values (next_version, new_config, note, actor);

  return next_version;
end;
$$;

comment on function public.publish_site_config(jsonb, text) is
  'Admin-only. Replaces the live site config, bumps its version and records the '
  'publish in site_config_history — all in one transaction.';

grant execute on function public.publish_site_config(jsonb, text) to authenticated;
