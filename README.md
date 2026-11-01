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

The site shows a yellow banner instead of a raw error **only while you are signed out**. Use **Open Settings** to sign in (or paste a token), or **Retry**. After sign-in the banner hides and every REST call (meetings, sessions, laps, `/location`, `/car_data`, …) sends `Authorization: Bearer <token>`. The app also retries on its own every few minutes until the session ends.

### What each page shows

| Page | What you get |
| --- | --- |
| Track map | Timing tower + circuit outline from `/location`, cars placed by lap progress, sector labels. Race/sprint towers show positions gained/lost vs the grid |
| Timing | Tower with last lap, then Δ versus the previous lap (green −0.215 when faster, red +0.312 when slower; blank on lap 1, a pit in or pit out, or a missing time), best, interval, gap, current lap, then mini-sectors, then full S1/S2/S3 times (purple overall, green personal, yellow otherwise). Mini-sector blocks sit ahead of the sector clocks and stretch so the row fills the page. They light one by one. When the lap finishes, the full row stays up — including the last S3 block — until the first S1 mini-sector of the next lap completes; that block then takes the new colour and the rest of the row clears. If OpenF1 left the first S1 block empty, it still lights once the car is past it: yellow, or green or purple when that S1 time is a personal or overall best. A pit-lane block stays white. Next to each sector time, a green (−) or red (+) figure is the gap to that driver’s same sector on the previous lap. A sector time stays up until the next one finishes. Mini-sectors are grouped into S1, S2, and S3. Weather and the gap line sit in the status bar. Next to each name: positions gained (green ▲) / lost (red ▼) vs `/starting_grid`, or a short white line if unchanged — races and sprints only |
| Telemetry | Up to 4 drivers × a lap each; speed / throttle / brake / gear / rpm / DRS / delta, aligned by distance (`/car_data` joined to `/location`). The drivers list is wider and can be dragged; new drivers open on their fastest complete lap, and every selected driver can jump to one lap number or to their own fastest. Under the notes, Displayed lap time lists the lap time of each trace in that driver’s team colour. Chips hide channels and the rest expand to fill the chart. Overlay draws the selected channels in one panel (normalized, a line style per channel, a color per driver) and is saved in this browser. The bottom brush zooms every trace; double-click resets; corner buttons and the mini map follow the selection |
| Race trace | Gap vs leader, vs average, or vs a chosen driver; pit markers; SC / VSC bands; driver toggles |
| Pit circle | One revolution = one green-flag lap; cars by gap to leader; interval labels; pit ghost for the selected driver |
| Tyres | Degradation model per compound (S/M/H and I/W): offset vs a new Soft, lifespan, linear fade or cliff. Base lap and fuel gain. Sliders, fit from practice long runs or the race so far, lap-time and cumulative-loss charts. Saved in this browser and used by Strategy. |
| Strategy | Same grid-delta badge next to names. The timing tower, pit plans, and undercut/overcut panels are resizable and each one scrolls, so every driver stays reachable. A pointerdown anywhere on a row selects that driver. Clean-lap pace and deg (estimate), leftover tyre sets inferred from weekend `/stints` (estimate), held-up flag, 1/2/3-stop comparison from the Tyres model, pit windows, undercut/overcut panel — all labelled as estimates. A driver with no legal set still gets a pit-now plan and a best alternative |

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
