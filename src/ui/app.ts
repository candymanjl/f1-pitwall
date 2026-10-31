import { LIVE_LOCK_RETRY_MS, SPEEDS } from "../config";
import { hasUsableAuth } from "../data/auth";
import { shouldShowLiveLockBanner } from "../data/errors";
import { PAGES } from "../data/types";
import { el } from "../lib/dom";
import { formatClock } from "../lib/time";
import { applyLoadingOverlay, shouldShowLoadingOverlay } from "./overlays";
import { openSettings } from "./settings";
import { mountStatusBar } from "./statusbar";
import { mountPitCircle } from "../pages/pitcircle";
import { mountRaceTrace } from "../pages/racetrace";
import { mountStrategy } from "../pages/strategy";
import { mountTelemetry } from "../pages/telemetry";
import { mountTiming } from "../pages/timing";
import { mountTrackMap } from "../pages/trackmap";
import { applyUiScale } from "../lib/scale";
import {
  changeMeeting,
  changeSession,
  changeYear,
  reloadAll,
  retryNow,
  setClock,
  setPlaying,
  setSpeed,
  startClock,
  state,
  subscribe,
} from "../state";

type PageMount = { update: () => void };

const mounts: Record<string, (parent: HTMLElement) => PageMount> = {
  trackmap: mountTrackMap,
  timing: mountTiming,
  telemetry: mountTelemetry,
  racetrace: mountRaceTrace,
  pitcircle: mountPitCircle,
  strategy: mountStrategy,
};

export function boot(root: HTMLElement): void {
  applyUiScale(state.uiScale);
  const brand = el("div", { class: "brand" }, [el("span", { class: "bar" }), el("span", { text: "F1" })]);
  const title = el("div", { class: "session-title", text: "F1 PITWALL" });
  const clock = el("div", { class: "session-clock", text: "00:00:00" });
  const brandR = el("div", { class: "brand-right" }, [el("span", { text: "F1" }), document.createTextNode(" TV")]);
  const top = el("header", { class: "topbar" }, [brand, title, clock, brandR]);

  const nav = el("nav", { class: "nav" });
  for (const p of PAGES) {
    nav.append(el("button", { "data-page": p.id, text: p.label }));
  }

  const yearSel = el("select", { id: "year" }) as HTMLSelectElement;
  const meetSel = el("select", { id: "meeting" }) as HTMLSelectElement;
  const sessSel = el("select", { id: "session" }) as HTMLSelectElement;
  const play = el("button", { class: "primary", text: "Play" });
  const speedSel = el("select") as HTMLSelectElement;
  for (const s of SPEEDS) speedSel.append(el("option", { value: String(s), text: `${s}×` }));
  speedSel.value = String(state.speed);
  const scrub = el("input", { type: "range", min: "0", max: "1000", value: "0" }) as HTMLInputElement;
  const elapsed = el("span", { class: "badge", text: "replay" });
  const settingsBtn = el("button", { class: "ghost", text: "Settings" });
  const toolbar = el("div", { class: "toolbar" }, [
    el("label", { text: "Year" }),
    yearSel,
    el("label", { text: "Meeting" }),
    meetSel,
    el("label", { text: "Session" }),
    sessSel,
    el("div", { class: "replay" }, [play, speedSel, scrub, elapsed, settingsBtn]),
  ]);

  const banner = el("div", { class: "lock-banner", role: "status" });
  banner.hidden = true;
  const main = el("main");
  const statusHost = el("div", { class: "statusbar-host" });
  const overlay = el("div", { class: "overlay", text: "Loading OpenF1…" });
  overlay.hidden = true;
  const toast = el("div", { class: "toast" });
  toast.hidden = true;

  root.append(top, nav, toolbar, banner, main, statusHost, overlay, toast);
  const statusApi = mountStatusBar(statusHost);

  let currentPage = "";
  let pageApi: PageMount | null = null;
  let hadBundle = false;

  const syncChrome = () => {
    const meeting = state.bundle?.meeting;
    const session = state.bundle?.session;
    title.textContent = meeting
      ? (meeting.meeting_official_name || `FORMULA 1 ${meeting.meeting_name} ${meeting.year}`).toUpperCase()
      : "F1 PITWALL";
    const sessName = session?.session_name?.toUpperCase() ?? "";
    clock.textContent = `${sessName} / ${formatClock(state.t - state.start)}`;
    play.textContent = state.playing ? "Pause" : "Play";
    const span = Math.max(1, state.end - state.start);
    scrub.value = String(Math.round(((state.t - state.start) / span) * 1000));
    elapsed.textContent =
      state.mode === "live"
        ? state.liveSource === "mqtt"
          ? "live mqtt"
          : state.liveSource === "poll"
            ? "live polling"
            : "live"
        : `replay ${state.speed}×`;
    for (const btn of nav.querySelectorAll("button")) {
      btn.classList.toggle("active", btn.getAttribute("data-page") === state.page);
    }
    applyLoadingOverlay(overlay, shouldShowLoadingOverlay(state.loading, state.lock), state.loading);
    toast.hidden = !state.error || !!state.lock;
    toast.textContent = state.error;
    syncBanner(banner);
  };

  const syncSelects = () => {
    if (!yearSel.options.length) {
      for (const y of [2026, 2025, 2024, 2023]) yearSel.append(el("option", { value: String(y), text: String(y) }));
    }
    yearSel.value = String(state.year);
    meetSel.replaceChildren();
    for (const m of state.meetings) {
      meetSel.append(el("option", { value: String(m.meeting_key), text: m.meeting_name }));
    }
    meetSel.value = String(state.meetingKey);
    sessSel.replaceChildren();
    for (const s of state.sessions) {
      sessSel.append(el("option", { value: String(s.session_key), text: s.session_name }));
    }
    sessSel.value = String(state.sessionKey);
  };

  const renderPage = () => {
    try {
      if (currentPage !== state.page) {
        main.replaceChildren();
        currentPage = state.page;
        pageApi = mounts[state.page](main);
      }
      pageApi?.update();
    } finally {
      syncChrome();
      statusApi.update();
    }
  };

  yearSel.onchange = () => void changeYear(Number(yearSel.value));
  meetSel.onchange = () => void changeMeeting(Number(meetSel.value));
  sessSel.onchange = () => void changeSession(Number(sessSel.value));
  play.onclick = () => setPlaying(!state.playing);
  speedSel.onchange = () => setSpeed(Number(speedSel.value));
  scrub.oninput = () => {
    const span = Math.max(1, state.end - state.start);
    setClock(state.start + (Number(scrub.value) / 1000) * span);
  };
  settingsBtn.onclick = () => openSettings();

  for (const btn of nav.querySelectorAll("button")) {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-page") as typeof state.page;
      currentPage = "";
      state.page = id;
      if (location.hash !== `#${id}`) location.hash = id;
      renderPage();
    });
  }
  window.addEventListener("hashchange", () => {
    const id = location.hash.replace("#", "") as typeof state.page;
    if (!PAGES.some((p) => p.id === id) || id === state.page) return;
    currentPage = "";
    state.page = id;
    renderPage();
  });
  const initial = location.hash.replace("#", "");
  if (PAGES.some((p) => p.id === initial)) state.page = initial as typeof state.page;

  subscribe(() => {
    if (!!state.bundle !== hadBundle) {
      hadBundle = !!state.bundle;
      currentPage = "";
    }
    syncSelects();
    renderPage();
  });

  window.addEventListener("resize", () => {
    applyUiScale(state.uiScale);
    pageApi?.update();
  });
  startClock();
  window.addEventListener("f1pw:open-settings", () => openSettings());
  if (new URLSearchParams(location.search).has("settings")) {
    queueMicrotask(() => openSettings());
  }
  void reloadAll();
}

function syncBanner(banner: HTMLElement): void {
  if (!shouldShowLiveLockBanner(state.lock, hasUsableAuth())) {
    banner.hidden = true;
    return;
  }
  if (!banner.dataset.ready) {
    const settings = el("button", { class: "link", text: "Open Settings" });
    settings.onclick = () => openSettings();
    const retry = el("button", { class: "primary", text: "Retry" });
    retry.onclick = () => void retryNow();
    const count = el("span", { class: "countdown legend" });
    banner.append(
      el("strong", { text: "OpenF1 is locked while a live F1 session is running." }),
      el("p", {
        text: "Until that session ends, unauthenticated REST is blocked. Sign-in still works, but the browser often cannot send the bearer token — OpenF1’s OPTIONS preflight on /v1 returns 401 with no CORS headers. Historical sessions retry without auth; if that also fails, wait for the live session to end.",
      }),
      el("div", { class: "lock-actions" }, [settings, retry, count]),
    );
    banner.dataset.ready = "1";
  }
  banner.hidden = false;
  const remain = Math.max(0, state.retryAt - Date.now());
  const mins = Math.floor(remain / 60000);
  const secs = Math.floor((remain % 60000) / 1000);
  const countdown = remain > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "now";
  const count = banner.querySelector(".countdown");
  if (count) {
    count.textContent = state.loading
      ? "Retrying OpenF1…"
      : `Next automatic retry in ${countdown} (every ${Math.round(LIVE_LOCK_RETRY_MS / 60000)} min).`;
  }
}

