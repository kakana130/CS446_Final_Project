-- Retention (D-089): what the Privacy Policy promises, done once a day by the cron route
-- /api/cron/retention with the service role. LEGAL-TODO(retention): the periods below are
-- the published ones and change together with legal.privacy.sections.s6.

-- ---------------------------------------------------------------------------
-- Delete everything past its retention period; returns how many rows went, per kind.
-- ---------------------------------------------------------------------------
create function public.purge_expired_data(p_access_log_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_posts    integer;
  v_batches  integer;
  v_reveals  integer;
  v_feedback integer;
  v_requests integer;
  v_access   integer;
  v_rate     integer;
begin
  -- Posts past their expiry. Matches, reports and contact reveals go with them (on delete
  -- cascade); the posts trigger queues each crop for storage deletion and removes a batch
  -- (with its contacts and push subscriptions) once its last post is gone.
  delete from public.posts where expires_at < now();
  get diagnostics v_posts = row_count;

  -- Batches that never got a post: a found batch whose upload was never finished.
  delete from public.batches b
  where b.created_at < now() - interval '1 day'
    and not exists (select 1 from public.posts p where p.batch_id = b.id);
  get diagnostics v_batches = row_count;

  delete from public.contact_reveals where created_at < now() - interval '30 days';
  get diagnostics v_reveals = row_count;

  delete from public.feedback where created_at < now() - interval '365 days';
  get diagnostics v_feedback = row_count;

  delete from public.deletion_requests where handled_at < now() - interval '30 days';
  get diagnostics v_requests = row_count;

  delete from public.access_log
  where ts < now() - make_interval(days => greatest(coalesce(p_access_log_days, 90), 1));
  get diagnostics v_access = row_count;

  -- Also done hourly by pg_cron where it exists; this covers projects without it.
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics v_rate = row_count;

  return jsonb_build_object(
    'posts', v_posts,
    'batches', v_batches,
    'contact_reveals', v_reveals,
    'feedback', v_feedback,
    'deletion_requests', v_requests,
    'access_log', v_access,
    'rate_limits', v_rate
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Crops waiting to be removed from storage. The cron route removes them through the
-- Storage API (SQL cannot delete the files themselves) and reports back.
-- ---------------------------------------------------------------------------
create function public.pending_storage_paths(p_limit integer default 100)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select path
  from public.pending_storage_deletes
  where attempts < 10
  order by created_at
  limit least(greatest(p_limit, 1), 1000);
$$;

create function public.storage_paths_done(p_removed text[], p_failed text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.pending_storage_deletes where path = any (coalesce(p_removed, '{}'));
  update public.pending_storage_deletes
  set attempts = attempts + 1
  where path = any (coalesce(p_failed, '{}'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Safety net for matching (D-048): active posts from the last days, re-matched by the same
-- cron run in case matching failed right after they were posted.
-- ---------------------------------------------------------------------------
create function public.recent_active_posts(p_since timestamptz, p_limit integer default 200)
returns table (
  id            uuid,
  kind          public.post_kind,
  plate_type    public.plate_type,
  prefix_digit  text,
  letters       text,
  number        text,
  province_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.kind, p.plate_type, p.prefix_digit, p.letters, p.number, p.province_code
  from public.posts p
  where p.status = 'active'
    and p.expires_at > now()
    and p.created_at >= p_since
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 1000);
$$;

revoke all on function public.recent_active_posts(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.recent_active_posts(timestamptz, integer) to service_role;

revoke all on function public.purge_expired_data(integer) from public, anon, authenticated;
revoke all on function public.pending_storage_paths(integer) from public, anon, authenticated;
revoke all on function public.storage_paths_done(text[], text[]) from public, anon, authenticated;

grant execute on function public.purge_expired_data(integer) to service_role;
grant execute on function public.pending_storage_paths(integer) to service_role;
grant execute on function public.storage_paths_done(text[], text[]) to service_role;
