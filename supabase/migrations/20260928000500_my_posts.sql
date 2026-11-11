-- "My posts" on this device, and the finder's side of the two-way contact (D-002, D-060).
-- Both authenticate with the device token stored on the phone at posting time (only its
-- SHA-256 is in the database). No Turnstile: the 256-bit token is the proof.

-- Match view now also returns both batch ids, so the page can tell (client-side, from the
-- device tokens it holds) whether the viewer is the owner or the finder.
drop function public.get_match_view(uuid);

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
  lost_note text,
  lost_batch_id uuid,
  found_batch_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.kind, m.score, m.created_at,
         l.plate_type, l.prefix_digit, l.letters, l.number, l.province_code,
         f.id, f.plate_type, f.prefix_digit, f.letters, f.number, f.province_code,
         f.format_status, f.crop_path, f.created_at, fb.handover_location, lb.note, l.batch_id, f.batch_id
  from public.matches m
  join public.posts l on l.id = m.lost_post_id
  join public.posts f on f.id = m.found_post_id
  join public.batches fb on fb.id = f.batch_id
  join public.batches lb on lb.id = l.batch_id
  where m.id = p_match_id
    and l.status = 'active'
    and f.status = 'active';
$$;

-- The finder of a matched found post may see the lost-plate owner's contact. Proven by the
-- found batch's device token. Logged like any reveal.
create function public.reveal_owner_contact(
  p_match_id uuid,
  p_device_token_hash text,
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
    and fb.device_token_hash = p_device_token_hash;
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

-- Posts on this device: each (batch id, token hash) pair must match; returns the posts of
-- those batches with their active matches. No contact details.
create function public.my_posts(p_batch_ids uuid[], p_token_hashes text[])
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

revoke all on function public.get_match_view(uuid) from public, anon, authenticated;
revoke all on function public.reveal_owner_contact(uuid, text, text) from public, anon, authenticated;
revoke all on function public.my_posts(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.get_match_view(uuid) to service_role;
grant execute on function public.reveal_owner_contact(uuid, text, text) to service_role;
grant execute on function public.my_posts(uuid[], text[]) to service_role;
