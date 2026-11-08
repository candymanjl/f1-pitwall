/**
 * Live ticks and live messages must not rebuild the toolbar while a menu is open.
 * The clock, ingest, and car motion keep running; the screen catches up on close.
 */
export function menuHoldActive(doc: Document = document): boolean {
  if (doc.querySelector(".modal-bg")) return true;
  const active = doc.activeElement;
  if (!(active instanceof HTMLSelectElement)) return false;
  return Boolean(active.closest(".toolbar, .modal"));
}

/** Skip `paint` while a toolbar or Settings menu is open. Run it once when the menu closes. */
export function bindMenuHold(doc: Document, paint: () => void): { onUpdate: () => void; dispose: () => void } {
  let dirty = false;
  const release = () => {
    if (menuHoldActive(doc)) return;
    if (!dirty) return;
    dirty = false;
    paint();
  };
  const onFocusOut = () => {
    queueMicrotask(release);
  };
  const onUpdate = () => {
    if (menuHoldActive(doc)) {
      dirty = true;
      return;
    }
    dirty = false;
    paint();
  };
  doc.addEventListener("focusout", onFocusOut);
  const obs = new MutationObserver(() => release());
  obs.observe(doc.body, { childList: true });
  return {
    onUpdate,
    dispose() {
      doc.removeEventListener("focusout", onFocusOut);
      obs.disconnect();
    },
  };
}
