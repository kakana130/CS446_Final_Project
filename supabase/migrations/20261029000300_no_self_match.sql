-- A person is never matched with themselves (D-091). Posts made by the same Google account
-- (batches.owner_id) are skipped when matches are recorded; posts made signed out on one
-- device are recognised in the browser instead (lib/client/own-posts.ts).

create or replace function public.record_matches(p_matches jsonb)
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
    -- Never match someone with themselves (D-091): both posts made by the same account.
    if exists (
      select 1
      from public.posts l
      join public.batches lb on lb.id = l.batch_id
      join public.posts f on f.id = r.found_post_id
      join public.batches fb on fb.id = f.batch_id
      where l.id = r.lost_post_id
        and lb.owner_id is not null
        and lb.owner_id = fb.owner_id
    ) then
      continue;
    end if;

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
