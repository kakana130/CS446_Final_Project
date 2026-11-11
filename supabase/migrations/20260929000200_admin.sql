-- Reports, feedback and the admin area (D-080). All functions are service-role only: the
-- public routes (report, feedback) and the admin routes (password session checked in Node)
-- call them with the server key.

-- The single password admin has no Supabase user; its actions are logged under this id.
-- (admin_audit_log.admin_id has no foreign key.)

-- ---------------------------------------------------------------------------
-- Public: report a post. One report per post per IP (hashed); three different reporters
-- hide an active post until an admin looks at it.
-- Returns 'reported', 'duplicate' or 'not_found'.
-- ---------------------------------------------------------------------------
create function public.report_post(
  p_post_id uuid,
  p_reason public.report_reason,
  p_note text,
  p_ip_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.posts where id = p_post_id and status in ('active', 'needs_review')
  ) then
    return 'not_found';
  end if;

  insert into public.reports (post_id, reason, note, ip_hash)
  values (p_post_id, p_reason, nullif(btrim(p_note), ''), p_ip_hash)
  on conflict (post_id, ip_hash) do nothing;
  if not found then
    return 'duplicate';
  end if;

  update public.posts
  set report_count = report_count + 1,
      status = case
        when report_count + 1 >= 3 and status = 'active' then 'hidden'::public.post_status
        else status
      end,
      review_reason = case
        when report_count + 1 >= 3 and not ('reports' = any (review_reason))
          then array_append(review_reason, 'reports')
        else review_reason
      end,
      updated_at = now()
  where id = p_post_id;
  return 'reported';
end;
$$;

-- ---------------------------------------------------------------------------
-- Public: feedback (1–5 stars and an optional comment).
-- ---------------------------------------------------------------------------
create function public.submit_feedback(
  p_rating integer,
  p_comment text,
  p_context public.feedback_context,
  p_locale text,
  p_ip_hash text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.feedback (rating, comment, context, locale, ip_hash)
  values (p_rating, nullif(btrim(p_comment), ''), p_context, p_locale, p_ip_hash);
$$;

-- ---------------------------------------------------------------------------
-- Owner resolves: also count it in the daily stats (replaces the D-078 version).
-- ---------------------------------------------------------------------------
create or replace function public.manage_post(p_batch_id uuid, p_post_id uuid, p_action text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_action = 'resolve' then
    update public.posts
    set status = 'resolved', updated_at = now()
    where batch_id = p_batch_id and (p_post_id is null or id = p_post_id)
      and status in ('active', 'needs_review');
  elsif p_action = 'extend' then
    update public.posts
    set expires_at = least(created_at + interval '90 days', expires_at + interval '30 days'),
        reminder_sent_at = null,
        updated_at = now()
    where batch_id = p_batch_id and (p_post_id is null or id = p_post_id)
      and status in ('active', 'needs_review')
      and expires_at < created_at + interval '90 days';
  elsif p_action = 'delete' then
    delete from public.posts
    where batch_id = p_batch_id and (p_post_id is null or id = p_post_id);
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;

  if p_action = 'resolve' and v_count > 0 then
    perform public.bump_daily_stat('resolved', v_count);
  end if;
  if p_action = 'delete' and not exists (select 1 from public.posts where batch_id = p_batch_id) then
    delete from public.batches where id = p_batch_id;
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: overview numbers and the last 14 days.
-- ---------------------------------------------------------------------------
create function public.admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lostActive', (select count(*) from public.posts where kind = 'lost' and status = 'active'),
    'foundActive', (select count(*) from public.posts where kind = 'found' and status = 'active'),
    'needsReview', (select count(*) from public.posts where status = 'needs_review'),
    'hidden', (select count(*) from public.posts where status = 'hidden'),
    'resolved', (select count(*) from public.posts where status = 'resolved'),
    'matches', (select count(*) from public.matches),
    'reportedPosts', (select count(distinct post_id) from public.reports),
    'feedback', (select count(*) from public.feedback),
    'mode', (select mode from public.site_settings where id = 1),
    'daily', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.day desc)
      from (select * from public.daily_stats order by day desc limit 14) d
    ), '[]'::jsonb)
  );
$$;

-- Posts with reports, most reported first. No contact details.
create function public.admin_reported_posts(p_limit integer default 50)
returns table (
  post_id uuid,
  kind public.post_kind,
  plate_display text,
  province_code text,
  status public.post_status,
  crop_path text,
  report_count integer,
  created_at timestamptz,
  reports jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.kind, p.plate_display, p.province_code, p.status, p.crop_path, p.report_count,
         p.created_at,
         (select jsonb_agg(jsonb_build_object('reason', r.reason, 'note', r.note, 'createdAt', r.created_at)
                           order by r.created_at desc)
          from public.reports r where r.post_id = p.id)
  from public.posts p
  where exists (select 1 from public.reports r where r.post_id = p.id)
  order by p.report_count desc, p.created_at desc
  limit least(p_limit, 200);
$$;

-- Find posts by plate text (letters/number, any spacing); empty query = newest posts.
create function public.admin_find_posts(p_query text, p_limit integer default 50)
returns table (
  post_id uuid,
  batch_id uuid,
  kind public.post_kind,
  plate_display text,
  province_code text,
  status public.post_status,
  crop_path text,
  report_count integer,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.batch_id, p.kind, p.plate_display, p.province_code, p.status, p.crop_path,
         p.report_count, p.created_at, p.expires_at
  from public.posts p
  where coalesce(btrim(p_query), '') = ''
     or replace(p.plate_display, ' ', '') ilike '%' || replace(p_query, ' ', '') || '%'
  order by p.created_at desc
  limit least(p_limit, 200);
$$;

create function public.admin_feedback(p_limit integer default 100)
returns table (
  id uuid,
  rating smallint,
  comment text,
  context public.feedback_context,
  locale text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.rating, f.comment, f.context, f.locale, f.created_at
  from public.feedback f
  order by f.created_at desc
  limit least(p_limit, 500);
$$;

-- Contact reveals: who looked at whose contact (IP only as a short hash prefix).
create function public.admin_reveals(p_limit integer default 100)
returns table (
  id uuid,
  created_at timestamptz,
  post_id uuid,
  plate_display text,
  match_id uuid,
  ip_prefix text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.created_at, c.post_id, p.plate_display, c.match_id, left(c.ip_hash, 8)
  from public.contact_reveals c
  join public.posts p on p.id = c.post_id
  order by c.created_at desc
  limit least(p_limit, 500);
$$;

create function public.admin_audit(p_limit integer default 100)
returns table (
  id bigint,
  created_at timestamptz,
  action text,
  target_type text,
  target_id text,
  details jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.created_at, a.action, a.target_type, a.target_id, a.details
  from public.admin_audit_log a
  order by a.created_at desc
  limit least(p_limit, 500);
$$;

-- Record an admin event (login, logout, failed login…).
create function public.admin_log(p_action text, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (admin_id, action, details)
  values ('00000000-0000-0000-0000-000000000001', p_action, coalesce(p_details, '{}'));
$$;

-- ---------------------------------------------------------------------------
-- Admin action on a post, always logged:
--   hide / restore (to active) / delete / dismiss (clear its reports).
-- Returns the number of posts changed.
-- ---------------------------------------------------------------------------
create function public.admin_post_action(p_action text, p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_batch uuid;
begin
  select batch_id into v_batch from public.posts where id = p_post_id;
  if p_action = 'hide' then
    update public.posts set status = 'hidden', updated_at = now()
    where id = p_post_id and status <> 'hidden';
  elsif p_action = 'restore' then
    update public.posts
    set status = 'active', review_reason = '{}', updated_at = now()
    where id = p_post_id and status in ('hidden', 'needs_review');
  elsif p_action = 'dismiss' then
    delete from public.reports where post_id = p_post_id;
    update public.posts set report_count = 0, updated_at = now() where id = p_post_id;
  elsif p_action = 'delete' then
    delete from public.posts where id = p_post_id;
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;

  if p_action = 'delete' and v_batch is not null
     and not exists (select 1 from public.posts where batch_id = v_batch) then
    delete from public.batches where id = v_batch;
  end if;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values ('00000000-0000-0000-0000-000000000001', 'post_' || p_action, 'post', p_post_id::text,
          jsonb_build_object('changed', v_count));
  return v_count;
end;
$$;

-- Open or pause the whole site (dormant between floods), logged.
create function public.admin_set_mode(p_mode public.site_mode)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.site_settings set mode = p_mode, updated_at = now() where id = 1;
  insert into public.admin_audit_log (admin_id, action, target_type, details)
  values ('00000000-0000-0000-0000-000000000001', 'site_mode', 'site', jsonb_build_object('mode', p_mode));
$$;

revoke all on function public.report_post(uuid, public.report_reason, text, text) from public, anon, authenticated;
revoke all on function public.submit_feedback(integer, text, public.feedback_context, text, text) from public, anon, authenticated;
revoke all on function public.admin_overview() from public, anon, authenticated;
revoke all on function public.admin_reported_posts(integer) from public, anon, authenticated;
revoke all on function public.admin_find_posts(text, integer) from public, anon, authenticated;
revoke all on function public.admin_feedback(integer) from public, anon, authenticated;
revoke all on function public.admin_reveals(integer) from public, anon, authenticated;
revoke all on function public.admin_audit(integer) from public, anon, authenticated;
revoke all on function public.admin_log(text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_post_action(text, uuid) from public, anon, authenticated;
revoke all on function public.admin_set_mode(public.site_mode) from public, anon, authenticated;

grant execute on function public.report_post(uuid, public.report_reason, text, text) to service_role;
grant execute on function public.submit_feedback(integer, text, public.feedback_context, text, text) to service_role;
grant execute on function public.admin_overview() to service_role;
grant execute on function public.admin_reported_posts(integer) to service_role;
grant execute on function public.admin_find_posts(text, integer) to service_role;
grant execute on function public.admin_feedback(integer) to service_role;
grant execute on function public.admin_reveals(integer) to service_role;
grant execute on function public.admin_audit(integer) to service_role;
grant execute on function public.admin_log(text, jsonb) to service_role;
grant execute on function public.admin_post_action(text, uuid) to service_role;
grant execute on function public.admin_set_mode(public.site_mode) to service_role;
