---
name: sews-dashboard-design
description: Design and data-visualization rules for the SEWS-E Assembly Production dashboard (website/). Use before changing any page, card, chart, colour, font or layout in this repository.
---

# SEWS-E Assembly Production dashboard: design rules

An internal manufacturing analytics dashboard (defects, compliance, safety) for the assembly
production department. Readers: unit leaders, the production manager, team leaders, and shop-floor
screens in presentation mode. The design is **industrial and data-first**: calm, dense, readable.
No marketing effects (no gradients outside the header, no decorative animation, no stock images).

## Data honesty (most important)

- Never show a number that is not in the uploaded data. No invented, rounded-up or sample values.
- **Compare like with like.** A period that is still running is compared with the same days of the
  comparison period. This is done once, in `server/query.js` (`resolvePeriod`); do not bypass it.
- The running week in weekly charts is marked (`partialIndex`: drawn lighter, label `WK47*`, footnote).
  `server/pages.js` → `markPartialWeek` does this for every weekly chart.
- Every KPI card has a period, and a comparison only when the comparison period has data.
- Status colours mean target status only: **red = off target / worse**, **green = on target / better**,
  grey = no target. Do not use red or green for decoration.
- Run `npm test` in `website/` after changing period or comparison logic.

## Colour tokens (`public/css/app.css`, `:root`)

| Token | Light | Use |
|---|---|---|
| `--brand` | `#1C1D96` SEWS-E indigo | Primary bars, primary buttons, active states |
| `--violet` | `#2E008B` | Header gradient end only |
| `--teal` | `#00808C` | Second series, active tab underline, info notes |
| `--green` / `--red` | `#138a43` / `#c81e1e` | Target status only |
| `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--muted` | | Layout |

Dark mode redefines the same tokens (system preference, or the theme button). Never hard-code a
colour in a component; add or reuse a token. Facility colours come from Settings (`facilities.color`).

## Typography

- Font: **IBM Plex Sans** + **IBM Plex Sans Arabic**, self-hosted in `public/fonts/` (SIL OFL).
  No font CDN: the site must work on the plant network.
- Six sizes only: `--t-xs` 12, `--t-sm` 13, `--t-base` 14, `--t-md` 16, `--t-lg` 22, `--t-xl` 28 px.
  Presentation mode (`body.present`) has its own larger sizes.
- Numbers in KPI values, deltas and tables use `font-variant-numeric: tabular-nums`.
- Arabic text (notes, comments) is shown with `dir="rtl"`; keep the English translation alongside.

## Components

- **KPI card** (`cardEl` in `public/js/views.js`): label, value + unit, period, delta vs comparison,
  one detail line. Left border = status. A card always opens a chart.
- **Status strip** (home): count of KPIs off / on target, then one chip per off-target KPI.
- **Top issues** (home): Pareto-first; the largest share comes first, CZCF repeats always on top.
- **Panel** (`panel` in `public/js/charts.js`): title, period, actions (PNG, Data, Excel, enlarge),
  chart, optional note, one-sentence analysis. Every chart carries its data table.
- **Icons**: `icon(name)` in `public/js/util.js` (inline SVG, `currentColor`). Do not use text symbols
  such as ☰ ▶ ◐ ✕ ⬇ for buttons: they render differently on each PC. The ▲ ▼ arrows in deltas are fine.

## Charts (ECharts 5, `public/js/charts.js`)

| Question | Chart |
|---|---|
| Trend over time | Line (daily) or bars (weekly) |
| Compare categories | Sorted bars, horizontal when more than 8 items |
| Biggest contributors | Pareto (bars + cumulative %, 80% line) |
| Process stability | I-MR control chart with spec limits |
| Performance vs target | KPI card + target line |
| Two dimensions | Heatmap |
| Exact values | Table |

Rules:
- Category labels stay horizontal unless they would collide (`needRotate`).
- Value labels only when readable: up to 12 points per line chart, on one series only.
  Labels show integers as is and other values with one decimal.
- Spec limits and targets are full-width reference lines; LSL + USL together get a shaded band.
- Axis names are left-aligned at the axis so they are never cut off.
- Use the chart font from `--font`; colours from the palette (indigo, teal first).

## Layout and responsiveness

- Desktop: header + top nav, sticky filter bar, section side menu, card grid, 2-column chart grid.
- ≤ 900 px: hamburger menu, icon-only side menu, 1-column charts.
- ≤ 560 px: filters fold into one **Filters** button (count of active filters), 2-column cards.
- No horizontal page scroll at 390 px wide. Tap targets at least 36 px.

## Checking a change

1. `cd website && npm test`
2. `npm run seed` then `npm run demo` (demo data in `data/demo.db`, port 8081).
3. Screenshot `/`, `/defects`, `/defects/mislocation`, `/compliance`, `/safety` at 1440 px and 390 px,
   light and dark. Check the browser console for errors.
4. Never commit `node_modules/`, `data/`, `Backups/` or `*.db` (see `.gitignore`).
