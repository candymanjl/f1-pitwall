import { el } from "../lib/dom";
import type { FetchProgress } from "../data/loadProgress";

export type LockState = "live" | null;

/** Loading veil is only for in-flight fetches, never while the live-lock banner is up. */
export function shouldShowLoadingOverlay(loading: string, lock: LockState): boolean {
  return Boolean(loading) && lock == null;
}

/** Load button copy. Stay on "Loading session…" for every in-flight Load, even with a bundle on screen. */
export function loadSessionButtonText(loading: string, _hasBundle = false): string {
  if (loading) return loading.replace(/OpenF1…$/, "…") || "Loading…";
  return "Load";
}

export function loadSessionButtonBusy(loading: string, _hasBundle: boolean, sessionKey: number): boolean {
  if (!sessionKey) return true;
  return Boolean(loading);
}

function renderOverlayBody(host: HTMLElement, text: string, progress: FetchProgress | null): void {
  const title = el("div", { class: "overlay-title", text: text || "Loading…" });
  if (!progress || (progress.total <= 0 && progress.done <= 0)) {
    host.replaceChildren(title);
    host.removeAttribute("aria-busy");
    return;
  }
  const pct = `${progress.pct}%`;
  const label = el("div", { class: "overlay-label", text: progress.label });
  const pctEl = el("div", { class: "overlay-pct", text: pct });
  const meta = el("div", { class: "overlay-meta" }, [label, pctEl]);
  const fill = el("div", { class: "overlay-bar-fill" });
  fill.style.width = pct;
  const bar = el("div", { class: "overlay-bar", role: "progressbar" }, [fill]);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(progress.pct));
  bar.setAttribute("aria-label", `${progress.label} ${pct}`);
  const card = el("div", { class: "overlay-card" }, [title, meta, bar]);
  host.replaceChildren(card);
  host.setAttribute("aria-busy", "true");
}

/**
 * Show or fully disarm a loading/modal veil.
 * Always sets hidden + pointer-events so an author `display: flex` rule
 * cannot leave a transparent layer eating clicks after load/close.
 */
export function applyLoadingOverlay(
  host: HTMLElement,
  show: boolean,
  text = "",
  progress: FetchProgress | null = null,
): void {
  host.hidden = !show;
  host.classList.toggle("is-visible", show);
  host.style.pointerEvents = show ? "auto" : "none";
  host.setAttribute("aria-hidden", show ? "false" : "true");
  if (!show) {
    host.replaceChildren();
    host.removeAttribute("aria-busy");
    return;
  }
  renderOverlayBody(host, text, progress);
}

/** Drop every Settings backdrop so a second open/save cannot leave a blocker. */
export function closeAllModals(root: ParentNode = document): number {
  const nodes = [...root.querySelectorAll(".modal-bg")];
  for (const node of nodes) node.remove();
  return nodes.length;
}
