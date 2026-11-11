-- Private bucket for plate crops. storage.objects has RLS enabled by Supabase and we add
-- no policies, so only service_role (server) can read or write. Images are served through
-- short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crops', 'crops', false, 307200, array['image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Hourly purge of expired rate-limit windows keeps the hottest table small.
-- Everything that touches Storage runs in the Vercel daily cron instead.
do $$
begin
  -- On Amazon RDS pg_cron is listed as available but only loads when added to the DB
  -- parameter group's shared_preload_libraries; without it the daily cleanup does this.
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and coalesce(current_setting('shared_preload_libraries', true), '') like '%pg_cron%' then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'purge-rate-limits',
      '17 * * * *',
      $cron$delete from public.rate_limits where window_start < now() - interval '2 days'$cron$
    );
  else
    raise notice 'pg_cron not loaded; skipping schedule (purge_expired_data covers it)';
  end if;
end;
$$;
