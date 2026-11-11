# Architecture

This describes the system as built. The full design rationale and the phase plan are in
[`plan.md`](plan.md); individual decisions are in [`decisions.md`](decisions.md).

## Overview

Hosted on AWS (D-105; setup in [`AWS-DEPLOY.md`](../AWS-DEPLOY.md)):

```
Phone browser ──HTTPS──▶ CloudFront ──HTTP:3000──▶ EC2: Next.js (systemd)
 • RSC pages (th at /,                              • proxy.ts: locale, CSP nonce
   en at /en)                                       • Route handlers /api/*
 • Found flow only:                                   (zod → Origin → Turnstile → rate limit → DB)
   Web Worker + ONNX                                • lib/db/server.ts ─▶ RDS PostgreSQL
 • Crops shown via                                  • lib/db/storage.ts ─▶ S3 (private bucket)
   presigned S3 URLs                                • lib/auth/session.ts ─▶ Cognito (OAuth + PKCE)
                                                    • lib/notify ─▶ Lambda plate2home-notify ─▶ SNS
EventBridge (daily) ─▶ Lambda plate2home-cleanup ─▶ CloudFront ─▶ /api/cron/retention
```

The public never talks to the database directly. Every public read and write goes through a
Next.js route handler that returns only safe columns. The app connects to RDS as the schema
owner; the RLS policies and API-role grants from the original Supabase design stay in place as
defence in depth.

## Access model

| Role                                                             | Can do                                                                                                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anon`                                                           | Nothing: no table grants, no function EXECUTE.                                                                                                                                |
| `authenticated` (non-admin)                                      | Nothing (public sign-ups are disabled anyway).                                                                                                                                |
| `authenticated` + `app_metadata.role = 'admin'` + `aal = 'aal2'` | Read moderation tables; update a few whitelisted columns; append to the audit log as itself. Can't read contacts, credentials, push endpoints, rate limits or the access log. |
| `service_role` (server only)                                     | Everything via RLS bypass, but only through named functions in `lib/db/*`. ESLint forbids importing the raw client anywhere else.                                             |

The admin role is enforced in three places: `proxy.ts`, every admin action/route (Phase 7),
and RLS (`public.is_admin_aal2()`).

## Request pipeline (public writes, from Phase 3)

Origin check → body size cap → zod → Turnstile siteverify → `rl_hit()` rate limit →
business logic → minimal DTO. Errors are returned as `{ code }` and mapped to i18n messages on
the client. Request bodies are never logged.

## Data model

See `supabase/migrations/`. Key points:

- **`batches`** group one submission. They hold the owner account (optional Google sign-in,
  D-085), the SHA-256 of the device token, and finder-only fields. A lost watch is a batch with one post.
- **`batch_contacts`** and **`push_subscriptions`** belong to the batch.
- **`posts`**: `(batch_id, kind)` is a composite FK to `batches (id, kind)`, so a post's kind
  always agrees with its batch. `plate_key` is the confusable-folded key used for trigram
  candidate retrieval.
- **`matches`**: composite FKs guarantee the lost side is a lost post and the found side a
  found post; unique per pair.
- **Real deletion:** deleting a post queues its crop in `pending_storage_deletes` and drops
  the batch (with its contacts and push subscriptions) once it has no posts left.
- **Aggregates** go in `daily_stats`, because posts are really deleted.
- **`admin_audit_log`** is append-only (triggers block UPDATE/DELETE/TRUNCATE for everyone).
- **`access_log`** exists but is disabled by default (LEGAL-TODO).

## Frontend

- **Routing:** `app/[locale]/…` is the root layout (with `next/root-params`).
  `app/global-not-found.tsx` handles URLs outside any locale. Admin will be a second root
  layout at `app/admin`.
- **i18n:** next-intl. Messages are in `messages/{th,en}.json`, typed through `global.d.ts`.
  ESLint (`react/jsx-no-literals`) rejects hard-coded JSX text; a test enforces key parity
  between the two languages.
- **Theme:** `data-theme` on `<html>`, set before paint by `themeInitScript` (nonce'd).
  Light is the default regardless of OS setting.
- **Design tokens:** `app/globals.css` (raw `--p-*` values per theme mapped to semantic
  Tailwind colours). Tailwind's defaults are removed. `npm run check:contrast` verifies WCAG
  ratios for both themes.

## Security headers

- **Static** (`next.config.ts` → `lib/security/headers.ts`): HSTS, nosniff,
  `Referrer-Policy`, `Permissions-Policy` (camera self only), `X-Frame-Options`, COOP. API
  routes also get `default-src 'none'` and `no-store`.
- **Per request** (`proxy.ts` → `lib/security/csp.ts`): a nonce-based CSP with
  `'strict-dynamic'` and `'wasm-unsafe-eval'`, plus Turnstile and the Supabase origin only.

## Environment

All variables are documented in `.env.example` and validated by `lib/env/server.ts` (zod).
Only error names are reported, never values. CI builds with unique canary values for every
secret, and `scripts/check-client-secrets.mjs` fails if any canary, any secret variable name,
an `sb_secret_` key, or a service_role JWT appears in a client-delivered file.
