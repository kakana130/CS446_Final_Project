-- Triggers and server-side RPCs. All SECURITY DEFINER functions pin search_path to ''
-- and are executable only by service_role (see 20260927000300_security.sql).

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();
create trigger batch_contacts_set_updated_at before update on public.batch_contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Real deletion: when a post goes (directly, by cascade, or by expiry), queue its crop
-- for Storage deletion and drop the batch once it has no posts left.
-- ---------------------------------------------------------------------------
create function public.on_post_deleted() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.crop_path is not null then
    insert into public.pending_storage_deletes (path) values (old.crop_path)
    on conflict (path) do nothing;
  end if;

  delete from public.batches b
  where b.id = old.batch_id
    and not exists (select 1 from public.posts p where p.batch_id = old.batch_id);

  return old;
end;
$$;

create trigger posts_after_delete after delete on public.posts
  for each row execute function public.on_post_deleted();

-- ---------------------------------------------------------------------------
-- Append-only audit log.
-- ---------------------------------------------------------------------------
create function public.forbid_audit_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger admin_audit_log_no_update before update or delete on public.admin_audit_log
  for each row execute function public.forbid_audit_mutation();
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log
  for each statement execute function public.forbid_audit_mutation();

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiter. Atomic: one upsert per call.
-- ---------------------------------------------------------------------------
create function public.rl_hit(
  p_bucket text,
  p_subject text,
  p_window_seconds integer,
  p_max integer
) returns table (allowed boolean, hits integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_window_seconds <= 0 or p_max <= 0 then
    raise exception 'invalid rate limit parameters';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as rl (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_window, 1)
  on conflict (bucket, subject, window_start)
  do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  return query select v_hits <= p_max, v_hits, v_window + make_interval(secs => p_window_seconds);
end;
$$;

-- ---------------------------------------------------------------------------
-- Candidate retrieval for matching. Recall-oriented: the TypeScript scorer does precision.
-- Returns active posts of the opposite kind whose key is trigram-similar or whose number
-- is identical (letters are the part most often misread).
-- ---------------------------------------------------------------------------
create function public.match_candidates(
  p_kind public.post_kind,
  p_plate_type public.plate_type,
  p_key text,
  p_number text,
  p_floor real default 0.2,
  p_limit integer default 200
) returns table (
  id uuid,
  batch_id uuid,
  plate_type public.plate_type,
  prefix_digit text,
  letters text,
  number text,
  province_code text,
  has_wildcards boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('pg_trgm.similarity_threshold', p_floor::text, true);

  return query
  select p.id, p.batch_id, p.plate_type, p.prefix_digit, p.letters, p.number,
         p.province_code, p.has_wildcards
  from public.posts p
  where p.kind <> p_kind
    and p.status = 'active'
    and (p_plate_type = 'other' or p.plate_type = 'other' or p.plate_type = p_plate_type)
    and (
      p.plate_key operator(extensions.%) replace(p_key, '?', '')
      or p.number = p_number
      or p.has_wildcards
    )
  order by extensions.similarity(p.plate_key, replace(p_key, '?', '')) desc
  limit least(p_limit, 500);
end;
$$;
