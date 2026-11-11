-- Align posts constraints with lib/plate/limits.ts: numbers may carry one digit more than any
-- valid format so a slightly wrong reading is stored as `unverified` rather than rejected.
alter table public.posts drop constraint posts_number_check;
alter table public.posts
  add constraint posts_number_check check (number ~ '^[0-9?]{1,5}$');
