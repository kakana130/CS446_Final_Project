-- Automatic match emails with the other side's contact details. Anyone who gives an email is
-- now subscribed to alerts (no checkbox), and when a match is recorded Amazon SNS emails both
-- sides on its own: the owner gets the finder's contact (and where the plate is), the finder
-- gets the owner's. The same contact fields as the reveal flow: the email only if that person
-- chose to show it as a contact.

drop function public.match_alerts(uuid[]);

create function public.match_alerts(p_match_ids uuid[])
returns table (
  match_id            uuid,
  role                text,
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
    select m.id, lp.batch_id as lost_batch, fp.batch_id as found_batch,
           lp.plate_display as lost_plate, fp.plate_display as found_plate,
           fp.created_at as found_at, fb.handover_location as handover,
           fb.district, fb.police_station_note
    from public.matches m
    join public.posts lp on lp.id = m.lost_post_id
    join public.posts fp on fp.id = m.found_post_id
    join public.batches fb on fb.id = fp.batch_id
    where m.id = any (coalesce(p_match_ids, '{}'))
      and m.notified_at is null
      and lp.status = 'active' and lp.expires_at > now()
      and fp.status = 'active' and fp.expires_at > now()
  )
  -- The owner: their lost plate first, the finder's contact.
  select m.id, 'owner', m.lost_plate, m.found_plate, m.found_at, m.handover, b.locale, c.email,
         fc.line_id, fc.phone, case when fc.show_email_as_contact then fc.email end,
         m.district, m.police_station_note
  from m
  join public.batches b on b.id = m.lost_batch
  join public.batch_contacts c on c.batch_id = b.id
  join public.batch_contacts fc on fc.batch_id = m.found_batch
  where c.notify_email and c.email is not null
  union all
  -- The finder: their found plate first, the owner's contact.
  select m.id, 'finder', m.found_plate, m.lost_plate, m.found_at, m.handover, b.locale, c.email,
         lc.line_id, lc.phone, case when lc.show_email_as_contact then lc.email end,
         null, null
  from m
  join public.batches b on b.id = m.found_batch
  join public.batch_contacts c on c.batch_id = b.id
  join public.batch_contacts lc on lc.batch_id = m.lost_batch
  where c.notify_email and c.email is not null;
$$;

revoke all on function public.match_alerts(uuid[]) from public, anon, authenticated;
grant execute on function public.match_alerts(uuid[]) to service_role;
