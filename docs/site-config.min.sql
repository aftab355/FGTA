-- ============================================================
-- site-config.min.sql — the same migration as site-config.sql
-- with the explanation stripped out, for pasting.
--
-- Use this one when you are copying into the Supabase SQL editor
-- from a phone, or when you just want the statements. Read
-- site-config.sql for WHY any of it is shaped the way it is; the
-- reasoning lives there and only there.
--
-- PASTE THIS FILE ON ITS OWN. Supabase runs an editor tab as one
-- transaction, so one error anywhere — including a harmless
-- "already exists" from an unrelated script pasted above it —
-- rolls back everything after it, and you are left with none of
-- these tables and no obvious sign why.
--
-- It needs public.is_admin() to already exist (admin-security.sql).
-- Every statement is guarded, so running it twice is safe.
--
-- Generated from site-config.sql; test/site-config-sql.test.js
-- fails if the two drift apart.
-- ============================================================

create table if not exists public.site_config (
  id          int primary key default 1,
  config      jsonb       not null default '{}'::jsonb,
  version     int         not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text,                       -- admin email, for the audit trail
  constraint site_config_singleton check (id = 1)
);

comment on table public.site_config is
  'Single-row runtime configuration for the FGTA site: theme tokens, typography, '
  'copy overrides, layout order/visibility, feature flags and custom CSS. '
  'Public read, admin-only write. See docs/admin-studio.md.';

insert into public.site_config (id, config, version)
values (1, '{}'::jsonb, 1)
on conflict (id) do nothing;

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

alter table public.site_config          enable row level security;
alter table public.site_config_history  enable row level security;

drop policy if exists site_config_read on public.site_config;
create policy site_config_read
  on public.site_config for select
  using (true);

drop policy if exists site_config_insert on public.site_config;
create policy site_config_insert
  on public.site_config for insert
  with check (public.is_admin());

drop policy if exists site_config_update on public.site_config;
create policy site_config_update
  on public.site_config for update
  using (public.is_admin())
  with check (public.is_admin());

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
