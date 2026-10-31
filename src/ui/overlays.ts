export type LockState = "live" | null;

/** Loading veil is only for in-flight fetches, never while the live-lock banner is up. */
export function shouldShowLoadingOverlay(loading: string, lock: LockState): boolean {
  return Boolean(loading) && lock == null;
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
