-- Email alerts both ways. A finder can now ask to be emailed too: when the owner of a plate
-- they found reports it lost later, both sides hear about the match. Owners were already
-- alerted (20261109000100_aws_alerts.sql, 20261117000100_alert_details.sql).

-- create_found_batch takes p_notify_email (last, with a default, so existing callers keep
-- working). The signature changes, so the function is dropped and recreated.
drop function public.create_found_batch(uuid, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean, text);

create function public.create_found_batch(
  p_owner_id uuid,
  p_device_token_hash text,
  p_upload_token_hash text,
  p_upload_token_expires_at timestamptz,
  p_locale text,
  p_consent_version text,
  p_handover public.handover_location,
  p_police_station_note text,
  p_district text,
  p_line_id text,
  p_phone text,
  p_email text,
  p_show_email boolean,
  p_note text default null,
  p_notify_email boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
begin
  insert into public.batches
    (kind, owner_id, device_token_hash, upload_token_hash, upload_token_expires_at, locale,
     consent_version, handover_location, police_station_note, district, note)
  values
    ('found', p_owner_id, p_device_token_hash, p_upload_token_hash, p_upload_token_expires_at,
     p_locale, p_consent_version, p_handover, p_police_station_note, p_district,
     nullif(p_note, ''))
  returning id into v_batch;

  insert into public.batch_contacts
    (batch_id, line_id, phone, email, show_email_as_contact, notify_email)
  values (v_batch, p_line_id, p_phone, p_email, p_show_email, coalesce(p_notify_email, false));

  return v_batch;
end;
$$;

revoke all on function public.create_found_batch(uuid, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.create_found_batch(uuid, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean, text, boolean) to service_role;

-- One row per person to email about a new match: the owner (role 'owner', their lost plate
-- first) and/or the finder (role 'finder', their found plate first), each only if they asked
-- for alerts. The district and police-station note stay behind the reveal flow.
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
  email               text
)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select m.id, lp.batch_id as lost_batch, fp.batch_id as found_batch,
           lp.plate_display as lost_plate, fp.plate_display as found_plate,
           fp.created_at as found_at, fb.handover_location as handover
    from public.matches m
    join public.posts lp on lp.id = m.lost_post_id
    join public.posts fp on fp.id = m.found_post_id
    join public.batches fb on fb.id = fp.batch_id
    where m.id = any (coalesce(p_match_ids, '{}'))
      and m.notified_at is null
      and lp.status = 'active' and lp.expires_at > now()
      and fp.status = 'active' and fp.expires_at > now()
  )
  select m.id, 'owner', m.lost_plate, m.found_plate, m.found_at, m.handover, b.locale, c.email
  from m
  join public.batches b on b.id = m.lost_batch
  join public.batch_contacts c on c.batch_id = b.id
  where c.notify_email and c.email is not null
  union all
  select m.id, 'finder', m.found_plate, m.lost_plate, m.found_at, m.handover, b.locale, c.email
  from m
  join public.batches b on b.id = m.found_batch
  join public.batch_contacts c on c.batch_id = b.id
  where c.notify_email and c.email is not null;
$$;

revoke all on function public.match_alerts(uuid[]) from public, anon, authenticated;
grant execute on function public.match_alerts(uuid[]) to service_role;

-- Emails that keep their SNS subscription: anyone, owner or finder, with alerts on and an
-- active, unexpired post. Everything else is unsubscribed by the daily prune (retention).
create or replace function public.alert_emails()
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
    and p.status = 'active'
    and p.expires_at > now();
$$;
