-- Found-post page and the contact-reveal checkpoint (spec §3.5).
-- Contacts are only ever returned by reveal_found_contact, which also logs the reveal.

-- Public view of one found post: plate, photo path, when and where it is now. No contact, no
-- district (both come through the reveal). Nothing unless the post is active and unexpired.
create function public.get_found_post(p_post_id uuid)
returns table (
  post_id uuid,
  plate_type public.plate_type,
  prefix_digit text,
  letters text,
  number text,
  province_code text,
  format_status public.format_status,
  crop_path text,
  created_at timestamptz,
  handover public.handover_location
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.plate_type, p.prefix_digit, p.letters, p.number, p.province_code,
         p.format_status, p.crop_path, p.created_at, b.handover_location
  from public.posts p
  join public.batches b on b.id = p.batch_id
  where p.id = p_post_id
    and p.kind = 'found'
    and p.status = 'active'
    and p.expires_at > now();
$$;

-- Reveal the finder's contact for an active found post and log it (hashed IP) for abuse
-- detection. Email is only included when the finder chose to show it.
create function public.reveal_found_contact(p_post_id uuid, p_ip_hash text)
returns table (
  line_id text,
  phone text,
  email text,
  handover public.handover_location,
  police_station_note text,
  district text
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
         b.handover_location, b.police_station_note, b.district
  from public.batches b
  join public.batch_contacts c on c.batch_id = b.id
  where b.id = v_batch;
end;
$$;

revoke all on function public.get_found_post(uuid) from public, anon, authenticated;
revoke all on function public.reveal_found_contact(uuid, text) from public, anon, authenticated;
grant execute on function public.get_found_post(uuid) to service_role;
grant execute on function public.reveal_found_contact(uuid, text) to service_role;
