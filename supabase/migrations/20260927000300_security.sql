-- Deny-by-default access model.
--   anon           : nothing. The public never talks to Postgres directly.
--   authenticated  : nothing, except admins at AAL2 via the policies below.
--   service_role   : server route handlers (bypasses RLS); still needs table grants.

-- ---------------------------------------------------------------------------
-- 1. Strip Supabase's default grants, now and for future objects.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS on every table. No policy for anon anywhere.
-- ---------------------------------------------------------------------------
alter table public.provinces               enable row level security;
alter table public.batches                 enable row level security;
alter table public.batch_contacts          enable row level security;
alter table public.push_subscriptions      enable row level security;
alter table public.posts                   enable row level security;
alter table public.matches                 enable row level security;
alter table public.reports                 enable row level security;
alter table public.contact_reveals         enable row level security;
alter table public.feedback                enable row level security;
alter table public.deletion_requests       enable row level security;
alter table public.rate_limits             enable row level security;
alter table public.pin_attempts            enable row level security;
alter table public.site_settings           enable row level security;
alter table public.daily_stats             enable row level security;
alter table public.pending_storage_deletes enable row level security;
alter table public.admin_audit_log         enable row level security;
alter table public.access_log              enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Server role.
-- ---------------------------------------------------------------------------
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.rl_hit(text, text, integer, integer) to service_role;
grant execute on function
  public.match_candidates(public.post_kind, public.plate_type, text, text, real, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Admins: app_metadata.role = 'admin' AND MFA-verified session (aal2).
--    Contacts, credentials, push endpoints, rate limits and the access log have no admin
--    policy at all: contact viewing goes through an audited server path.
-- ---------------------------------------------------------------------------
create function public.is_admin_aal2() returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      and (auth.jwt() ->> 'aal') = 'aal2',
    false
  );
$$;
revoke all on function public.is_admin_aal2() from public, anon;
grant execute on function public.is_admin_aal2() to authenticated, service_role;

grant select on public.provinces to authenticated;
create policy admin_read on public.provinces
  for select to authenticated using (public.is_admin_aal2());

grant select, update (status, review_reason) on public.posts to authenticated;
create policy admin_read on public.posts
  for select to authenticated using (public.is_admin_aal2());
create policy admin_moderate on public.posts
  for update to authenticated using (public.is_admin_aal2()) with check (public.is_admin_aal2());

grant select on public.matches to authenticated;
create policy admin_read on public.matches
  for select to authenticated using (public.is_admin_aal2());

grant select, delete on public.reports to authenticated;
create policy admin_read on public.reports
  for select to authenticated using (public.is_admin_aal2());
create policy admin_dismiss on public.reports
  for delete to authenticated using (public.is_admin_aal2());

grant select on public.contact_reveals to authenticated;
create policy admin_read on public.contact_reveals
  for select to authenticated using (public.is_admin_aal2());

grant select on public.feedback to authenticated;
create policy admin_read on public.feedback
  for select to authenticated using (public.is_admin_aal2());

grant select, update (status, handled_by, handled_at) on public.deletion_requests to authenticated;
create policy admin_read on public.deletion_requests
  for select to authenticated using (public.is_admin_aal2());
create policy admin_handle on public.deletion_requests
  for update to authenticated using (public.is_admin_aal2()) with check (public.is_admin_aal2());

grant select, update (mode, banner_th, banner_en, updated_at, updated_by)
  on public.site_settings to authenticated;
create policy admin_read on public.site_settings
  for select to authenticated using (public.is_admin_aal2());
create policy admin_update on public.site_settings
  for update to authenticated
  using (public.is_admin_aal2())
  with check (public.is_admin_aal2() and updated_by = auth.uid());

grant select on public.daily_stats to authenticated;
create policy admin_read on public.daily_stats
  for select to authenticated using (public.is_admin_aal2());

grant select, insert on public.admin_audit_log to authenticated;
create policy admin_read on public.admin_audit_log
  for select to authenticated using (public.is_admin_aal2());
create policy admin_append on public.admin_audit_log
  for insert to authenticated with check (public.is_admin_aal2() and admin_id = auth.uid());
