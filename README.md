# Plate2Home (AWS edition)

A mobile-first web app that reunites people in Thailand with vehicle licence plates lost in
floods. People who **lost** a plate register a watch. People who **found** plates photograph
them; the app finds and reads the plates in the browser and matches them against the watches
instantly. It is non-commercial, posting needs no account, and data is deleted automatically.

This fork runs on **Amazon Web Services** (CS446 final project). Hosting, database, storage,
sign-in and the daily job moved from Vercel + Supabase to AWS. It also adds **email alerts on
a match** (AWS Lambda + Amazon SNS).

> **Deploying it:** follow [`AWS-DEPLOY.md`](AWS-DEPLOY.md). It lists every AWS service used
> and gives the console steps for each one, in order.

## What works today

- **Lost, found, search and match flows** with Turnstile, rate limits and origin checks on every
  write. Lost watches never appear in search; an owner's contact is shown only to the finder of
  a matched found plate that has a photo (see the [threat model](docs/threat-model.md)).
- **Plate reading in the browser** (photos never leave the device until the user confirms a
  crop): a plate finder suggests boxes on the photo, the user confirms each crop, and a small
  CNN trained on synthetic plate lines (`ml/recognizer`) reads the number line. See
  [`docs/ocr-eval.md`](docs/ocr-eval.md).
- **Email alerts (new):** the owner can tick "email me when someone finds this plate". Amazon
  SNS asks them to confirm, and every new match is emailed by the `plate2home-notify` Lambda.
- **Optional sign-in with Amazon Cognito** (Cognito email accounts or Google) to see and manage
  your posts on any device. Without signing in, posts belong to the device that made them.
- **Reports, feedback and an admin area**, Terms of Service and Privacy Policy in Thai and
  English, and a **daily retention job** (EventBridge → Lambda) that really deletes expired data,
  photos and alert subscriptions.

## Stack

Next.js 16 · TypeScript strict · Tailwind CSS 4 · next-intl 4 (Thai default, English at `/en`) ·
**AWS:** EC2 (Node.js 24, systemd) behind CloudFront · RDS for PostgreSQL · S3 · Cognito ·
Lambda (Node.js 22) · SNS · EventBridge Scheduler · Tesseract.js + a custom recognizer ·
Vitest · PGlite for database tests and local development · Playwright.

## Getting started (local, no AWS account needed)

Requirements: Node 24, npm 11.

```bash
npm ci
```

```bash
cp .env.example .env.local
```

In `.env.local` set `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres`,
`DATABASE_SSL=off`, `DATABASE_POOL_MAX=1`, `IP_HASH_SECRET` (any 32+ characters) and leave the
Cognito, S3 and Lambda values empty. Then start a throwaway local Postgres in one terminal:

```bash
npm run db:local
```

and in another terminal:

```bash
npm run db:migrate
```

```bash
npm run dev
```

Open http://localhost:3000 (Thai) or http://localhost:3000/en (English). Lost reports, search
and manage work locally. Uploading found-plate photos needs a real S3 bucket (`S3_BUCKET`,
`AWS_REGION` and AWS credentials).

## Checks

CI (`.github/workflows/ci.yml`) runs all of these on every push; the migration and API
integration tests run against a PostgreSQL 17 service container, like RDS.

| Command                                  | What it does                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run check`                          | Everything below except the build                                                    |
| `npm run lint`                           | ESLint, including the no-hard-coded-text and no-server-env-in-client rules           |
| `npm run typecheck`                      | `next typegen` + `tsc`                                                               |
| `npm run test:unit`                      | Unit tests (plate module, matching, OCR, CSP, env, messages, lint rule, secret scan) |
| `npm run test:db`                        | Migrations + RLS tests. PGlite by default; set `DATABASE_URL` to use a real database |
| `npm run test:integration`               | API flow against real Postgres (`DATABASE_URL`); S3 and Lambda calls intercepted     |
| `npx playwright test`                    | E2E in mobile viewports (needs a running app with a database and S3 bucket)          |
| `npm run check:contrast`                 | WCAG contrast of the design tokens, both themes                                      |
| `npm run check:provinces`                | Province seed migration matches `data/provinces.json`                                |
| `npm run build && npm run check:secrets` | Production build, then scan client files for secrets                                 |

## Project layout

```
app/[locale]/        localized pages (root layout)
app/admin/           admin area (second root layout)
app/api/             route handlers: posting, search, reveal, auth, reports, cron
components/          UI (flows, plate input, OCR overlay, site chrome, theme, ui recipes)
i18n/                next-intl routing, navigation, request config
lib/                 plate module, matching, OCR, auth, config, env, security, db (server-only)
messages/            th.json, en.json
ml/recognizer/       synthetic data, training and export of the plate-text recognizer
supabase/            SQL migrations (applied to RDS by npm run db:migrate), DB tests
aws/                 Lambda functions, EC2 setup/update scripts, RDS platform shim
scripts/             db migrate/local, contrast check, province seed, secret scan, OCR assets
eslint-rules/        project ESLint rules
docs/                plan, architecture, decisions, threat model, OCR evaluation, legal TODOs
```

## Docs

- **[AWS setup guide](AWS-DEPLOY.md)**
- [Plan](docs/plan.md) · [Architecture](docs/architecture.md) · [Decisions](docs/decisions.md)
- [Threat model](docs/threat-model.md) · [Security checklist](docs/security-checklist.md) ·
  [OCR evaluation](docs/ocr-eval.md) · [Plate formats](docs/plate-formats.md) ·
  [Legal TODOs](docs/legal-todo.md)
