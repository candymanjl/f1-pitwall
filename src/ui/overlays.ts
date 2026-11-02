export type LockState = "live" | null;

/** Loading veil is only for in-flight fetches, never while the live-lock banner is up. */
export function shouldShowLoadingOverlay(loading: string, lock: LockState): boolean {
  return Boolean(loading) && lock == null;
}

/** Load button copy. Once a session is on screen, never keep "Loading session…". */
export function loadSessionButtonText(loading: string, hasBundle: boolean): string {
  if (loading && !hasBundle) return loading.replace(/OpenF1…$/, "…") || "Loading…";
  return "Load";
}

export function loadSessionButtonBusy(loading: string, hasBundle: boolean, sessionKey: number): boolean {
  if (!sessionKey) return true;
  return Boolean(loading) && !hasBundle;
}

/**
 * Show or fully disarm a loading/modal veil.
 * Always sets hidden + pointer-events so an author `display: flex` rule
 * cannot leave a transparent layer eating clicks after load/close.
 */
export function applyLoadingOverlay(el: HTMLElement, show: boolean, text = ""): void {
  el.hidden = !show;
  el.classList.toggle("is-visible", show);
  el.style.pointerEvents = show ? "auto" : "none";
  el.setAttribute("aria-hidden", show ? "false" : "true");
  el.textContent = show ? text : "";
}

/** Drop every Settings backdrop so a second open/save cannot leave a blocker. */
export function closeAllModals(root: ParentNode = document): number {
  const nodes = [...root.querySelectorAll(".modal-bg")];
  for (const node of nodes) node.remove();
  return nodes.length;
}
