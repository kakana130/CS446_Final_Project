-- Match alerts through Amazon SNS (AWS port). The lost-plate owner opts in on the form;
-- AWS SNS then sends its own confirmation email (double opt-in). When a new match is
-- recorded the app looks up who wants an alert here, invokes the notify Lambda, and marks
-- the match notified. Service role only, like every other function.

-- New matches whose lost-plate owner asked for email alerts (and both posts are active).
create function public.match_alerts(p_match_ids uuid[])
returns table (
  match_id      uuid,
  lost_post_id  uuid,
  plate_display text,
  locale        text,
  email         text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, lp.id, lp.plate_display, b.locale, c.email
  from public.matches m
  join public.posts lp on lp.id = m.lost_post_id
  join public.posts fp on fp.id = m.found_post_id
  join public.batches b on b.id = lp.batch_id
  join public.batch_contacts c on c.batch_id = b.id
  where m.id = any (coalesce(p_match_ids, '{}'))
    and m.notified_at is null
    and c.notify_email
    and c.email is not null
    and lp.status = 'active' and lp.expires_at > now()
    and fp.status = 'active' and fp.expires_at > now();
$$;

create function public.mark_matches_notified(p_match_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.matches
  set notified_at = now()
  where id = any (coalesce(p_match_ids, '{}')) and notified_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Emails that should keep their SNS subscription: owners of active, unexpired lost watches
-- with alerts on. Everything else is unsubscribed by the daily prune (retention, D-089).
create function public.alert_emails()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct c.email
  from public.batch_contacts c
  join public.posts p on p.batch_id = c.batch_id
  where c.notify_email
    and c.email is not null
    and p.kind = 'lost'
    and p.status = 'active'
    and p.expires_at > now();
$$;

revoke all on function public.match_alerts(uuid[]) from public, anon, authenticated;
revoke all on function public.mark_matches_notified(uuid[]) from public, anon, authenticated;
revoke all on function public.alert_emails() from public, anon, authenticated;

grant execute on function public.match_alerts(uuid[]) to service_role;
grant execute on function public.mark_matches_notified(uuid[]) to service_role;
grant execute on function public.alert_emails() to service_role;
