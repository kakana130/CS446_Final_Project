# Security checklist

Each item says **how it is verified**. ✅ = verified by an automated test or check run in CI,
☑️ = verified manually (date), ⏳ = later phase.

## Database

- ✅ RLS enabled on every table in `public`. _(rls.test.ts: "has RLS enabled on every table")_
- ✅ `anon` has zero table privileges. _(rls.test.ts)_
- ✅ `anon` can't select or insert on any table, or call any RPC. _(rls.test.ts)_
- ✅ Non-admin `authenticated` can't read server-only tables and sees zero rows elsewhere. _(rls.test.ts)_
- ✅ An admin at AAL1 is rejected; an admin at AAL2 is limited to whitelisted columns and tables. _(rls.test.ts)_
- ✅ Admins can't read contacts, credentials, push endpoints, rate limits or the access log. _(rls.test.ts)_
- ✅ Every `SECURITY DEFINER` function pins `search_path=''`. _(rls.test.ts)_
- ✅ The audit log is append-only, even for the owner and service_role. _(rls.test.ts)_
- ✅ The `crops` bucket is private and WebP-only. _(rls.test.ts)_
- ✅ Deleting a post really deletes contacts, push subscriptions and matches, and queues the crop for Storage deletion. _(schema.test.ts)_
- ✅ Integrity: a post's kind matches its batch; match sides can't be swapped; at least one visible contact; a batch owner must be a real account. _(schema.test.ts)_
- ✅ CI runs all of the above against a real `supabase start` database (first green run 2026-09-27).
- ✅ `supabase db lint` clean at error level (CI).

## Secrets

- ✅ The Supabase secret key is only used in `lib/db/server.ts` (`import 'server-only'`).
- ✅ ESLint forbids importing `lib/db/server` outside `lib/db/**`.
- ✅ ESLint forbids non-`NEXT_PUBLIC_` env access in `'use client'` files. _(rule + RuleTester tests)_
- ✅ CI builds with canary secrets and scans client bundles and prerendered payloads. _(ci.yml "build" job; scanner unit-tested)_
- ✅ `.env*` is git-ignored except `.env.example`.
- ☑️ Local production build scanned: no secrets in 26 client files (2026-09-27).

## HTTP

- ✅ Nonce-based CSP; no `'unsafe-inline'`/`'unsafe-eval'` for scripts in production; `frame-ancestors 'none'`; `object-src 'none'`. _(csp.test.ts)_
- ☑️ Production server: CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options present; `X-Powered-By` absent; no CSP violations in the console; pre-paint theme script carries the nonce (2026-09-27).
- ✅ Origin header check on every non-GET API route (`apiRoute`; lib/api/route.test.ts, lib/security/security.test.ts).
- ✅ Turnstile server-side verification with action/hostname checks, failing closed (security.test.ts; integration test covers rejection).

## Auth (admin)

- ✅ Local config: sign-ups disabled, TOTP enroll/verify on, 12-character passwords with all character classes, 8 h timebox / 1 h inactivity. _(supabase/config.toml)_
- ⏳ Mirror these settings in the hosted project (runbook, Phase 9).
- ⏳ AAL2 enforced in proxy and in every admin action (Phase 7).

## Supply chain

- ✅ Lockfile committed; exact versions pinned.
- ✅ `npm audit --omit=dev --audit-level=high` in CI.
- ✅ GitHub Actions pinned to commit SHAs; Dependabot for npm and Actions.

## Later phases

- ✅ zod on every input; free-text anti-scam checks (URLs, ID/account numbers, digits in district) (validation.test.ts)
- ✅ sharp re-validation of uploads: real format, pixel limit, min size, EXIF/GPS stripped, WebP ≤ 300 KB (crop.test.ts)
- ✅ No PIN any more (D-085): a post is managed with the device token stored when posting, or by the Google account that owns it. The account is verified with Supabase Auth on every request (`getUser`), and only its id reaches the database functions. Linking a device's posts to an account needs their device tokens and never takes a batch another account owns. _(supabase/tests/manage.test.ts)_
- ✅ Session cookies are httpOnly, SameSite=Lax and Secure on https; sign-in uses PKCE; the post-sign-in redirect accepts only same-site paths (`safeNext`).
- ⏳ IP hashing with rotating salt (Phase 4)
- ✅ Signed URLs ≤ 5 minutes; plain `<img>`, never the image optimizer cache (D-051)
- ✅ No PII in logs: `logError` records scope and error kind only (route.test.ts asserts it)
- ✅ Rate limits wired on lost/found/search/reveal routes (Postgres `rl_hit`; reveal also capped per post)
- ✅ Contact reveal requires the safety acknowledgement + Turnstile, logs every reveal with a hashed IP, and returns nothing for lost watches or hidden/expired posts (posting.test.ts, integration test)
- ✅ Notes are length-capped and reject links, account and ID numbers; the finder's note only comes with a reveal (posting.test.ts)
- ✅ Search never returns lost watches or contacts; match view has no contacts (integration test)
- ✅ Upload token hashed, 30-minute expiry, plate cap enforced under a row lock (posting.test.ts)
- ✅ The admin password is hashed with argon2id m=19 MiB, t=2, p=1 (security.test.ts)

## Admin area (D-080)

- ✅ Password stored only as an argon2id hash (env); session is an HMAC-signed, httpOnly, SameSite=Strict cookie, 12 h. _(lib/admin/session.test.ts)_
- ✅ Login rate limited per IP (5/15 min) and globally (30/h); logins, failures and actions logged append-only. _(supabase/tests/admin.test.ts, tests/integration/flow.test.ts)_
- ✅ Every admin page and action re-checks the session server-side; same-origin check on every POST.
- ✅ Admin views never show contact details; IPs only as 8-character daily-salted hash prefixes.
- ⏳ Consider replacing the single password with Supabase Auth + 2FA when there is more than one operator.
