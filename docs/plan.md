# Plate2Home — Phase 0 Implementation Plan

Status: **Approved 2026-09-27** with every recommendation in §17 accepted (see `docs/decisions.md`). Phases 1–2 complete.
Date: 2026-09-27

Product name: **Plate2Home** (EN) / **ป้ายกลับบ้าน** (TH, to be confirmed — see Q4). Both live in a single constant `lib/config/brand.ts`.

This document has everything Phase 0 asks for: architecture, schema, access model, threat model, palette and font proposals, model licensing options, the phase plan, and open questions. In Phase 1 it will be split into `docs/architecture.md`, `docs/threat-model.md`, `docs/decisions.md`, and `docs/legal-todo.md`.

---

## 0. What I need from you

The questions are in §17. The ones that block Phase 1 are:

- **Q1 — Model licensing and repo licence.** This changes the ML stack and the repo's LICENSE file.
- **Q2 — Who can see a lost-plate owner's contact.** This is the most important product and safety decision in the app.
- **Q3 — Palette A or B.**
- **Q7 — Docker Desktop.** Local Supabase and the RLS tests need it, and it isn't installed on this machine.

For everything else I've picked a sensible default. Those are listed in §18 and will go into `docs/decisions.md`.

---

## 1. Facts checked today (2026-09-27)

### 1.1 Package versions (latest on npm today; pinned exactly in Phase 1)

| Package | Version | Notes |
|---|---|---|
| next | 16.3.6 | App Router. `middleware.ts` is **deprecated and renamed to `proxy.ts`**, which runs on Node.js by default. |
| react / react-dom | 19.3.0 | |
| next-intl | 4.14.7 | |
| next-themes | 0.4.6 | Accepts a `nonce` prop for its inline script (to confirm in Phase 1). |
| tailwindcss | 4.3.3 | v4 uses CSS-first config (`@theme`). Tokens live in CSS. |
| @supabase/supabase-js | 2.117.2 | |
| @supabase/ssr | 0.12.7 | Admin auth cookies. |
| supabase (CLI) | 2.118.0 | Dev dependency. |
| onnxruntime-web | 1.30.0 | |
| tesseract.js | 7.0.0 | Worker, core, and `tha` language data will be self-hosted, not loaded from a CDN. |
| web-push | 3.6.7 | |
| resend | 6.30.0 | |
| sharp | 0.35.4 | |
| @node-rs/argon2 | 2.2.1 | |
| zod | 4.6.5 | zod 4 API. |
| vitest | 5.0.2 | |
| @playwright/test | 1.63.0 | |
| @axe-core/playwright | 4.13.0 | |

Local toolchain: Node 24.15.0, npm 11.12.1, git 2.54, Python 3.11. **Docker is not installed.**

### 1.2 Platform facts that shape the design

- **Vercel Hobby cron:** cron jobs can run **at most once per day**, and timing is only accurate to the hour (±59 min). So all housekeeping runs as one daily job, and the 7-day expiry reminder is computed inside that job. ([Vercel docs](https://vercel.com/docs/cron-jobs/usage-and-pricing))
- **Supabase API keys:** the new `sb_publishable_…` and `sb_secret_…` keys replace the legacy `anon` and `service_role` JWT keys, which are **deprecated by the end of 2026**. Secret keys bypass RLS and are rejected when sent from a browser. I'll use the new keys from day one; the CI secret-leak check will scan for both key formats. ([Supabase docs](https://supabase.com/docs/guides/api/api-keys))
- **Next.js 16 `proxy.ts`:** the docs say not to rely on Proxy alone for authorization, because a matcher change can silently remove coverage. That matches the spec's rule that admin role checks happen in three places. ([Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy))
- **Thai plate formats:** sources disagree on the motorcycle layout. One says the top line has three consonants and the bottom line has 1–999. Wikipedia says the top line can be an optional digit plus consonants, and the bottom line has up to 4 digits. Both layouts will be supported. The exact rules will be checked against Department of Land Transport (กรมการขนส่งทางบก) material in Phase 2 and written up in `docs/plate-formats.md`. ([Wikipedia](https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_Thailand), [chiangmaiambassador](https://www.chiangmaiambassador.com/license-plates/))

---

## 2. Architecture

### 2.1 Overview

```
 Phone browser (Thai, weak 4G)
 ├─ Next.js pages (RSC, very little client JS on home)
 ├─ Found flow only: Web Worker ── onnxruntime-web (WASM/SIMD)
 │                                  ├─ detector.onnx
 │                                  ├─ recognizer.onnx
 │                                  └─ tesseract.js (tha) fallback
 ├─ Service worker: push, model cache (versioned URLs)
 └─ Turnstile widget (challenges.cloudflare.com)
          │  HTTPS, same-origin JSON / multipart
          ▼
 Vercel (region sin1)
 ├─ proxy.ts ─ locale routing, CSP nonce, /admin session + AAL2 gate
 ├─ Route handlers /api/*  (zod → Origin check → Turnstile → rate limit → DB)
 │    uses lib/db/server.ts  ("server-only", secret key)
 ├─ Admin server actions   (uses the ADMIN'S OWN JWT → RLS enforced)
 └─ /api/cron/daily        (CRON_SECRET)
          │
          ▼
 Supabase (region ap-southeast-1 Singapore)
 ├─ Postgres: RLS on every table, anon/authenticated revoked
 │   pg_trgm (candidate retrieval), pg_cron (small housekeeping)
 ├─ Storage: private bucket "crops", short-lived signed URLs
 └─ Auth: admins only, TOTP MFA, sign-ups disabled
          │
          ├─ web-push → browser push services
          └─ Resend (optional email, double opt-in)
```

### 2.2 Access model

1. **The public never talks to Supabase directly.** The browser has no Supabase client for public flows. Every public read and write goes through a Next.js route handler that returns only safe columns. The publishable key is only used by the admin login page.
2. **Public route handlers use the secret key, but only through one small module.** That module is `lib/db/server.ts`, which starts with `import 'server-only'`. It exposes named functions such as `createLostWatch` and `searchFound`, never a raw client. RLS denies everything to `anon` and `authenticated`, so if the publishable key leaks it is useless.
3. **Admin actions use the admin's own session JWT, not the secret key**, so RLS is a real third enforcement layer for admin. The policies require `app_metadata.role = 'admin'` **and** `aal = 'aal2'`. The only admin operations that use the secret key are Storage deletes and viewing a contact, and both happen only after the in-code role check and the audit-log insert succeed.
4. **Security-sensitive logic lives in Postgres functions** (`SECURITY DEFINER`, `search_path` pinned, `EXECUTE` granted only to `service_role`). These cover rate limiting, PIN lockout bookkeeping, match candidate retrieval, and cascading delete. This keeps the logic atomic and testable.

### 2.3 Request pipeline for every public write

`Origin` or `Sec-Fetch-Site` check → body size cap → zod parse → Turnstile siteverify (where required) → Postgres rate limit (per IP hash and per action) → business logic → return a minimal DTO.

- Errors are returned as `{ code }`. The client maps each code to an i18n message.
- Nothing from the request body is ever logged.

### 2.4 Pages and routes

Thai is at `/`, English at `/en` (next-intl `localePrefix: 'as-needed'`). All routes below exist under both.

| Route | Purpose |
|---|---|
| `/` | Home: two big buttons, search link, 3-step explainer, admin banner. Shows a calm "closed" state in dormant mode. |
| `/lost` | Search first, then a 2-step watch flow if the user reports it lost (D-100, D-101). The step is in `?step=` so the Back button works. The draft is kept in `sessionStorage` (never the PIN). |
| `/found` | Photos → cards → details. This is the only route that loads the ML worker. Crops are kept in IndexedDB so a reload doesn't lose 10 plates. |
| `/search` | Redirects to `/lost`, whose first step is the search (D-101). The query is sent by **POST**, so plates never appear in URLs or logs. |
| `/match/[id]` | Match page. Opened from a notification link. The id is an unguessable UUID. |
| `/manage` | Redirects to My posts (device token or Google account, D-085). |
| `/privacy`, `/terms`, `/request` | Legal pages and the data-subject / forgotten-PIN request form. |
| `/admin/*` | Admin panel. No locale prefix; the locale comes from a cookie. |

| API route | Notes |
|---|---|
| `POST /api/lost` | Create a watch, then run matching synchronously. |
| `POST /api/found/batch` | Turnstile, contact, PIN, and consent. Returns `batchId` plus a 30-minute upload token (only its hash is stored). |
| `POST /api/found/batch/:id/plate` | One plate and one crop per request. Retried individually on weak networks. Runs matching for that plate. |
| `POST /api/search` | |
| `POST /api/reveal` | Turnstile, rate limit, logs the reveal. |
| `POST /api/manage/*` | `auth` (device token or PIN), `resolve`, `extend`, `contact`, `notify`, `delete`. |
| `POST /api/push/subscribe` | |
| `POST /api/email/confirm` | |
| `POST /api/report`, `POST /api/feedback`, `POST /api/request` | |
| `GET /api/health` | Keepalive. |
| `GET /api/cron/daily` | Bearer `CRON_SECRET`. |

**Why found uploads are split into batch + per-plate requests.** Weak mobile data is expected. Uploading 10 crops in one request (up to ~1.5 MB, with Vercel's 4.5 MB body cap) fails as a whole. Uploading per plate means one failed crop is retried alone, and progress is visible per plate.

---

## 3. Directory layout

```
app/
  [locale]/(public)/…        pages above
  admin/…                    admin panel
  api/…                      route handlers
components/
  plate/                     PlateInput, PlateView, ProvinceSheet
  ui/                        own primitives (Button, Field, Sheet, Stepper, Toast…)
  found/                     PhotoPicker, DetectionCard, BoxDrawer, MergeHint
lib/
  config/                    brand.ts, flags.ts, retention.ts, thresholds.ts
  plate/                     formats.config.ts, provinces.ts, normalize.ts, validate.ts,
                             confusables.config.ts, canonical.ts, display.ts
  matching/                  score.ts, candidates.ts, run.ts
  security/                  turnstile.ts, ratelimit.ts, iphash.ts, origin.ts, pin.ts,
                             devicetoken.ts, sanitize.ts, csp.ts, crypto.ts (access log)
  db/                        server.ts (server-only), admin.ts, types.gen.ts
  notify/                    push.ts, email.ts, templates/
  images/                    sharp pipeline (server)
  ml/                        PlateReader interface + client wrappers
workers/
  plate-reader.worker.ts
public/
  sw.js, manifest.webmanifest, models/<version>/*.onnx, tesseract/
messages/                    th.json, en.json
supabase/
  migrations/, seed.sql, tests/ (RLS tests, SQL + Vitest)
ml/
  datasets.md, synth/, train/, export/, eval/, model-cards/
e2e/
docs/
scripts/
  check-client-secrets.mjs, contrast-check.mjs
.github/workflows/
  ci.yml, keepalive.yml
```

---

## 4. Data model

All tables are in `public` with RLS enabled. `anon` and `authenticated` have `REVOKE ALL`, and there are no public policies. Admin policies are described in §5. Enums are Postgres enum types. Every foreign key to `posts` or `batches` uses `ON DELETE CASCADE`.

```sql
provinces(code text pk,            -- ISO 3166-2:TH ('TH-10' Bangkok …) + 'TH-BTG' Betong
          name_th text, name_en text, aliases text[])   -- aliases help OCR snapping
-- Pattaya (TH-S) is excluded: it does not issue its own plates.

batches(id uuid pk, kind post_kind,        -- lost | found
        pin_hash text,                     -- argon2id
        device_token_hash text,            -- sha256 of a 256-bit random token
        upload_token_hash text, upload_token_expires_at timestamptz,
        locale text, consent_version text,
        handover_location handover_loc null, police_station_note text null,
        district text null,
        created_at timestamptz)

batch_contacts(batch_id pk fk, line_id text, phone text, email text,
               show_email_as_contact bool, notify_email bool,
               email_confirmed_at timestamptz null)

push_subscriptions(id uuid pk, batch_id fk, endpoint text unique, p256dh text, auth text,
                   created_at timestamptz)

posts(id uuid pk, batch_id fk, kind post_kind,
      plate_type plate_type,               -- car | motorcycle | other
      prefix_digit text null, letters text, number text, province_code text null fk,
      plate_canonical text,                -- 'car|1|กข|1234|TH-10'
      plate_key text,                      -- prefix+letters+number, confusables folded, '?' kept
      plate_display text,
      has_wildcards bool, format_status format_status,   -- valid | unverified
      ocr_min_confidence real null,
      status post_status,                  -- active | needs_review | hidden | resolved
      review_reason text[],                -- vehicle_check | reports | low_confidence
      crop_path text null,
      report_count int default 0,
      expires_at timestamptz, reminder_sent_at timestamptz null,
      created_at, updated_at)
  index gin (plate_key gin_trgm_ops); index (kind, status, plate_type); index (expires_at)

matches(id uuid pk, lost_post_id fk, found_post_id fk, score real, kind match_kind,   -- exact | near
        created_at, notified_at null, unique(lost_post_id, found_post_id))

reports(id, post_id fk, reason report_reason, note text, ip_hash text, created_at,
        unique(post_id, ip_hash))
contact_reveals(id, post_id fk, match_id fk null, ip_hash, created_at)
feedback(id, rating smallint check (rating between 1 and 5), comment text check (length<=500),
         context text check (context in ('resolved','general')), locale, ip_hash, created_at)
deletion_requests(id, kind text,           -- forgotten_pin | pdpa_access | pdpa_delete
                  plate_canonical text null, message text, contact text,
                  status text, created_at, handled_by uuid null, handled_at null)
rate_limits(bucket text, subject text, window_start timestamptz, hits int,
            primary key (bucket, subject, window_start))
pin_attempts(batch_id pk fk, failures int, locked_until timestamptz null,
             lockout_count int, last_failure_at timestamptz)
site_settings(id int pk check (id = 1), mode site_mode, banner_th text, banner_en text,
              updated_at, updated_by uuid)
daily_stats(day date pk, lost_created int, found_created int, matches int, resolved int)
admin_audit_log(id bigserial, admin_id uuid, action text, target_type text, target_id text,
                details jsonb, created_at)            -- trigger blocks UPDATE/DELETE
access_log(id bigserial, ts, route text, action text, ip_enc bytea, key_version smallint)
                                                      -- only written when the flag is on
```

### 4.1 Changes from the suggested schema (all small; I'll proceed with them unless you object)

- **Contacts and push subscriptions belong to the batch, not the post.** A finder who uploads 10 plates enters one contact and edits it once, and resolving one plate must not delete the contact the other nine still need. A lost watch is a batch with one post, so it behaves exactly as the spec describes. When the last post in a batch is deleted, a trigger deletes the batch and its contacts and subscriptions.
- **Batch-level fields.** The finder answers "where is the plate now" and "district" once per batch in the spec's flow, so those fields move to `batches` as well.
- **`daily_stats`** holds anonymous counters. Resolving a post deletes it for real, so the admin dashboard needs "resolved count" to come from somewhere other than the deleted rows.
- **`plate_key`** stores the confusable-folded key used for trigram retrieval. The TypeScript scorer still sees the raw characters.
- **Real deletion** goes through `delete_post(id)`, a `SECURITY DEFINER` function. It cascades rows and returns the `crop_path`, and the caller then removes the Storage object. If a Storage delete fails, the path goes into a retry list processed by the daily cron. Supabase no longer allows deleting from `storage.objects` in SQL, so the Storage API is the only correct way.

---

## 5. RLS and roles

- For every table: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, `REVOKE ALL ON … FROM anon, authenticated`, and no policies for `anon`.
- Admin policies grant only what the admin UI needs. They are defined using the helper `is_admin_aal2()` = `(auth.jwt()->'app_metadata'->>'role') = 'admin' AND auth.jwt()->>'aal' = 'aal2'`. For example, admins can `SELECT` posts but not contacts. Viewing a contact happens through the audit-logged server path.
- `admin_audit_log`: admins can `INSERT` their own rows. An `UPDATE`/`DELETE` trigger raises an exception for every role except the migration owner.
- **RLS test suite** (`supabase/tests/`, run in CI against `supabase start`). It checks:
  - `anon` gets zero rows or permission denied on every table, especially `batch_contacts`, `batches`, `pin_attempts`, `admin_audit_log`, `access_log`, and `rate_limits`.
  - `anon` cannot call any RPC.
  - A non-admin `authenticated` user gets the same results.
  - An admin at AAL1 is rejected.
  - An admin at AAL2 can do only what the policies allow.
  - The Storage bucket `crops` has no public access.
- **Test for Thai text with pg_trgm.** pg_trgm only treats characters as "word" characters if the database's locale considers them alphanumeric. Phase 1 adds a test proving that trigram similarity works on Thai `plate_key` values on Supabase. If it doesn't, the fallback is to encode each Thai consonant as a stable ASCII-safe token in `plate_key` before indexing, and the fallback is written up in `docs/decisions.md`.

---

## 6. Matching engine

**Trigger.** Matching runs in the same request right after the insert commits: for a lost watch in `POST /api/lost`, and for a found plate in `POST /api/found/batch/:id/plate`. A daily safety-net pass re-matches all active posts.

**Candidate retrieval** (`match_candidates()` RPC). It returns posts of the opposite kind that are active and not hidden, have a compatible `plate_type` (`other` is compatible with everything), and meet either of these:

- `similarity(plate_key, $key_without_wildcards) > cfg.trgmFloor`, or
- `number = $number` (letters are the part OCR most often gets wrong, so an exact number is always a candidate).

Results are capped at 200. Volumes are small (thousands of rows), so recall matters more than precision here; precision comes from the scorer.

**Scoring** (`lib/matching/score.ts`, pure function, unit-tested):

- Weighted Damerau-Levenshtein, computed separately on letters and on number, over Unicode code points.
  - Substitution costs 1.0. A **confusable pair** (from `confusables.config.ts`) costs a configurable lower amount, starting around 0.3.
  - Insertion or deletion costs 1.0.
  - Transposing two digits costs a little less than a substitution.
- A missing leading prefix digit on one side has a small cost, because people often forget the "1" in "1กข".
- `?` matches any single character at zero cost, but each wildcard adds a small uncertainty penalty, so two all-`?` plates never count as "exact".
- **Province:**
  - Both known and equal: bonus.
  - Both known and different: large penalty. This is not an automatic rejection, because OCR can snap to the wrong province.
  - One or both unknown: neutral.
- The result is normalized to a score in 0..1.
  - **exact** = identical prefix, letters, and number, no wildcards, and both provinces known and equal.
  - **near** = score ≥ `cfg.nearThreshold`.
  - Anything else is dropped.
- All weights and thresholds are in `lib/config/thresholds.ts`. A table-driven test file holds realistic pairs, and the thresholds are tuned against those examples rather than picked by guesswork:
  - ข/ช swaps
  - a missing prefix digit
  - 8/0 confusions
  - province unknown vs known
  - motorcycle vs car with the same text
  - wildcard plates
  - completely different plates that happen to share a number

**Writing matches.** Matches are upserted into `matches` (unique on the pair). For a new match, the lost-plate owner is notified (§9) and `notified_at` is set.

---

## 7. Plate module (`lib/plate/`)

- `formats.config.ts` defines each plate type as data: the parts, allowed character classes, and lengths.
  - car: optional prefix digit, 1–2 consonants, 1–4 digits
  - motorcycle: both top-line variants from §1.2, number up to 4 digits (to be confirmed)
  - other: relaxed
- `normalize.ts`: NFC normalization, whitespace and dash removal, Thai digits ๐–๙ → 0–9, Latin look-alikes stripped, and `?` kept.
- `validate.ts` returns `valid` or `unverified` with reasons. It **never blocks** saving.
- `provinces.ts`:
  - The 77 provinces plus Betong, generated from the same seed data as the migration, so there is one source of truth.
  - Fuzzy snapping, used by the Tesseract fallback: normalized Levenshtein over name and aliases, returning "unknown" below a confidence floor.
- `confusables.config.ts`: a symmetric list of pairs and groups (ข/ช, ด/ต, บ/ป, ภ/ถ, ผ/พ/ฟ, ฝ/ฟ, ศ/ส/ษ, ฎ/ฏ, 8/0, 1/7, …) plus the folding map used for `plate_key`.
- **Tests.** Target at least 95% line coverage for this module. The tests include property-based cases (fast-check) for normalization idempotence and for scoring symmetry.

---

## 8. In-browser OCR and ML

### 8.1 Runtime

- `PlateReader` interface: `detect(bitmap) → Box[]`, `recognize(crop) → Reading`. It has three backends, tried in order:
  1. ONNX recognizer
  2. Tesseract.js `tha` (with digits restricted to a whitelist)
  3. Manual entry

  **Phases 3–5 ship with backend 3 only**, and every flow must be complete that way.
- Everything runs in `workers/plate-reader.worker.ts`. Models load lazily when the user enters `/found`, are versioned by URL (`/models/v1/…`), and are cached by the service worker. The first-load message says roughly how large the download is.
- **Multi-threading:** onnxruntime-web needs `SharedArrayBuffer` for threads, and that requires cross-origin isolation (COOP/COEP headers). COEP may break the Turnstile iframe. Plan: try `COEP: credentialless` on `/found` only. If Turnstile or Safari breaks, run single-threaded SIMD. I'll measure both and write down the result instead of assuming.
- CSP will need `'wasm-unsafe-eval'` for WASM and `worker-src 'self' blob:`.
- Per photo:
  1. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })` to apply EXIF orientation.
  2. Downscale so the longest edge is ~2048 px (D-066).
  3. Run the detector, then compute boxes with 10–15% padding, clamped to the image.
  4. Reject crops that are too small, and flag blurry ones (Laplacian variance check).
  5. Run the vehicle check (§8.4).
  6. Run the recognizer.
  7. Re-encode to WebP (≤ 800 px wide, target < 150 KB). This also strips EXIF.
- Cards stream to the UI as each one is ready. Progress is reported per photo.
- **Merge suggestion:** when two cards in the same batch have exact or near keys, suggest merging them (front and rear plates of the same vehicle).

### 8.2 Models — licensing options (Q1, your decision)

Ultralytics YOLO (v5, v8, v11, …) is **AGPL-3.0**, which covers training code, weights we fine-tune from their checkpoints, and the network-served app. YOLOv10 is built on Ultralytics and is AGPL-3.0 as well. YOLOv6, YOLOv7, and YOLOv9 are GPL-3.0.

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **A. Ultralytics + AGPL** | Whole repo released under AGPL-3.0 and kept public. | Best tooling; one-line export to ONNX and INT8. | Copyleft on everything, including forks. Anyone reusing the code (e.g. a government agency) inherits AGPL. |
| **B. Apache/MIT stack (recommended)** | Detector: **YOLOX-Nano/Tiny** (Megvii, Apache-2.0), with D-FINE-N or RT-DETRv2-S (Apache-2.0) as alternates. Recognizer: **fast-plate-ocr** (MIT) trained on a Thai character set. | Permissive. The repo can be MIT (or private). YOLOX is mature, exports to ONNX cleanly, and Nano is tiny. | A bit more training glue to write. The DETR-family options may be slower in WASM. |
| **C. B, plus open-source the repo under MIT or Apache-2.0** | Same stack as B, published publicly. | Good as a portfolio piece; others can reuse it freely. | Must keep secrets and datasets out of the repo, which is required anyway. |

**Recommendation: B, and choose C if you want a public portfolio repo.** Every model and dataset licence gets rechecked in Phase 6 before use and recorded in its model card and in `ml/datasets.md`. That includes any Hugging Face models or Spaces.

### 8.3 Model plan (no numbers are claimed until they're measured)

- **Detector:** YOLOX-Nano, or Tiny if Nano's recall is too low. Starts from the official COCO checkpoints (Apache-2.0).
  - Option 1 (preferred): **one multi-class model** (plate, car, motorcycle, truck/bus) to save a download.
  - Option 2: a plate-only detector plus the stock COCO YOLOX-Nano for vehicles.
  - I'll pick based on measured accuracy and size.
- **Recognizer:** a fast-plate-ocr model (CCT-XS or S) with:
  - a character head over a Thai character set (44 consonants + 10 digits + padding), predicting fixed slots
  - its **region head repurposed as a 78-class province classifier** (77 + Betong, plus "unknown"). Classifying the province is more robust than reading long, small Thai words like "พระนครศรีอยุธยา" character by character. Fuzzy snapping stays in place for the Tesseract fallback.
  - fast-plate-ocr does not explicitly document multi-line plates. Its slot-based output does not depend on left-to-right order, so it may handle the 3-row motorcycle layout. If evaluation shows it doesn't, a row-split step goes before recognition.
- **Data (the hard part):**
  - Public Thai plate datasets are mostly plates **still on vehicles**.
  - Our real input is **detached, muddy, bent, stacked plates** photographed on floors and tables, a domain gap no public dataset covers.
  - Plan: synthetic plates rendered with open-licence fonts, then augmented with mud, water, bends, perspective, low light, and piles of plates, composited onto backgrounds. Then fine-tune on whatever real, properly licensed data exists, and evaluate on a held-out real set.
  - I will not use any dataset whose licence I can't confirm.
- **Quantization:** INT8 static quantization (onnxruntime quantization tools), with FP16 as the fallback if accuracy drops more than an agreed tolerance.
- **Size budget:** under ~10 MB total for all models. The onnxruntime-web WASM binary is a separate multi-MB download; it will be reported separately, not hidden.
- **Deliverables in `ml/`:** dataset notes, synthetic generator, training configs and scripts, export and quantization scripts, a model card per model, and the eval harness. The eval harness reports detection precision and recall, plate exact match, character accuracy, province accuracy, and latency on desktop and on a throttled mobile profile. It writes `docs/ocr-eval.md`.
- **Compute:** training needs a GPU (see Q8). Everything in Phase 6 goes behind the `NEXT_PUBLIC_FEATURE_OCR` flag. If trained weights aren't ready, the app ships with manual entry, and `docs/ocr-eval.md` says exactly what's missing.

### 8.4 Plate-still-on-vehicle check

The warning shows when a plate box lies ≥ 90% inside a vehicle box and that vehicle covers ≥ `cfg.vehicleDominance` of the photo (starting at 25%, tuned during evaluation). If the user proceeds anyway, the post gets `status = 'needs_review'` with `review_reason += 'vehicle_check'`, and it stays out of search until an admin approves it.

---

## 9. Notifications

- **Web Push:** VAPID keys from env, using `web-push`.
  - Subscriptions are stored per batch.
  - Pushes are sent on a new match and 7 days before expiry (from the daily cron).
  - A 404 or 410 response deletes the subscription.
  - The payload contains only a generic message and a `/match/[id]` link: no plate, no location, no contact.
  - A hand-written `public/sw.js` handles push, notification clicks, and the model cache. I'm avoiding a PWA plugin to keep full control of caching and the CSP.
  - `manifest.webmanifest` is needed so the app can be installed on iOS.
- **iOS:** detect iOS Safari when the app isn't installed to the home screen. Show a 3-panel illustrated "Add to Home Screen" guide (drawn as simple SVG) and offer email instead.
- **Email (optional):** Resend, with bilingual plain templates containing only a link.
  - **Double opt-in:** nothing is sent until the address owner clicks a confirmation link. Otherwise an attacker could create watches using a victim's email and flood their inbox.
  - Emails respect free-tier limits; if sending fails, it's logged by error code only and nothing else breaks.
  - **This needs a verified sending domain** (Q5). Until one exists, email is off behind a flag.
- **Match page access:**
  - `/match/[id]` shows the found post's crop, plate, status, and the reveal flow for the **finder's** contact.
  - The **lost owner's** contact is shown only to the verified finder of the matched found post, using that batch's device token or PIN (see Q2).

---

## 10. Security

### 10.1 Controls (each becomes a line in `docs/security-checklist.md`)

- **Secrets:** the secret key is only used in `server-only` modules.
  - `scripts/check-client-secrets.mjs` runs after `next build`. It scans `.next/static/**` and the client manifests for the key's value, for `sb_secret_` / `service_role` patterns, and for the names `SUPABASE_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `IP_HASH_SECRET`, and `ACCESS_LOG_KEY`. It fails CI if any appear.
  - A lint rule forbids `process.env.*` with a non-`NEXT_PUBLIC_` name in any file with `'use client'`.
- **Headers:** set in `proxy.ts` and `next.config`:
  - a strict CSP: nonce for scripts, `'wasm-unsafe-eval'`, `connect-src 'self' https://challenges.cloudflare.com <supabase-url>` (the Supabase URL only for admin auth), `frame-src https://challenges.cloudflare.com`, `img-src 'self' blob: data: <supabase-storage>`, `frame-ancestors 'none'`
  - HSTS (with `preload`)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(self), geolocation=(), microphone=()`
  - **CSP trade-off:** nonce-based CSP forces dynamic rendering. I'll measure the TTFB cost on the home page in Phase 1. If it threatens the Lighthouse ≥ 90 target, I'll evaluate hash-based or SRI alternatives in Next 16 and record the decision.
- **Origin check** on every non-GET API route.
- **Turnstile:** verified server-side on every write and on reveal. The `action` and `hostname` fields in the response are checked. Tokens are single-use.
- **Rate limiting:** the Postgres function `rl_hit(bucket, subject, window_s, max)` does an atomic upsert and returns allowed/denied. Limits live in config, per action and IP hash. pg_cron purges old windows hourly.
- **IP hashing:** the daily salt is `HMAC(IP_HASH_SECRET, 'YYYY-MM-DD')` and the hash is `HMAC(daily_salt, ip)`. The salt rotates automatically and is never stored. Report de-duplication uses a separate **60-day** salt. With a daily salt, one person could report the same post on three days in a row and trigger the auto-hide by themselves.
- **PINs:**
  - argon2id with OWASP-recommended parameters, benchmarked on Vercel in Phase 4.
  - Verification uses the library's constant-time verify.
  - Lockout is per batch: 5 failures lock it for 15 minutes; each repeated lockout doubles the lock (capped at 24 hours).
  - Failures are also rate-limited per IP hash.
  - For plate + PIN access, the user picks lost/found and enters the plate. All candidate batches are checked with a constant number of hash operations, so response timing doesn't reveal how many posts share that plate.
- **Device token:** 256-bit random, stored in `localStorage` as `p2h.devices`, with only its SHA-256 on the server. It's high entropy, so a fast hash is correct here.
- **Uploads:** sharp decodes the image, checks the real format (WebP, JPEG, or PNG) and dimensions (≤ 1200 px, minimum size), strips metadata, and re-encodes to WebP. Files are ≤ 300 KB after processing and stored under random names in a private bucket. Signed URLs expire after 5 minutes.
- **Free-text sanitization** (`lib/security/sanitize.ts`):
  - LINE ID pattern, Thai phone pattern (normalized to `0XXXXXXXXX`), and email via zod.
  - Free-text fields (police station, notes, feedback, report notes) reject URLs, sequences of 10–15 digits (bank- or PromptPay-like), and Thai national-ID-like patterns, each with a friendly explanation.
  - All text is rendered as text (React escaping), never as HTML.
- **Logs:** a tiny logger records only error code, route, and request id. No bodies, no IPs.
- **CI:** `npm audit --omit=dev --audit-level=high`, a committed lockfile, and Dependabot.

### 10.2 Threat model (short version; the full STRIDE table goes in `docs/threat-model.md`)

| # | Threat | Main mitigations |
|---|---|---|
| T1 | **Advance-fee scam:** someone enumerates lost plates and messages owners ("pay the fee and I'll send the plate"). | No public listing. Lost watches are **not** in public search (Q2). The owner's contact is revealed only to the finder of a matched found post that has a photo. Anti-scam modal. Reveal rate limits. Reports. |
| T2 | Fake found posts to harvest owner contacts. | A crop photo is required. Reports with auto-hide. Admin review of low-confidence posts. Per-IP rate limits. The owner sees the crop first. The modal asks for "photo of the plate beside your name". |
| T3 | Contact scraping through the reveal endpoint. | Turnstile, rate limits per IP hash and per post, and reveal logs visible to admins. |
| T4 | PIN brute force. | Lockout plus exponential backoff, per-IP limits, argon2id. A 4-digit PIN at 5 attempts per 15 minutes with doubling takes years to exhaust. |
| T5 | Bot spam or flooding the database (free-tier quotas). | Turnstile on writes, rate limits, body caps, upload caps per batch (max 20 plates). |
| T6 | Privacy harm from photographing plates still on cars (doxxing a car's owner). | Vehicle check → `needs_review`. Report reason. No GPS, district only. District shown only after reveal. |
| T7 | Inappropriate images. | Only crops are uploaded, and the user sees them before submitting. Reports with auto-hide. Admin hide and delete. |
| T8 | Secret key leak. | `server-only`, CI bundle scan, secret keys rejected by browsers, key rotation runbook. |
| T9 | Admin account takeover. | No public sign-up, TOTP MFA, AAL2 required on every request, short sessions, re-auth for destructive actions, audit log. |
| T10 | Notification abuse (email bombing, push spam). | Email double opt-in; notifications fire only on real matches. |
| T11 | Stored XSS or injection. | zod, text-only rendering, parameterized RPCs, strict CSP. |
| T12 | Data retained too long. | 60-day expiry, real deletion, daily cleanup, retention constants in one config file. |

---

## 11. Design system

### 11.1 Direction

Clear Thai civic service meets road signage. Off-white paper background, near-black ink, one confident accent, 1–2 px ink borders, small radii (4–6 px; the plate component uses the real plate's corner radius), generous spacing, and motion only to explain changes in state. The plate is the hero visual element.

### 11.2 Palettes (Q3). Contrast values will be checked by `scripts/contrast-check.mjs` in CI.

**A — "Signal" (recommended):** road-sign amber.

| Token | Light | Dark |
|---|---|---|
| `--bg` (paper) | `#F6F4EE` | `#111214` |
| `--surface` | `#FFFFFF` | `#1A1C1F` |
| `--ink` | `#15171A` | `#EEEAE0` |
| `--ink-muted` | `#4A4F57` | `#A9A59B` |
| `--line` (strong) / `--line-soft` | `#15171A` / `#D9D5CA` | `#EEEAE0` / `#34373C` |
| `--accent` (fill, with ink text on it) | `#F5B700` | `#FFC53D` (text `#111214`) |
| `--accent-ink` (links/text) | `#7A4B00` | `#FFD36B` |
| `--success` | `#1E6B3A` | `#6FD39A` |
| `--danger` | `#B42318` | `#FF8A7A` |
| `--focus` | 2 px ink ring + 2 px amber offset | 2 px amber ring |

Amber is only ever used as a **fill** behind ink text, never as text on white; that combination fails contrast. Primary buttons are an amber fill with ink text and a 2 px ink border.

**B — "Civic":** a deep, government-trust blue, with amber reserved for warnings.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F4F6F5` | `#0E1216` |
| `--surface` | `#FFFFFF` | `#161B21` |
| `--ink` | `#101418` | `#E8EDF2` |
| `--ink-muted` | `#475261` | `#9AA6B4` |
| `--accent` (fill, white text) | `#0B4F8A` | `#2F74B5` |
| `--accent-ink` | `#0B4F8A` | `#8EC0EE` |
| `--warn` (fill) | `#F2B300` | `#FFC53D` |

In both palettes, the **plate component stays white with black text in dark mode**, as a real plate does. In dark mode it gets a soft outer border so it doesn't glare. Both themes are designed by hand, not auto-inverted.

### 11.3 Typography (to be confirmed on Google Fonts / next/font in Phase 1)

- **UI: IBM Plex Sans Thai Looped (body) + IBM Plex Sans Thai (headings, buttons).** Both are OFL and come with a matching Latin design (IBM Plex Sans).
  - Looped letterforms read more easily for older Thai readers, especially at small sizes. Loopless headings give the signage-like, civic feel.
  - Using one family keeps Thai and Latin consistent.
  - Alternative: **Anuphan** (OFL, variable). It's a single file and possibly smaller, but it's loopless only.
- **Plate: Noto Sans Thai Looped** in a condensed width at bold weight, if available. Real Thai plates use a condensed looped typeface. The component falls back gracefully.
- Rules: Thai line-height at least 1.6, body text 17 px (never under 16), no all-caps. Only 2–3 weights are loaded, subset to Thai and Latin. Font download size is part of the performance budget.

### 11.4 Plate input component (`components/plate/`)

- An SVG or HTML frame with the real plate's aspect ratio and a thick black border.
  - Car: `[prefix][letters]  [number]` on top, province below.
  - Motorcycle: 3 rows.
- Each zone is a real `<input>` (for accessibility and the correct mobile keyboard):
  - letters: `inputmode="text"` with a Thai hint and an on-screen **consonant picker sheet** as a fallback (many users don't have a Thai keyboard enabled)
  - number: `inputmode="numeric"`
  - province: opens a searchable bottom sheet (with Thai and Latin search and "ไม่แน่ใจ")
- `?` wildcards are shown as a dashed underlined slot.
- In read-only mode it renders result plates. Low-confidence OCR characters get a subtle amber underline.
- Fully keyboard operable, with labels such as "หมวดอักษร", "เลขทะเบียน", "จังหวัด".

---

## 12. i18n and theming

- next-intl, with Thai as the default at `/` and English at `/en`. The language switcher is in the header, and the choice is persisted in the `NEXT_LOCALE` cookie.
- Messages live in `messages/th.json` and `messages/en.json`. A lint rule plus a test fail the build on hard-coded JSX text or keys missing from either file.
- Thai copy is written natively. Examples:
  - "ถ่ายรูปป้ายที่เจอ แล้วเราจะช่วยหาเจ้าของให้"
  - "ยังไม่มีคนเจอป้ายนี้ เราจะแจ้งเตือนทันทีที่มีคนเจอ"
- Dates use `Intl.DateTimeFormat('th-TH')`, which uses the Buddhist Era by default, and `Intl.RelativeTimeFormat` for relative times.
- next-themes with `defaultTheme="light"` and `enableSystem={false}`, persisted, with the script nonce passed in so there's no flash of the wrong theme.

---

## 13. Lifecycle, cron, dormant mode

- Posts expire after 60 days and can be extended by 30 days. All retention values are in `lib/config/retention.ts`.
- **Daily cron** (`/api/cron/daily`, which Vercel calls at 03:00 ICT ±59 min). Each step is idempotent and chunked so it fits within the function timeout:
  1. Send expiry reminders 7 days before expiry.
  2. Delete expired posts, retry any Storage deletes that failed, and remove orphaned batches.
  3. Purge old reveals (30 days), rate-limit rows, handled deletion requests (30 days after handling), feedback older than 365 days (to be confirmed, LEGAL-TODO), and the access log past its retention period.
  4. Run the matching safety net.
  5. Update `daily_stats`.
- **pg_cron** only does the hourly purge of `rate_limits`, which keeps that hot table small.
- **Dormant mode:**
  - It's `site_settings.mode`, read with a short cache and revalidated on toggle.
  - When dormant, all posting and search APIs return `{ code: 'dormant' }` and the home page shows the "reopens in flood season" message.
  - Retention jobs keep running until the data is gone.
  - **Keepalive:** a GitHub Actions workflow runs every 3 days and pings `/api/health` only while the repo variable `KEEPALIVE=on`. The admin runbook covers flipping that variable together with the dormant switch.
  - The daily cron touches the database too. So once dormant **and** empty, the runbook says to set `CRON_ENABLED=false` (or remove the Supabase project) so the free project can pause.
  - The runbook also covers recreating the project next season: `supabase link` → `supabase db push` → seed → set env vars → create admin users.

---

## 14. Testing and CI

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Vitest (+ fast-check) | plate module, scoring, thresholds, sanitization, PIN lockout state machine, IP hashing, CSP builder |
| Integration | Vitest, local Supabase | every route handler: happy path, invalid input, Turnstile failure (Cloudflare's official **test site keys**), rate limit, wrong PIN, lockout, dormant mode |
| RLS | SQL + Vitest | §5 |
| E2E | Playwright | viewports 360×640 and 390×844 × TH/EN × light/dark, for every flow in spec §15 |
| a11y | @axe-core/playwright | every page; zero serious or critical violations |
| Perf | Lighthouse CI | home and lost flow, with budgets from spec §13 |

**CI** (GitHub Actions): install → lint → typecheck → unit → `supabase start` → integration and RLS tests → build → client secret scan → Playwright → npm audit. Push notifications and email are tested through a fake transport that records sends in a table, so the "notification record" step of the E2E flow is verifiable.

---

## 15. Phases

Each phase ends with lint + typecheck + tests passing, a commit, and a summary.

| Phase | Deliverables | Done when |
|---|---|---|
| **1 Foundation** | `git init`, Next 16 scaffold (strict TS), Tailwind v4 tokens (chosen palette, both themes), fonts, next-intl, next-themes, `proxy.ts` (locale + CSP nonce + headers), brand config, all migrations (tables, enums, RLS, RPC stubs, provinces seed, indexes, pg_trgm/pg_cron), RLS tests, pg_trgm Thai test, `.env.example`, CI workflow, client secret scan, contrast check, `docs/decisions.md`, `docs/legal-todo.md` | CI green; RLS suite proves deny-by-default; a hello page renders TH/EN × light/dark with no theme flash |
| **2 Plate module** | formats config (verified, with sources), normalize, validate, provinces with fuzzy snap, confusables, canonical/key/display, scoring and thresholds, `docs/plate-formats.md` | ≥ 95% coverage on `lib/plate` and `lib/matching/score` |
| **3 Core flows (manual)** | Plate input, province sheet, lost flow, found flow with file upload + manual box drawing + crop pipeline (no ML), sharp validation, Storage, search, candidate RPC, instant matching, match page, Turnstile, rate limits, origin checks | E2E: lost → found → match works with manual entry only |
| **4 Manage and lifecycle** | Reveal with anti-scam modal, device tokens, plate + PIN with lockout and backoff, resolve (→ delete → feedback prompt), extend, edit contact, delete, `delete_post` with Storage cleanup, forgotten-PIN request, daily cron, `daily_stats` | Integration tests for every manage path and lockout case |
| **5 Notifications** | Service worker, manifest, push subscribe and send, 410 cleanup, iOS guide, email double opt-in (flagged), expiry reminders | Notification records verified in E2E; manual check on real Android Chrome |
| **6 OCR** | Worker, `PlateReader`, Tesseract fallback, progressive cards, merge hints, blur check, vehicle check, `ml/` (synthetic data, training, export, quantization, model cards, eval harness), `docs/ocr-eval.md` | App works with the flag on and off; eval report generated from real measurements |
| **7 Trust and safety** | Reports + auto-hide at 3 distinct IP hashes, feedback, admin (MFA, AAL2 in 3 places, dashboard, review queue, post detail with audited contact view, deletion requests, feedback and report lists, mode toggle, banner editor, audit log viewer) | RLS and E2E for admin; audit rows for every action |
| **8 Legal and polish** | Privacy and terms drafts (TH/EN, LEGAL-TODO), PDPA request form, access log (flagged off), a11y audit, performance pass, full E2E matrix | Lighthouse and axe targets met, with results recorded |
| **9 Docs and deploy** | README, deployment guide, admin runbook, security checklist verified, keepalive workflow, Vercel + Supabase production setup guide | A fresh clone can be deployed by following the README |

---

## 16. Risks

1. **OCR accuracy on detached, muddy plates.** There's no public dataset for this domain. Mitigation: build and ship manual entry first, use synthetic data, and report honest evaluation numbers.
2. **Scams remain possible despite mitigations.** Mitigation: the Q2 design, anti-scam copy, reports, and making clear in the terms that the app doesn't verify identities.
3. **Free-tier quotas** (Supabase 500 MB database / 1 GB storage, Resend free limits, Vercel Hobby bandwidth). Mitigation: small WebP crops, deleting data aggressively, and caps per batch.
4. **Nonce CSP vs Lighthouse performance.** To be measured in Phase 1 (§10.1).
5. **Cross-origin isolation vs Turnstile.** WASM threads may not be possible; single-threaded is the fallback.
6. **Legal uncertainty.** Open questions include the lost-property rules in the Civil and Commercial Code, the finder's duty to hand property to police, whether trading state-issued plates privately is allowed, PDPA controller duties, and traffic-data retention under the Computer Crime Act. All are marked LEGAL-TODO; nothing is claimed as legal fact.

---

## 17. Open questions

| # | Question | My recommendation |
|---|---|---|
| **Q1** | Model licensing: A (Ultralytics + AGPL repo), B (Apache/MIT stack, repo licence open), or C (B + public MIT/Apache repo)? | **B**, or **C** if you want it as a public portfolio piece. |
| **Q2** | Who can see a lost-plate owner's contact? | Lost watches **never appear in public search**. The owner's contact is shown only to the finder of a *matched* found post (proven with the batch's device token or PIN). The finder's contact can be revealed by anyone who finds the plate through search, after the anti-scam modal. This closes the biggest scam vector (T1). |
| **Q3** | Palette A "Signal" (amber) or B "Civic" (blue)? | **A.** It ties directly to the plate and road-sign theme and is more distinctive. |
| **Q4** | Thai name: keep "ป้ายกลับบ้าน" alongside "Plate2Home"? Is there a domain? | Keep "ป้ายกลับบ้าน". |
| **Q5** | Email needs a verified domain with Resend (a `*.vercel.app` address can't be verified). Do you have a domain? | Launch with push only and email behind a flag until there's a domain. |
| **Q6** | Should the finder also get a push when a lost watch is created later that matches their found plate? | No for v1: the owner already sees the finder's contact immediately. It's easy to add later. |
| **Q7** | Local Supabase needs Docker Desktop, which isn't installed. Can you install it? The alternative is a second free Supabase project used only for tests, which is slower and shares quotas. | Install Docker Desktop. CI uses Docker on GitHub runners either way. |
| **Q8** | Training compute for Phase 6: do you have an NVIDIA GPU, or should I target Google Colab or Kaggle notebooks? Do you have (or can you collect, with consent) real photos of detached plates for evaluation? | Colab or Kaggle scripts, plus a small consented real evaluation set. |
| **Q9** | GitHub repo: does one exist? Public or private? (This interacts with Q1, and it's needed for CI and keepalive.) | Public if C, otherwise private. |
| **Q10** | Who is the data controller named in the privacy policy (a person or organization, plus a contact email)? | Needed before public launch, not before Phase 1. |
| **Q11** | District input: a dropdown from an open government dataset (data.go.th, licence to be verified) or free text? | A dropdown if the licence allows it. It's more private than free text, which can't stop someone typing a house address. |

---

## 18. Defaults I'll take unless you object (they'll go into `docs/decisions.md`)

1. Supabase in Singapore, Vercel functions in `sin1`.
2. New Supabase key format (publishable and secret) only.
3. Contacts and push subscriptions belong to batches (§4.1).
4. Search is sent by POST so plates never appear in URLs.
5. Found uploads use a batch plus per-plate requests (§2.4), with at most 20 plates per batch.
6. The IP salt is derived daily from a secret, with a separate 60-day salt for de-duplicating reports.
7. Email notifications use double opt-in.
8. Admin lives at `/admin` without a locale prefix.
9. Hand-written service worker; no PWA plugin.
10. Province codes follow ISO 3166-2:TH, plus `TH-BTG` for Betong.
11. The access log is off by default and encrypted with AES-256-GCM using a versioned key.
12. Feedback is kept for 365 days (LEGAL-TODO); reveals for 30 days.
13. Keepalive is gated by a GitHub repo variable, and the dormant-mode runbook covers turning the cron off.
