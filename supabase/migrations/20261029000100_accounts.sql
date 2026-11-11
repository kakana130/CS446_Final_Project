-- Optional Google sign-in replaces the PIN (D-085). People found the PIN unfamiliar and
-- forgot it. A batch is now owned by this device (its token, as before) and, if the poster
-- signed in, by their account, which works from any device. Signing in on a device also
-- links the posts made there earlier. PIN columns, attempts and functions are removed.
-- All functions are service role only; the API passes the user id after verifying the
-- session with Supabase Auth.

-- ---------------------------------------------------------------------------
-- Ownership by account; the PIN goes.
-- ---------------------------------------------------------------------------
alter table public.batches
  add column owner_id uuid references auth.users (id) on delete set null;
create index batches_owner_idx on public.batches (owner_id) where owner_id is not null;

drop function public.manage_candidates(text);
drop function public.pin_failed(uuid);
drop function public.pin_succeeded(uuid);
drop table public.pin_attempts;

drop function public.create_lost_watch(text, text, text, text, text, text, text, boolean, boolean, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status, text);
drop function public.create_found_batch(text, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean, text);
alter table public.batches drop column pin_hash;

create function public.create_lost_watch(
  p_owner_id uuid,
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
  insert into public.batches (kind, owner_id, device_token_hash, locale, consent_version, note)
  values ('lost', p_owner_id, p_device_token_hash, p_locale, p_consent_version, nullif(p_note, ''))
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
    (kind, owner_id, device_token_hash, upload_token_hash, upload_token_expires_at, locale,
     consent_version, handover_location, police_station_note, district, note)
  values
    ('found', p_owner_id, p_device_token_hash, p_upload_token_hash, p_upload_token_expires_at,
     p_locale, p_consent_version, p_handover, p_police_station_note, p_district,
     nullif(p_note, ''))
  returning id into v_batch;

  insert into public.batch_contacts
    (batch_id, line_id, phone, email, show_email_as_contact, notify_email)
  values (v_batch, p_line_id, p_phone, p_email, p_show_email, false);

  return v_batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- Link this device's posts to the signed-in account. Only pairs whose token matches, and
-- only batches no account owns yet. Returns how many were linked.
-- ---------------------------------------------------------------------------
create function public.claim_batches(p_user_id uuid, p_batch_ids uuid[], p_token_hashes text[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.batches b
    set owner_id = p_user_id
    from unnest(p_batch_ids, p_token_hashes) as t(bid, th)
    where b.id = t.bid and b.device_token_hash = t.th and b.owner_id is null
    returning b.id
  )
  select count(*)::integer from claimed;
$$;

-- ---------------------------------------------------------------------------
-- "My posts": the batches proven by this device's tokens plus, when signed in, every batch
-- the account owns. Same columns as before; no contact details.
-- ---------------------------------------------------------------------------
drop function public.my_posts(uuid[], text[]);
create function public.my_posts(p_batch_ids uuid[], p_token_hashes text[], p_user_id uuid default null)
returns table (
  batch_id uuid,
  post_id uuid,
  kind public.post_kind,
  plate_type public.plate_type,
  prefix_digit text,
  letters text,
  number text,
  province_code text,
  status public.post_status,
  created_at timestamptz,
  expires_at timestamptz,
  matches jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with owned as (
    select b.id
    from unnest(p_batch_ids, p_token_hashes) as t(bid, th)
    join public.batches b on b.id = t.bid and b.device_token_hash = t.th
    union
    select b.id from public.batches b where p_user_id is not null and b.owner_id = p_user_id
  )
  select p.batch_id, p.id, p.kind, p.plate_type, p.prefix_digit, p.letters, p.number,
         p.province_code, p.status, p.created_at, p.expires_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('matchId', m.id, 'kind', m.kind, 'createdAt', m.created_at)
                            order by m.created_at desc)
           from public.matches m
           join public.posts other on other.id = case when p.kind = 'lost' then m.found_post_id else m.lost_post_id end
           where (m.lost_post_id = p.id or m.found_post_id = p.id)
             and other.status = 'active'
         ), '[]'::jsonb)
  from public.posts p
  join owned o on o.id = p.batch_id
  order by p.created_at desc;
$$;

-- The signed-in account owns the batch.
create function public.batch_owned_by(p_batch_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.batches where id = p_batch_id and owner_id = p_user_id);
$$;

-- ---------------------------------------------------------------------------
-- Match page roles for a signed-in account: did it post the found plate, the lost one?
-- ---------------------------------------------------------------------------
create function public.match_roles(p_match_id uuid, p_user_id uuid)
returns table (is_finder boolean, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(fb.owner_id = p_user_id, false), coalesce(lb.owner_id = p_user_id, false)
  from public.matches m
  join public.posts l on l.id = m.lost_post_id
  join public.posts f on f.id = m.found_post_id
  join public.batches lb on lb.id = l.batch_id
  join public.batches fb on fb.id = f.batch_id
  where m.id = p_match_id;
$$;

-- ---------------------------------------------------------------------------
-- The finder sees the owner's contact, proven by the found batch's account (the device-token
-- version stays for posts made without signing in). Logged like any reveal.
-- ---------------------------------------------------------------------------
create function public.reveal_owner_contact_for_user(
  p_match_id uuid,
  p_user_id uuid,
  p_ip_hash text
) returns table (line_id text, phone text, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lost_post uuid;
  v_lost_batch uuid;
begin
  select l.id, l.batch_id into v_lost_post, v_lost_batch
  from public.matches m
  join public.posts l on l.id = m.lost_post_id
  join public.posts f on f.id = m.found_post_id
  join public.batches fb on fb.id = f.batch_id
  where m.id = p_match_id
    and l.status = 'active'
    and f.status = 'active'
    and fb.owner_id = p_user_id;
  if not found then
    return;
  end if;

  insert into public.contact_reveals (post_id, match_id, ip_hash)
  values (v_lost_post, p_match_id, p_ip_hash);

  return query
  select c.line_id, c.phone, case when c.show_email_as_contact then c.email end
  from public.batch_contacts c
  where c.batch_id = v_lost_batch;
end;
$$;

revoke all on function public.create_lost_watch(uuid, text, text, text, text, text, text, boolean, boolean, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status, text) from public, anon, authenticated;
revoke all on function public.create_found_batch(uuid, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.claim_batches(uuid, uuid[], text[]) from public, anon, authenticated;
revoke all on function public.my_posts(uuid[], text[], uuid) from public, anon, authenticated;
revoke all on function public.batch_owned_by(uuid, uuid) from public, anon, authenticated;
revoke all on function public.match_roles(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reveal_owner_contact_for_user(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.create_lost_watch(uuid, text, text, text, text, text, text, boolean, boolean, public.plate_type, text, text, text, text, text, text, text, boolean, public.format_status, text) to service_role;
grant execute on function public.create_found_batch(uuid, text, text, timestamptz, text, text, public.handover_location, text, text, text, text, text, boolean, text) to service_role;
grant execute on function public.claim_batches(uuid, uuid[], text[]) to service_role;
grant execute on function public.my_posts(uuid[], text[], uuid) to service_role;
grant execute on function public.batch_owned_by(uuid, uuid) to service_role;
grant execute on function public.match_roles(uuid, uuid) to service_role;
grant execute on function public.reveal_owner_contact_for_user(uuid, uuid, text) to service_role;
