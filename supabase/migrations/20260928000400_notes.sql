-- Free-text note (หมายเหตุ) for both sides, e.g. "rear plate, has a sticker" or "found near the
-- temple, front and rear". Anti-scam checks run in the API (no links, account or ID numbers).
-- Visibility: the finder's note comes with the contact reveal; the owner's note is shown on
-- the match page (reachable only by the owner's notification and the matched finder).

alter table public.batches
  add column note text check (char_length(note) <= 300);

drop function public.create_lost_watch(text, text, text, text, text, text, text, boolean, boolean, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status);
drop function public.create_found_batch(text, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean);
drop function public.get_match_view(uuid);
drop function public.reveal_found_contact(uuid, text);

create function public.create_lost_watch(
  p_pin_hash text,
  p_device_token_hash text,
  p_locale text,
  p_consent_version text,
  p_line_id text,
  p_phone text,
  p_email text,
  p_show_email boolean,
  p_notify_email boolean,
  p_plate_type public.plate_type,
  p_prefix_digit text,
  p_letters text,
  p_number text,
  p_province_code text,
  p_canonical text,
  p_key text,
  p_display text,
  p_has_wildcards boolean,
  p_format_status public.format_status,
  p_note text default null
) returns table (out_batch_id uuid, out_post_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_post uuid;
begin
  insert into public.batches (kind, pin_hash, device_token_hash, locale, consent_version, note)
  values ('lost', p_pin_hash, p_device_token_hash, p_locale, p_consent_version, nullif(p_note, ''))
  returning id into v_batch;

  insert into public.batch_contacts
    (batch_id, line_id, phone, email, show_email_as_contact, notify_email)
  values (v_batch, p_line_id, p_phone, p_email, p_show_email, p_notify_email);

  insert into public.posts
    (batch_id, kind, plate_type, prefix_digit, letters, number, province_code,
     plate_canonical, plate_key, plate_display, has_wildcards, format_status)
  values
    (v_batch, 'lost', p_plate_type, p_prefix_digit, p_letters, p_number, p_province_code,
     p_canonical, p_key, p_display, p_has_wildcards, p_format_status)
  returning id into v_post;

  perform public.bump_daily_stat('lost_created', 1);
  return query select v_batch, v_post;
end;
$$;

create function public.create_found_batch(
  p_pin_hash text,
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
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
begin
  insert into public.batches
    (kind, pin_hash, device_token_hash, upload_token_hash, upload_token_expires_at, locale,
     consent_version, handover_location, police_station_note, district, note)
  values
    ('found', p_pin_hash, p_device_token_hash, p_upload_token_hash, p_upload_token_expires_at,
     p_locale, p_consent_version, p_handover, p_police_station_note, p_district,
     nullif(p_note, ''))
  returning id into v_batch;

  insert into public.batch_contacts
    (batch_id, line_id, phone, email, show_email_as_contact, notify_email)
  values (v_batch, p_line_id, p_phone, p_email, p_show_email, false);

  return v_batch;
end;
$$;

create function public.get_match_view(p_match_id uuid)
returns table (
  match_id uuid,
  match_kind public.match_kind,
  score real,
  matched_at timestamptz,
  lost_plate_type public.plate_type,
  lost_prefix_digit text,
  lost_letters text,
  lost_number text,
  lost_province_code text,
  found_post_id uuid,
  found_plate_type public.plate_type,
  found_prefix_digit text,
  found_letters text,
  found_number text,
  found_province_code text,
  found_format_status public.format_status,
  found_crop_path text,
  found_created_at timestamptz,
  found_handover public.handover_location,
  lost_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.kind, m.score, m.created_at,
         l.plate_type, l.prefix_digit, l.letters, l.number, l.province_code,
         f.id, f.plate_type, f.prefix_digit, f.letters, f.number, f.province_code,
         f.format_status, f.crop_path, f.created_at, fb.handover_location, lb.note
  from public.matches m
  join public.posts l on l.id = m.lost_post_id
  join public.posts f on f.id = m.found_post_id
  join public.batches fb on fb.id = f.batch_id
  join public.batches lb on lb.id = l.batch_id
  where m.id = p_match_id
    and l.status = 'active'
    and f.status = 'active';
$$;

create function public.reveal_found_contact(p_post_id uuid, p_ip_hash text)
returns table (
  line_id text,
  phone text,
  email text,
  handover public.handover_location,
  police_station_note text,
  district text,
  note text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
begin
  select p.batch_id into v_batch
  from public.posts p
  where p.id = p_post_id
    and p.kind = 'found'
    and p.status = 'active'
    and p.expires_at > now();
  if not found then
    return;
  end if;

  insert into public.contact_reveals (post_id, ip_hash) values (p_post_id, p_ip_hash);

  return query
  select c.line_id, c.phone,
         case when c.show_email_as_contact then c.email end,
         b.handover_location, b.police_station_note, b.district, b.note
  from public.batches b
  join public.batch_contacts c on c.batch_id = b.id
  where b.id = v_batch;
end;
$$;

revoke all on function public.create_lost_watch(text, text, text, text, text, text, text, boolean, boolean, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status, text) from public, anon, authenticated;
revoke all on function public.create_found_batch(text, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.get_match_view(uuid) from public, anon, authenticated;
revoke all on function public.reveal_found_contact(uuid, text) from public, anon, authenticated;
grant execute on function public.create_lost_watch(text, text, text, text, text, text, text, boolean, boolean, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status, text) to service_role;
grant execute on function public.create_found_batch(text, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean, text) to service_role;
grant execute on function public.get_match_view(uuid) to service_role;
grant execute on function public.reveal_found_contact(uuid, text) to service_role;
