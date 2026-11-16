# Assembly Production dashboard: working rules for Claude

Owner: Assembly Unit Leader, SEWS-E (6th of October). Website for defects, compliance and safety KPIs.

## Data rules (always)
- Real data only. Never invent, round up or "fill in" numbers. Label any estimate "Estimate".
- Say plainly when the data cannot prove a root cause.
- Operator IDs only, never names. English in every output.
- Comparisons: a week that is still running is compared with the same days of the previous week
  (implemented in `website/server/query.js`, `resolvePeriod`). Only full weeks are compared week vs week.
- Compliance limit: 15 cases per working day, 90 per 6-day week (Sat–Thu). It is a strict upper limit.
- Never commit real plant data: no `*.xlsx`, `*.db`, `translations-ar.json` or `.env` (see `.gitignore`).

## Project layout
- `website/server/` Node + Express API, SQLite (`node:sqlite`). `pages.js` builds every page as JSON.
- `website/public/` front end (no build step), ECharts charts.
- Security: `server/auth.js` (sign-in, sessions, lockout), `server/store.js` (private storage).
- Design rules: `.claude/skills/sews-dashboard-design/SKILL.md` — read before UI changes.

## Commands
- Tests: `cd website && npm test` (period rules + security tests; must stay green).
- Demo: `cd website && npm run seed && PDA_ADMIN_USER=<user> PDA_ADMIN_PIN=<8+ chars> npm run demo` (port 8081).
- The `xlsx` dependency comes from cdn.sheetjs.com; if that host is blocked, install
  `xlsx@0.18.5` with `--no-save` for local testing only.

## How to work on a request
The master routing skill is `sews-work-system` (in your claude.ai account). The table below only adds
what is specific to this repository.

1. Restate the outcome in one line; pick the skills that fit (see table).
2. Plan, then do the work; split independent parts and run them in parallel.
3. Verify: run the tests, compare numbers against an independent calculation, render and look at
   any file you made (slides, PDF, charts).
4. Report: result first, then method, then weak spots in the data. Short, phone-readable.

| Request | Use |
|---|---|
| Dashboard UI or chart change | `sews-dashboard-design`, `dataviz`, Playwright screenshots, axe |
| Excel analysis or file | `xlsx` skill (formulas, `recalc.py`, cross-check) |
| Management slides | `pptx` skill (max 20 slides, one message per slide, render + validate) |
| Daily compliance / mislocation summary, Kaizen | `sews-assembly-reporting` (needs its scripts) |
| Weekly compliance workbook | `weekly-compliance-analysis` |
| Weekly labor file | `weekly-labor-file-update` |
| Design / spec review | `egm` plugin (`/egm:egm-review`) |
| Automation (Gmail → Notion → WhatsApp) | n8n connector (existing pilot workflows) |
| Code review before merge | `/code-review`, `grill` agents for deep audits |

Approval is needed before: sending email, publishing, deploying, deleting, changing security
settings or credentials, rewriting git history.
