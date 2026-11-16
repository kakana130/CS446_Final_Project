-- Match alerts carry what the owner needs to judge the match from the email itself: the
-- plate as the finder entered it (it differs on a near match), when it was found and where
-- the plate is now. The district and police-station note stay behind the reveal flow, as
-- on the match page. The return type changes, so the function is dropped and recreated.

drop function public.match_alerts(uuid[]);

create function public.match_alerts(p_match_ids uuid[])
returns table (
  match_id            uuid,
  lost_post_id        uuid,
  plate_display       text,
  found_plate_display text,
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
  select m.id, lp.id, lp.plate_display, fp.plate_display, fp.created_at,
         fb.handover_location, b.locale, c.email
  from public.matches m
  join public.posts lp on lp.id = m.lost_post_id
  join public.posts fp on fp.id = m.found_post_id
  join public.batches fb on fb.id = fp.batch_id
  join public.batches b on b.id = lp.batch_id
  join public.batch_contacts c on c.batch_id = b.id
  where m.id = any (coalesce(p_match_ids, '{}'))
    and m.notified_at is null
    and c.notify_email
    and c.email is not null
    and lp.status = 'active' and lp.expires_at > now()
    and fp.status = 'active' and fp.expires_at > now();
$$;

revoke all on function public.match_alerts(uuid[]) from public, anon, authenticated;
grant execute on function public.match_alerts(uuid[]) to service_role;
