<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Plate2Home conventions

- Work in the phases of `docs/plan.md`; record small decisions in `docs/decisions.md` and
  anything needing legal confirmation as `LEGAL-TODO(<id>)` + `docs/legal-todo.md`.
- All user-facing text lives in `messages/{th,en}.json` (ESLint `react/jsx-no-literals`
  enforces it). Thai copy is written natively. The product name comes from
  `lib/config/brand.ts` via `{brand}`.
- Only semantic design tokens (`bg-surface`, `text-ink`, …); Tailwind defaults are removed.
  Run `npm run check:contrast` after touching `app/globals.css`.
- The database connection (Amazon RDS) is made only in `lib/db/server.ts`; expose data through narrow
  functions in `lib/db/*`. Every new table needs RLS, explicit grants and tests in
  `supabase/tests/`.
- Regenerate the province seed with `npm run gen:provinces`; never edit it by hand.
- Before committing: `npm run check` (and `npm run build && npm run check:secrets` when
  touching config or env handling).
