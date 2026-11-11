-- Phase 3: atomic posting, candidate retrieval, match recording and match view.
-- All functions are SECURITY DEFINER with an empty search_path and executable only by
-- service_role (the server). Default privileges already revoke EXECUTE from public/anon/
-- authenticated; the grants at the end make the intended caller explicit.

-- ---------------------------------------------------------------------------
-- Anonymous daily counters (posts are really deleted, so aggregates live here).
-- ---------------------------------------------------------------------------
create function public.bump_daily_stat(p_field text, p_n integer default 1) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if p_field not in ('lost_created', 'found_created', 'matches', 'resolved') then
    raise exception 'unknown stat %', p_field;
  end if;
  insert into public.daily_stats as s (day, lost_created, found_created, matches, resolved)
  values (
    v_day,
    case when p_field = 'lost_created' then p_n else 0 end,
    case when p_field = 'found_created' then p_n else 0 end,
    case when p_field = 'matches' then p_n else 0 end,
    case when p_field = 'resolved' then p_n else 0 end
  )
  on conflict (day) do update set
    lost_created = s.lost_created + excluded.lost_created,
    found_created = s.found_created + excluded.found_created,
    matches = s.matches + excluded.matches,
    resolved = s.resolved + excluded.resolved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lost watch: batch + contact + post in one transaction.
-- ---------------------------------------------------------------------------
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
  p_format_status public.format_status
) returns table (out_batch_id uuid, out_post_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_post uuid;
begin
  insert into public.batches (kind, pin_hash, device_token_hash, locale, consent_version)
  values ('lost', p_pin_hash, p_device_token_hash, p_locale, p_consent_version)
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

-- ---------------------------------------------------------------------------
-- Found batch: credentials, contact and finder details. Plates are added one by one
-- (weak mobile data: each crop upload is retried on its own) with a short-lived upload token.
-- ---------------------------------------------------------------------------
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
  p_show_email boolean
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
     consent_version, handover_location, police_station_note, district)
  values
    ('found', p_pin_hash, p_device_token_hash, p_upload_token_hash, p_upload_token_expires_at,
     p_locale, p_consent_version, p_handover, p_police_station_note, p_district)
  returning id into v_batch;

  insert into public.batch_contacts
    (batch_id, line_id, phone, email, show_email_as_contact, notify_email)
  values (v_batch, p_line_id, p_phone, p_email, p_show_email, false);

  return v_batch;
end;
$$;

create function public.check_upload_token(p_batch_id uuid, p_upload_token_hash text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.batches b
    where b.id = p_batch_id
      and b.kind = 'found'
      and b.upload_token_hash = p_upload_token_hash
      and b.upload_token_expires_at > now()
  );
$$;

create function public.add_found_plate(
  p_batch_id uuid,
  p_upload_token_hash text,
  p_post_id uuid,
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
  p_crop_path text,
  p_status public.post_status,
  p_review_reason text[],
  p_ocr_min_confidence real,
  p_max_plates integer
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Lock the batch row so concurrent uploads can't exceed the plate cap.
  perform 1 from public.batches b
  where b.id = p_batch_id
    and b.kind = 'found'
    and b.upload_token_hash = p_upload_token_hash
    and b.upload_token_expires_at > now()
  for update;
  if not found then
    raise exception 'upload_token_invalid' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.posts p where p.batch_id = p_batch_id;
  if v_count >= p_max_plates then
    raise exception 'batch_full' using errcode = 'P0001';
  end if;

  insert into public.posts
    (id, batch_id, kind, plate_type, prefix_digit, letters, number, province_code,
     plate_canonical, plate_key, plate_display, has_wildcards, format_status, crop_path,
     status, review_reason, ocr_min_confidence)
  values
    (p_post_id, p_batch_id, 'found', p_plate_type, p_prefix_digit, p_letters, p_number,
     p_province_code, p_canonical, p_key, p_display, p_has_wildcards, p_format_status,
     p_crop_path, p_status, coalesce(p_review_reason, '{}'), p_ocr_min_confidence);

  perform public.bump_daily_stat('found_created', 1);
  return p_post_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Candidate retrieval (replaces match_candidates): returns what search and matching need.
-- Recall-oriented; the TypeScript scorer decides what is actually a match.
-- ---------------------------------------------------------------------------
drop function public.match_candidates(public.post_kind, public.plate_type, text, text, real, integer);

create function public.plate_candidates(
  p_kind public.post_kind,
  p_plate_type public.plate_type,
  p_key text,
  p_number text,
  p_floor real default 0.2,
  p_limit integer default 200
) returns table (
  id uuid,
  batch_id uuid,
  kind public.post_kind,
  plate_type public.plate_type,
  prefix_digit text,
  letters text,
  number text,
  province_code text,
  has_wildcards boolean,
  format_status public.format_status,
  crop_path text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := replace(p_key, '?', '');
begin
  perform set_config('pg_trgm.similarity_threshold', p_floor::text, true);

  return query
  select p.id, p.batch_id, p.kind, p.plate_type, p.prefix_digit, p.letters, p.number,
         p.province_code, p.has_wildcards, p.format_status, p.crop_path, p.created_at
  from public.posts p
  where p.kind <> p_kind
    and p.status = 'active'
    and p.expires_at > now()
    and (p_plate_type = 'other' or p.plate_type = 'other' or p.plate_type = p_plate_type)
    and (
      p.plate_key operator(extensions.%) v_key
      or p.number = p_number
      or p.has_wildcards
    )
  order by extensions.similarity(p.plate_key, v_key) desc, p.created_at desc
  limit least(p_limit, 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Record matches found by the scorer. Idempotent per pair; reports which pairs are new so
-- the caller notifies each lost-plate owner once.
-- ---------------------------------------------------------------------------
create function public.record_matches(p_matches jsonb)
returns table (
  out_match_id uuid,
  out_lost_post_id uuid,
  out_found_post_id uuid,
  out_kind public.match_kind,
  out_is_new boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_id uuid;
  v_kind public.match_kind;
  v_new boolean;
  v_count integer := 0;
begin
  for r in
    select * from jsonb_to_recordset(p_matches)
      as x(lost_post_id uuid, found_post_id uuid, score real, kind text)
  loop
    insert into public.matches as m (lost_post_id, found_post_id, score, kind)
    values (r.lost_post_id, r.found_post_id, r.score, r.kind::public.match_kind)
    on conflict (lost_post_id, found_post_id) do update
      set score = greatest(m.score, excluded.score),
          kind = case when excluded.kind = 'exact' then 'exact'::public.match_kind else m.kind end
    returning m.id, m.kind, (m.xmax = 0) into v_id, v_kind, v_new;

    if v_new then
      v_count := v_count + 1;
    end if;
    out_match_id := v_id;
    out_lost_post_id := r.lost_post_id;
    out_found_post_id := r.found_post_id;
    out_kind := v_kind;
    out_is_new := v_new;
    return next;
  end loop;

  if v_count > 0 then
    perform public.bump_daily_stat('matches', v_count);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Match page: both plates (parts, for the plate renderer) and the found crop path.
-- Returns nothing unless both posts are active (hidden/under-review posts never leak).
-- No contact details and no district: those come through the reveal flow (Phase 4).
-- ---------------------------------------------------------------------------
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
  found_handover public.handover_location
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.kind, m.score, m.created_at,
         l.plate_type, l.prefix_digit, l.letters, l.number, l.province_code,
         f.id, f.plate_type, f.prefix_digit, f.letters, f.number, f.province_code,
         f.format_status, f.crop_path, f.created_at, fb.handover_location
  from public.matches m
  join public.posts l on l.id = m.lost_post_id
  join public.posts f on f.id = m.found_post_id
  join public.batches fb on fb.id = f.batch_id
  where m.id = p_match_id
    and l.status = 'active'
    and f.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Grants: server only.
-- ---------------------------------------------------------------------------
revoke all on function public.bump_daily_stat(text, integer) from public, anon, authenticated;
revoke all on function public.create_lost_watch(text, text, text, text, text, text, text, boolean, boolean, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status) from public, anon, authenticated;
revoke all on function public.create_found_batch(text, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.check_upload_token(uuid, text) from public, anon, authenticated;
revoke all on function public.add_found_plate(uuid, text, uuid, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status, text, public.post_status, text[], real, integer) from public, anon, authenticated;
revoke all on function public.plate_candidates(public.post_kind, public.plate_type, text, text, real, integer) from public, anon, authenticated;
revoke all on function public.record_matches(jsonb) from public, anon, authenticated;
revoke all on function public.get_match_view(uuid) from public, anon, authenticated;

grant execute on function public.bump_daily_stat(text, integer) to service_role;
grant execute on function public.create_lost_watch(text, text, text, text, text, text, text, boolean, boolean, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status) to service_role;
grant execute on function public.create_found_batch(text, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean) to service_role;
grant execute on function public.check_upload_token(uuid, text) to service_role;
grant execute on function public.add_found_plate(uuid, text, uuid, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status, text, public.post_status, text[], real, integer) to service_role;
grant execute on function public.plate_candidates(public.post_kind, public.plate_type, text, text, real, integer) to service_role;
grant execute on function public.record_matches(jsonb) to service_role;
grant execute on function public.get_match_view(uuid) to service_role;
