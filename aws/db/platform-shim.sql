-- Amazon RDS for PostgreSQL: the few platform objects the migrations in supabase/migrations
-- expect (they were written for Supabase). Same objects as supabase/tests/shim.sql, made
-- idempotent and safe for the RDS master user (which is not a true superuser).
-- Applied once by `npm run db:migrate` before the migrations.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    begin
      create role service_role nologin noinherit bypassrls;
    exception when insufficient_privilege then
      -- RDS may refuse BYPASSRLS; the app connects as the table owner, so RLS never applies.
      create role service_role nologin noinherit;
    end;
  end if;
end;
$$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- Accounts that own posts. With Cognito only the user's `sub` is stored (lib/db/accounts.ts).
create table if not exists auth.users (id uuid primary key);

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

-- Kept only because a migration records the crops bucket's limits here; the files are in S3.
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on storage.buckets to service_role;
