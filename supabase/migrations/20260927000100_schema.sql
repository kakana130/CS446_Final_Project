-- Plate2Home core schema.
-- Every table gets RLS in 20260927000300_security.sql. Nothing here is reachable by
-- anon/authenticated until that migration grants (admin-only) access.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.post_kind as enum ('lost', 'found');
create type public.plate_type as enum ('car', 'motorcycle', 'other');
create type public.format_status as enum ('valid', 'unverified');
create type public.post_status as enum ('active', 'needs_review', 'hidden', 'resolved');
create type public.handover_location as enum ('with_finder', 'police_station');
create type public.match_kind as enum ('exact', 'near');
create type public.report_reason as enum (
  'scam', 'inappropriate_image', 'still_on_vehicle', 'personal_data', 'other'
);
create type public.feedback_context as enum ('resolved', 'general');
create type public.request_kind as enum ('forgotten_pin', 'pdpa_access', 'pdpa_delete', 'other');
create type public.request_status as enum ('open', 'in_progress', 'done', 'rejected');
create type public.site_mode as enum ('active', 'dormant');

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.provinces (
  code       text primary key check (code ~ '^TH-([0-9]{2}|[A-Z]{3})$'),
  name_th    text not null unique,
  name_en    text not null unique,
  aliases    text[] not null default '{}',
  sort_order smallint not null unique
);
comment on table public.provinces is
  'ISO 3166-2:TH provinces plus TH-BTG (Betong issues its own plates). Pattaya (TH-S) excluded.';

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------
-- A batch groups the plates from one submission. A lost watch is a batch of one.
-- Credentials (PIN, device token) and contact details live at batch level.
create table public.batches (
  id                      uuid primary key default gen_random_uuid(),
  kind                    public.post_kind not null,
  pin_hash                text not null check (pin_hash ~ '^[$]argon2id[$]'),
  device_token_hash       text check (device_token_hash ~ '^[0-9a-f]{64}$'),
  upload_token_hash       text check (upload_token_hash ~ '^[0-9a-f]{64}$'),
  upload_token_expires_at timestamptz,
  locale                  text not null check (locale in ('th', 'en')),
  consent_version         text not null check (char_length(consent_version) between 1 and 32),
  handover_location       public.handover_location,
  police_station_note     text check (char_length(police_station_note) <= 120),
  district                text check (char_length(district) <= 80),
  created_at              timestamptz not null default now(),
  unique (id, kind),
  -- Finder-only fields.
  check (kind = 'found' or (handover_location is null and police_station_note is null and district is null)),
  check (police_station_note is null or handover_location = 'police_station'),
  check ((upload_token_hash is null) = (upload_token_expires_at is null))
);
create index batches_device_token_idx on public.batches (device_token_hash)
  where device_token_hash is not null;

create table public.batch_contacts (
  batch_id                 uuid primary key references public.batches (id) on delete cascade,
  line_id                  text check (char_length(line_id) between 1 and 40),
  phone                    text check (phone ~ '^0[0-9]{8,9}$'),
  email                    text check (char_length(email) between 3 and 254),
  show_email_as_contact    boolean not null default false,
  notify_email             boolean not null default false,
  email_confirmed_at       timestamptz,
  email_confirm_token_hash text check (email_confirm_token_hash ~ '^[0-9a-f]{64}$'),
  updated_at               timestamptz not null default now(),
  -- At least one contact the other side can actually see.
  check (line_id is not null or phone is not null or (email is not null and show_email_as_contact)),
  check (not notify_email or email is not null),
  check (not show_email_as_contact or email is not null)
);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.batches (id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1024),
  p256dh     text not null check (char_length(p256dh) <= 256),
  auth       text not null check (char_length(auth) <= 64),
  created_at timestamptz not null default now()
);
create index push_subscriptions_batch_idx on public.push_subscriptions (batch_id);

create table public.posts (
  id                 uuid primary key default gen_random_uuid(),
  batch_id           uuid not null,
  kind               public.post_kind not null,
  plate_type         public.plate_type not null,
  prefix_digit       text check (prefix_digit ~ '^[0-9?]$'),
  letters            text not null check (char_length(letters) <= 4),
  number             text not null check (number ~ '^[0-9?]{1,4}$'),
  province_code      text references public.provinces (code),
  plate_canonical    text not null check (char_length(plate_canonical) <= 64),
  -- Confusable-folded prefix+letters+number used for trigram candidate retrieval.
  plate_key          text not null check (char_length(plate_key) between 1 and 16),
  plate_display      text not null check (char_length(plate_display) <= 64),
  has_wildcards      boolean not null default false,
  format_status      public.format_status not null,
  ocr_min_confidence real check (ocr_min_confidence between 0 and 1),
  status             public.post_status not null default 'active',
  review_reason      text[] not null default '{}',
  crop_path          text check (crop_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  report_count       integer not null default 0 check (report_count >= 0),
  expires_at         timestamptz not null default (now() + interval '60 days'),
  reminder_sent_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Kind must agree with the batch.
  foreign key (batch_id, kind) references public.batches (id, kind) on delete cascade,
  unique (id, kind),
  -- Only found posts carry a photo crop.
  check (kind = 'found' or crop_path is null)
);
create index posts_batch_idx on public.posts (batch_id);
create index posts_lookup_idx on public.posts (kind, status, plate_type);
create index posts_number_idx on public.posts (number);
create index posts_expires_idx on public.posts (expires_at);
create index posts_canonical_idx on public.posts (plate_canonical);
create index posts_key_trgm_idx on public.posts using gin (plate_key extensions.gin_trgm_ops);

create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  lost_post_id  uuid not null,
  lost_kind     public.post_kind not null default 'lost' check (lost_kind = 'lost'),
  found_post_id uuid not null,
  found_kind    public.post_kind not null default 'found' check (found_kind = 'found'),
  score         real not null check (score between 0 and 1),
  kind          public.match_kind not null,
  created_at    timestamptz not null default now(),
  notified_at   timestamptz,
  -- Composite FKs guarantee the lost side is a lost post and the found side a found post.
  foreign key (lost_post_id, lost_kind) references public.posts (id, kind) on delete cascade,
  foreign key (found_post_id, found_kind) references public.posts (id, kind) on delete cascade,
  unique (lost_post_id, found_post_id)
);
create index matches_found_idx on public.matches (found_post_id);

-- ---------------------------------------------------------------------------
-- Trust & safety
-- ---------------------------------------------------------------------------
create table public.reports (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  reason     public.report_reason not null,
  note       text check (char_length(note) <= 300),
  ip_hash    text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (post_id, ip_hash)
);

create table public.contact_reveals (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  match_id   uuid references public.matches (id) on delete cascade,
  ip_hash    text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index contact_reveals_post_idx on public.contact_reveals (post_id);
create index contact_reveals_created_idx on public.contact_reveals (created_at);

create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  rating     smallint not null check (rating between 1 and 5),
  comment    text check (char_length(comment) <= 500),
  context    public.feedback_context not null,
  locale     text not null check (locale in ('th', 'en')),
  ip_hash    text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index feedback_created_idx on public.feedback (created_at);

create table public.deletion_requests (
  id              uuid primary key default gen_random_uuid(),
  kind            public.request_kind not null,
  plate_canonical text check (char_length(plate_canonical) <= 64),
  message         text not null check (char_length(message) between 1 and 1000),
  contact         text not null check (char_length(contact) between 1 and 200),
  status          public.request_status not null default 'open',
  created_at      timestamptz not null default now(),
  handled_by      uuid references auth.users (id) on delete set null,
  handled_at      timestamptz
);
create index deletion_requests_status_idx on public.deletion_requests (status, created_at);

-- ---------------------------------------------------------------------------
-- Abuse controls
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  bucket       text not null check (char_length(bucket) <= 64),
  subject      text not null check (char_length(subject) <= 128),
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, subject, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);

create table public.pin_attempts (
  batch_id        uuid primary key references public.batches (id) on delete cascade,
  failures        integer not null default 0 check (failures >= 0),
  locked_until    timestamptz,
  lockout_count   integer not null default 0 check (lockout_count >= 0),
  last_failure_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create table public.site_settings (
  id         smallint primary key default 1 check (id = 1),
  mode       public.site_mode not null default 'active',
  banner_th  text check (char_length(banner_th) <= 280),
  banner_en  text check (char_length(banner_en) <= 280),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.site_settings (id) values (1);

-- Anonymous counters: posts are really deleted, so aggregates must be kept separately.
create table public.daily_stats (
  day           date primary key,
  lost_created  integer not null default 0,
  found_created integer not null default 0,
  matches       integer not null default 0,
  resolved      integer not null default 0
);

-- Storage objects whose post is gone. Filled by trigger, drained by the server and daily cron.
create table public.pending_storage_deletes (
  path       text primary key,
  attempts   integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid not null,
  action      text not null check (char_length(action) <= 64),
  target_type text check (char_length(target_type) <= 32),
  target_id   text check (char_length(target_id) <= 64),
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- LEGAL-TODO(access-log): Computer Crime Act traffic-data retention. Disabled by default
-- (ACCESS_LOG_ENABLED). IP is encrypted with an app key, not hashed, so it can be disclosed
-- lawfully if required.
create table public.access_log (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  route       text not null check (char_length(route) <= 128),
  action      text not null check (char_length(action) <= 64),
  ip_enc      text not null check (char_length(ip_enc) <= 256),
  key_version smallint not null
);
create index access_log_ts_idx on public.access_log (ts);
