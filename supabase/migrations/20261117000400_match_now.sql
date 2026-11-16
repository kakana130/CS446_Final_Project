-- "Match Now!": anyone on a match page can have the match emailed to both sides again, for
-- example after confirming their email address with Amazon SNS. At most once every 5 seconds
-- per match, so the button can't be used to flood someone's inbox.

alter table public.matches add column last_manual_notify_at timestamptz;

-- 'ok' (go ahead, the time is recorded), 'wait' (pressed less than 5 s ago) or 'missing' (no
-- such match, or one of its posts is no longer active).
create function public.claim_match_notify(p_match_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.matches m
    join public.posts lp on lp.id = m.lost_post_id
    join public.posts fp on fp.id = m.found_post_id
    where m.id = p_match_id
      and lp.status = 'active' and lp.expires_at > now()
      and fp.status = 'active' and fp.expires_at > now()
  ) then
    return 'missing';
  end if;

  update public.matches
  set last_manual_notify_at = now()
  where id = p_match_id
    and (last_manual_notify_at is null or last_manual_notify_at <= now() - interval '5 seconds');
  return case when found then 'ok' else 'wait' end;
end;
$$;

revoke all on function public.claim_match_notify(uuid) from public, anon, authenticated;
grant execute on function public.claim_match_notify(uuid) to service_role;

-- match_alerts: also the match kind, and p_force to include matches already notified (the
-- "Match Now!" button). Same rows otherwise as 20261117000300_auto_alerts.sql.
drop function public.match_alerts(uuid[]);

create function public.match_alerts(p_match_ids uuid[], p_force boolean default false)
returns table (
  match_id            uuid,
  role                text,
  match_kind          public.match_kind,
  plate_display       text,
  other_plate_display text,
  found_created_at    timestamptz,
  found_handover      public.handover_location,
  locale              text,
  email               text,
  other_line_id       text,
  other_phone         text,
  other_email         text,
  other_district      text,
  other_police_note   text
)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select m.id, m.kind, lp.batch_id as lost_batch, fp.batch_id as found_batch,
           lp.plate_display as lost_plate, fp.plate_display as found_plate,
           fp.created_at as found_at, fb.handover_location as handover,
           fb.district, fb.police_station_note
    from public.matches m
    join public.posts lp on lp.id = m.lost_post_id
    join public.posts fp on fp.id = m.found_post_id
    join public.batches fb on fb.id = fp.batch_id
    where m.id = any (coalesce(p_match_ids, '{}'))
      and (coalesce(p_force, false) or m.notified_at is null)
      and lp.status = 'active' and lp.expires_at > now()
      and fp.status = 'active' and fp.expires_at > now()
  )
  -- The owner: their lost plate first, the finder's contact.
  select m.id, 'owner', m.kind, m.lost_plate, m.found_plate, m.found_at, m.handover, b.locale,
         c.email, fc.line_id, fc.phone, case when fc.show_email_as_contact then fc.email end,
         m.district, m.police_station_note
  from m
  join public.batches b on b.id = m.lost_batch
  join public.batch_contacts c on c.batch_id = b.id
  join public.batch_contacts fc on fc.batch_id = m.found_batch
  where c.notify_email and c.email is not null
  union all
  -- The finder: their found plate first, the owner's contact.
  select m.id, 'finder', m.kind, m.found_plate, m.lost_plate, m.found_at, m.handover, b.locale,
         c.email, lc.line_id, lc.phone, case when lc.show_email_as_contact then lc.email end,
         null, null
  from m
  join public.batches b on b.id = m.found_batch
  join public.batch_contacts c on c.batch_id = b.id
  join public.batch_contacts lc on lc.batch_id = m.lost_batch
  where c.notify_email and c.email is not null;
$$;

revoke all on function public.match_alerts(uuid[], boolean) from public, anon, authenticated;
grant execute on function public.match_alerts(uuid[], boolean) to service_role;
