# CLAUDE.md: Assembly Production Dashboard (SEWS-E)

Internal "Production Data Analysis" website for the Assembly Production Department, SEWS-E 6th of October.
It covers three segments: **Defects**, **Compliance** and **Safety**. Users upload Excel reports, the server
imports them into SQLite, and signed-in users see KPI cards, charts and weekly reports.
Owner: Assembly Unit Leader. Readers: the production manager, unit leaders, team leaders and shop-floor screens.

## Repository layout

```
Dockerfile            Hugging Face Space image (node:24-slim, port 7860, runs server/start.js)
README.md             Space front matter + list of secrets. Keep the YAML header at the top.
scripts/              Windows PowerShell install script for Claude Code tools (not part of the app)
website/              The app. Run all npm commands from here.
  server/             Express API (CommonJS, 'use strict')
    index.js          app, security headers, auth routes, cache, static files, /vendor/*
    start.js          cloud entry: restores the DB from the private store, then requires index.js
    db.js             node:sqlite (DatabaseSync) schema, PATHS, migrations
    importer.js       Excel → rows (templates recognise each file layout)
    calc.js           week numbering, dates, normalisation helpers
    query.js          resolvePeriod: period + like-for-like comparison (single source of truth)
    pages.js          builds every page payload (cards, charts, analysis text), markPartialWeek
    charts.js         server-side chart data builders
    auth.js           users, scrypt passwords, sessions, login limits, ensureAdmin
    store.js          private storage: HF dataset (HF_DATA_REPO + HF_TOKEN) or a folder (PDA_STORE_DIR)
    translate.js      Arabic → English translation table for free-text fields
    defaults.js       built-in import templates, settings, facilities
  public/             Front end: plain ES modules, no build step, no framework
    js/app.js         routing, nav, filter bar, presentation mode
    js/views.js       pages and KPI cards (cardEl)
    js/charts.js      ECharts 5 panels (panel)
    js/util.js        t(), api(), el(), fmt, icon() inline SVGs
    js/i18n/en.js     every UI label (add ar.js later, same keys)
    css/app.css       design tokens on :root, dark mode
    fonts/            IBM Plex Sans + Arabic, self-hosted (no CDN: must work on the plant network)
  scripts/            seed, load-samples, check-samples, backup-now, restore, snapshot
  tests/              node:test (period.test.js, security.test.js)
.claude/skills/sews-dashboard-design/SKILL.md   design + data-viz rules (read before any UI change)
```

## Commands (run in `website/`)

| Task | Command |
|---|---|
| Install | `npm ci` (Node **>= 22.5**, needs `node:sqlite`; Docker uses Node 24) |
| All tests | `npm test` (`node --test "tests/**/*.test.js"`) |
| One test file | `node --test tests/period.test.js` |
| Demo data | `npm run seed` → 12 weeks of generated data in `data/demo.db` |
| Run demo | `PDA_ADMIN_USER=admin PDA_ADMIN_PIN=demo12345 npm run demo` → http://localhost:8081, guests may view |
| Run real | `PDA_ADMIN_USER=... PDA_ADMIN_PIN=... npm start` → port 8080 (`config.json`) or `$PORT` |
| Check WK46 numbers | `npm run check` (needs `../Inputs/Uploads/samples - WK46/`, which is not in the repo) |
| Load WK46 samples | `npm run load-samples ["folder"]` |
| Backup / restore / snapshot | `npm run backup`, `npm run restore`, `npm run snapshot` |

There is no linter, formatter or bundler. Do not add one without asking.

**Cloud session note:** `npm ci` fails here because `xlsx` is installed from `cdn.sheetjs.com`, which the
session proxy blocks. Without `node_modules`, only `tests/period.test.js` runs (it has no npm deps).
`security.test.js`, the server and the scripts need the full install. Say so in the summary; do not swap
the `xlsx` source to the npm registry (the npm `xlsx` package is old and has known vulnerabilities).

## Environment variables

Startup is **refused** without an admin: `PDA_ADMIN_USER` + `PDA_ADMIN_PIN` (at least 8 characters). There are no built-in accounts.

| Variable | Use |
|---|---|
| `PDA_DB` | database file (default `data/production.db`, relative to `website/`) |
| `PORT` | overrides `config.json` port |
| `PDA_ALLOW_GUEST=1` | guests may view without signing in. Plant PC only, **never in the cloud** |
| `HF_DATA_REPO`, `HF_TOKEN` | private HF dataset for the DB, uploads and `translations-ar.json` |
| `PDA_STORE_DIR` | folder store instead of HF (plant server / tests) |
| `PDA_UPLOADS`, `PDA_BACKUPS`, `PDA_TRANSLATIONS` | path overrides |
| `PDA_TRUST_PROXY`, `PDA_COOKIE_SECURE`, `PDA_ORIGIN_CHECK=0`, `PDA_FRAME_ANCESTORS` | proxy / cookie / CSRF / framing |
| `PDA_SESSION_MAX_HOURS` (168), `PDA_SESSION_IDLE_HOURS` (24), `PDA_SAVE_DELAY_MS` (15000) | tuning |

## Code style

- Server: CommonJS, `'use strict'` at the top, `require` with short aliases (`DB`, `IMP`, `PG`, `C`, `AUTH`, `STORE`).
  Front end: native ES modules (`import ... from './util.js'`), with the file extension in imports.
- 2-space indent, single quotes, semicolons. Compact code: short helpers and one-line guards are normal here.
- Comments are plain English sentences that explain *why* (written so a non-developer can follow them).
- SQL: prepared statements with `?` parameters only. Never build SQL from user input.
- UI text goes through `t('key')` with the label in `public/js/i18n/en.js`. No hard-coded labels.
- Colours are CSS tokens in `app.css`; icons use `icon(name)`. No text symbols as button icons.
- Dependencies are few on purpose. Ask before adding a package; prefer Node built-ins (`node:sqlite`, `node:test`, `crypto`).
- Browser libraries are served from `node_modules` through `/vendor/:f` (whitelist in `server/index.js`), never from a CDN.

## Rules that must not be broken

1. **Data honesty.** Never invent, round up or hard-code plant numbers. Only `scripts/seed.js` makes
   generated demo data, and only into `data/demo.db`. Label estimates as estimates.
2. **Like-for-like comparison.** A running period is compared with the same days of the comparison
   period. All of this lives in `server/query.js` → `resolvePeriod`; the running week in weekly charts is
   marked by `markPartialWeek` in `server/pages.js`. Do not bypass either. Run `npm test` after any change.
3. **Status colours mean target status only.** Red = off target / worse, green = on target / better, grey = no target.
4. **Re-importing the same dates replaces them** (no double counting). Keep the importer idempotent.
5. **Never commit private data or secrets:** `*.xlsx`, `*.xls`, `*.db`, `data/`, `Uploads/`, `Backups/`,
   `translations-ar.json`, `.env*` (all in `.gitignore`). Real plant data lives only in the private HF dataset.
6. **Security stays on:** sign-in required, origin check on writes, `no-store` on `/api/`, admin-only
   upload/settings/users. `tests/security.test.js` covers this; extend it when adding a route.
7. Before changing any page, card, chart, colour, font or layout, load the **sews-dashboard-design** skill
   and follow its checking steps (screenshots at 1440 px and 390 px, light and dark; no console errors).

## Workflow

- Develop on the branch the session names; never push to `main` without permission. No PR unless asked.
- Before a big change: inspect, propose a short prioritised plan, get approval. Protect existing behaviour.
- After a change: run tests, seed + run the demo and check the affected pages in the browser (Playwright
  is pre-installed in cloud sessions), then report what was verified and what was not.
- Commit messages: one short imperative summary line in plain English (e.g. "Compare a running week with
  the same days of the previous week"), then a short body if needed.

## How to work with the owner

- Lead with the result, then the method. Keep chat replies short and scannable (often read on a phone).
- Ask **one** question at a time when real data or a decision is missing.
- Use plant terms correctly: WK numbering (Saturday week start, Friday off), shifts 1–3, facilities/lines
  (346D, 130D, 412B, 537D, PSA), CZCF (CPG = Yes), mislocation, rework, critical defects, Pareto-first.
- Operator-facing text: simple Egyptian Arabic with English alongside; management text: clear English.
- Say so plainly when the data cannot prove a cause, or when something could not be tested.
