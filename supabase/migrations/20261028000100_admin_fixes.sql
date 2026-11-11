-- Fixes found in review (D-081).
--
-- 1. Restoring a post that reports had hidden kept its report count, so a single new report
--    hid it again at once. Restoring now also clears its reports: the admin has judged it.
-- 2. PIN lockouts doubled forever until a correct PIN, so someone guessing on purpose could
--    keep a real owner locked out for up to 16 hours at a time. The escalation now starts over
--    after 24 quiet hours.

create or replace function public.admin_post_action(p_action text, p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_batch uuid;
begin
  select batch_id into v_batch from public.posts where id = p_post_id;
  if p_action = 'hide' then
    update public.posts set status = 'hidden', updated_at = now()
    where id = p_post_id and status <> 'hidden';
  elsif p_action = 'restore' then
    delete from public.reports where post_id = p_post_id;
    update public.posts
    set status = 'active', review_reason = '{}', report_count = 0, updated_at = now()
    where id = p_post_id and status in ('hidden', 'needs_review');
  elsif p_action = 'dismiss' then
    delete from public.reports where post_id = p_post_id;
    update public.posts set report_count = 0, updated_at = now() where id = p_post_id;
  elsif p_action = 'delete' then
    delete from public.posts where id = p_post_id;
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;

  if p_action = 'delete' and v_batch is not null
     and not exists (select 1 from public.posts where batch_id = v_batch) then
    delete from public.batches where id = v_batch;
  end if;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values ('00000000-0000-0000-0000-000000000001', 'post_' || p_action, 'post', p_post_id::text,
          jsonb_build_object('changed', v_count));
  return v_count;
end;
$$;

create or replace function public.pin_failed(p_batch_id uuid)
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
        lockout_count = case
          when a.last_failure_at < now() - interval '24 hours' then 0
          else a.lockout_count
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
