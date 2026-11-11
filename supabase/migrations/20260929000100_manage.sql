-- Manage a post from any device with plate number + PIN, or from this device with its token
-- (D-078). PINs are verified in Node (argon2id); these functions only find candidates, count
-- failures (escalating lockout) and apply the owner's action. Service role only.

-- ---------------------------------------------------------------------------
-- Batches that have a post with this plate text (prefix + letters + number, any province).
-- ---------------------------------------------------------------------------
create function public.manage_candidates(p_plate text)
returns table (batch_id uuid, pin_hash text, locked_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct b.id, b.pin_hash, a.locked_until
  from public.posts p
  join public.batches b on b.id = p.batch_id
  left join public.pin_attempts a on a.batch_id = b.id
  where coalesce(p.prefix_digit, '') || p.letters || p.number = p_plate
  limit 20;
$$;

-- ---------------------------------------------------------------------------
-- A wrong PIN for a batch. Five failures within an hour lock it: 15 minutes, doubling with
-- every lockout (capped at 16 hours). Returns the lock end, if locked.
-- ---------------------------------------------------------------------------
create function public.pin_failed(p_batch_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.pin_attempts;
begin
  insert into public.pin_attempts as a (batch_id, failures, last_failure_at)
  values (p_batch_id, 1, now())
  on conflict (batch_id) do update
    set failures = case
          when a.last_failure_at < now() - interval '1 hour' then 1
          else a.failures + 1
        end,
        last_failure_at = now()
  returning * into v;

  if v.failures >= 5 then
    update public.pin_attempts
    set locked_until = now() + interval '15 minutes' * power(2, least(lockout_count, 6)),
        lockout_count = lockout_count + 1,
        failures = 0
    where batch_id = p_batch_id
    returning * into v;
  end if;
  return v.locked_until;
end;
$$;

-- The right PIN: failures and escalation start over.
create function public.pin_succeeded(p_batch_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pin_attempts
  set failures = 0, lockout_count = 0, locked_until = null
  where batch_id = p_batch_id;
$$;

-- ---------------------------------------------------------------------------
-- This device owns the batch (the device token it got when posting).
-- ---------------------------------------------------------------------------
create function public.batch_owned(p_batch_id uuid, p_token_hash text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.batches where id = p_batch_id and device_token_hash = p_token_hash
  );
$$;

-- ---------------------------------------------------------------------------
-- A batch's posts with their matches (same shape as my_posts). No contact details.
-- ---------------------------------------------------------------------------
create function public.batch_posts(p_batch_id uuid)
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
  where p.batch_id = p_batch_id
  order by p.created_at;
$$;

-- ---------------------------------------------------------------------------
-- The owner's action on one post (or the whole batch when p_post_id is null):
--   resolve: the plate is back with its owner; it stops matching and leaves search.
--   extend:  30 more days, at most 90 days after posting (LEGAL-TODO(retention)).
--   delete:  gone now; the batch goes too when its last post does.
-- Returns the number of posts changed.
-- ---------------------------------------------------------------------------
create function public.manage_post(p_batch_id uuid, p_post_id uuid, p_action text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_action = 'resolve' then
    update public.posts
    set status = 'resolved', updated_at = now()
    where batch_id = p_batch_id and (p_post_id is null or id = p_post_id)
      and status in ('active', 'needs_review');
  elsif p_action = 'extend' then
    update public.posts
    set expires_at = least(created_at + interval '90 days', expires_at + interval '30 days'),
        reminder_sent_at = null,
        updated_at = now()
    where batch_id = p_batch_id and (p_post_id is null or id = p_post_id)
      and status in ('active', 'needs_review')
      and expires_at < created_at + interval '90 days';
  elsif p_action = 'delete' then
    delete from public.posts
    where batch_id = p_batch_id and (p_post_id is null or id = p_post_id);
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;

  if p_action = 'delete' and not exists (select 1 from public.posts where batch_id = p_batch_id) then
    delete from public.batches where id = p_batch_id;
  end if;
  return v_count;
end;
$$;

revoke all on function public.manage_candidates(text) from public, anon, authenticated;
revoke all on function public.pin_failed(uuid) from public, anon, authenticated;
revoke all on function public.pin_succeeded(uuid) from public, anon, authenticated;
revoke all on function public.batch_owned(uuid, text) from public, anon, authenticated;
revoke all on function public.batch_posts(uuid) from public, anon, authenticated;
revoke all on function public.manage_post(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.manage_candidates(text) to service_role;
grant execute on function public.pin_failed(uuid) to service_role;
grant execute on function public.pin_succeeded(uuid) to service_role;
grant execute on function public.batch_owned(uuid, text) to service_role;
grant execute on function public.batch_posts(uuid) to service_role;
grant execute on function public.manage_post(uuid, uuid, text) to service_role;
