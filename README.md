# F1 Pitwall

A dark, F1 TV–style strategy dashboard. It replays **historical** Formula 1 sessions from the free [OpenF1](https://openf1.org/docs) REST API and is published as a **static site** on GitHub Pages — no command line needed to use it once Pages is on.

Default session: **2025 Mexico City Grand Prix — Race**.

## Open the site (no command line)

After the first deploy, the live URL is:

**https://candymanjl.github.io/f1-pitwall/**

If that page is not live yet, turn on GitHub Pages once (below). You only do this in the GitHub website.

### Turn on GitHub Pages (point and click)

1. Open the repository on GitHub: [candymanjl/f1-pitwall](https://github.com/candymanjl/f1-pitwall).
2. Click **Settings** (repository settings, not your account settings).
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
6. Open the **Deploy to GitHub Pages** workflow and click **Run workflow** (or push / merge to `main`). Wait until the run is green.
7. Go back to **Settings → Pages**. The site URL appears at the top when the deploy finishes.

After that, every merge to `main` rebuilds and updates the site automatically.

## Using the dashboard

1. The header has six pages: **Track map**, **Timing**, **Telemetry**, **Race trace**, **Pit circle**, **Strategy**.
2. Use **Year / Meeting / Session** to pick any OpenF1 weekend from 2023 onward.
3. **Play / Pause**, the speed menu, and the scrubber move a replay clock. Every page shows the field as it was at that moment.
4. Click a driver row to select them (pit ghost, strategy model, race-trace reference).
5. **Settings** (top right of the toolbar):
   - **Historical replay** (default) — free, no key.
   - **Live polling** — placeholder for a future paid OpenF1 key. Paste a token here if you have one; it stays in *this browser only* and is never written into the repository.
   - **Pit loss** seconds for Green / VSC / SC, used by the pit circle and the strategy estimates.

### What each page shows

| Page | What you get |
| --- | --- |
| Track map | Timing tower + circuit outline from `/location`, cars placed by lap progress, sector labels |
| Timing | Tower with last/best, interval, gap, current lap, mini-sector grid, purple/green/yellow sector times, weather and gap line |
| Telemetry | Up to 4 drivers × a lap each; speed / throttle / brake / gear / rpm / DRS / delta, aligned by distance (`/car_data` joined to `/location`), shared cursor + mini map |
| Race trace | Gap vs leader, vs average, or vs a chosen driver; pit markers; SC / VSC bands; driver toggles |
| Pit circle | One revolution = one green-flag lap; cars by gap to leader; interval labels; pit ghost for the selected driver |
| Strategy | Clean-lap pace and deg (estimate), leftover tyre sets inferred from weekend `/stints` (estimate), held-up flag, 1/2/3-stop comparison, undercut/overcut panel — all labelled as estimates |

### Known OpenF1 limits

- `/intervals` exist in **races** (and sprints). Practice and qualifying fall back to **best-lap gaps**.
- Mini-sector colours are often missing in races. Empty cells stay dark.
- The API allows about **3 requests/second** and **30/minute** on the free tier. The app caches responses and spaces calls out.
- Strategy numbers are a **simple transparent model**, not a team prediction.

## Data mode (historical vs live)

Historical sessions need **no key**. Live / `latest` data needs a paid OpenF1 token later.

- Token field: in-app **Settings**, stored as `localStorage` key `f1pitwall.openf1Token`.
- Developers can also copy `.env.example` to `.env` and set `VITE_OPENF1_TOKEN` on their own machine. **Do not commit `.env`.**

Live mode currently advances the clock to “now” and keeps the same session bundle. Full live polling / MQTT can be wired to the same data layer when a key is available.

## For developers (optional)

```bash
npm install
npm test
npm run dev
```

Production build (same as Pages):

```bash
npm run build
```

Stack: Vite 6 + TypeScript, no UI framework. Hash routes (`#timing`, `#telemetry`, …) so GitHub Pages does not need a rewrite rule. Layouts are panel components so a later version can add drag / drop / resize.

## Attribution

Timing and telemetry come from [OpenF1](https://openf1.org/). This project is unofficial and not affiliated with Formula 1.
