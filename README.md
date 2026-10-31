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

1. The header has seven pages: **Track map**, **Timing**, **Telemetry**, **Race trace**, **Pit circle**, **Tyres**, **Strategy**.
2. Use **Year / Meeting / Session** to pick any OpenF1 weekend from 2023 onward.
3. **Play / Pause**, the speed menu, and the scrubber move a replay clock. Every page shows the field as it was at that moment.
4. Click a driver row to select them (pit ghost, strategy model, race-trace reference).
5. **Settings** (top right of the toolbar):
   - **Sign in** with your OpenF1 username and password. The site POSTs to `https://api.openf1.org/token`, caches the `access_token` (1 hour), and refreshes it about 5 minutes before expiry or after a 401.
   - Credentials stay in **this browser** (`localStorage`). They are never committed. You accepted that risk for this static Pages app.
   - **Live** mode uses MQTT over WebSockets (`wss://mqtt.openf1.org:8084/mqtt`) when signed in, and falls back to REST polling if the socket fails.
   - **Advanced** still accepts a pasted bearer token (no auto-refresh).
   - **Pit loss** seconds for Green / VSC / SC.

### If you see “OpenF1 is locked…”

While a live F1 session is on, OpenF1 returns **401** for every endpoint (including past races). Browsers often hide that as **Failed to fetch** because the 401 has no CORS headers.

The site shows a yellow banner instead of a raw error. Use **Open Settings** to sign in (or paste a token), or **Retry**. The app also retries on its own every few minutes until the session ends.

### What each page shows

| Page | What you get |
| --- | --- |
| Track map | Timing tower + circuit outline from `/location`, cars placed by lap progress, sector labels |
| Timing | Tower with last/best, interval, gap, current lap, mini-sector grid, purple/green/yellow sector times, weather and gap line |
| Telemetry | Up to 4 drivers × a lap each; speed / throttle / brake / gear / rpm / DRS / delta, aligned by distance (`/car_data` joined to `/location`), shared cursor + mini map |
| Race trace | Gap vs leader, vs average, or vs a chosen driver; pit markers; SC / VSC bands; driver toggles |
| Pit circle | One revolution = one green-flag lap; cars by gap to leader; interval labels; pit ghost for the selected driver |
| Tyres | Degradation model per compound (S/M/H and I/W): offset vs a new Soft, lifespan, linear fade or cliff. Base lap and fuel gain. Sliders, fit from practice long runs or the race so far, lap-time and cumulative-loss charts. Saved in this browser and used by Strategy. |
| Strategy | Clean-lap pace and deg (estimate), leftover tyre sets inferred from weekend `/stints` (estimate), held-up flag, 1/2/3-stop comparison from the Tyres model, pit windows, undercut/overcut panel — all labelled as estimates |

### Known OpenF1 limits

- `/intervals` exist in **races** (and sprints). Practice and qualifying fall back to **best-lap gaps**.
- Mini-sector colours are often missing in races. Empty cells stay dark.
- The API allows about **3 requests/second** and **30/minute** on the free tier. The app caches responses and spaces calls out.
- Strategy numbers are a **simple transparent model**, not a team prediction.

## Data mode (historical vs live)

Historical sessions need **no login** except while a live F1 session is on (then OpenF1 locks the whole API). Live streaming needs an OpenF1 account.

- Sign-in: Settings → username + password. Stored as `f1pitwall.openf1User` / `f1pitwall.openf1Password`; access token as `f1pitwall.openf1AccessToken`.
- Optional pasted token: `f1pitwall.openf1Token` (backward compatible).
- **Do not commit** credentials or `.env`.

Live mode advances the clock to “now”, then prefers MQTT (`v1/laps`, `v1/position`, …) merging on `_key`, with REST polling as fallback.

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
