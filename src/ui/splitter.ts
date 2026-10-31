import { el } from "../lib/dom";

export const TOWER_SPLIT_STORAGE_KEY = "f1pitwall.towerSplitRem";
export const TOWER_SPLIT_DEFAULT_REM = 36;
export const TOWER_SPLIT_MIN_REM = 24;
export const TOWER_SPLIT_MAX_REM = 56;

export type SplitStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function defaultStore(): SplitStore | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode */
  }
  return null;
}

export function clampTowerSplitRem(n: number): number {
  if (!Number.isFinite(n)) return TOWER_SPLIT_DEFAULT_REM;
  return Math.min(TOWER_SPLIT_MAX_REM, Math.max(TOWER_SPLIT_MIN_REM, n));
}

export function readTowerSplitRem(store: SplitStore | null = defaultStore()): number {
  if (!store) return TOWER_SPLIT_DEFAULT_REM;
  try {
    const raw = store.getItem(TOWER_SPLIT_STORAGE_KEY);
    if (raw == null || raw === "") return TOWER_SPLIT_DEFAULT_REM;
    return clampTowerSplitRem(Number(raw));
  } catch {
    return TOWER_SPLIT_DEFAULT_REM;
  }
}

export function writeTowerSplitRem(n: number, store: SplitStore | null = defaultStore()): number {
  const v = clampTowerSplitRem(n);
  try {
    store?.setItem(TOWER_SPLIT_STORAGE_KEY, String(v));
  } catch {
    /* quota / private mode */
  }
  return v;
}

export function applyTowerSplit(page: HTMLElement, rem: number): void {
  page.style.setProperty("--tower-split", `${clampTowerSplitRem(rem)}rem`);
}

export function mountTowerSplitter(
  page: HTMLElement,
  opts: { onResize?: () => void; store?: SplitStore | null } = {},
): { handle: HTMLElement; widthRem: () => number } {
  const store = opts.store === undefined ? defaultStore() : opts.store;
  let rem = readTowerSplitRem(store);
  applyTowerSplit(page, rem);

  let handle = page.querySelector<HTMLElement>(":scope > .splitter");
  if (!handle) {
    handle = el("div", {
      class: "splitter",
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "Resize timing tower",
    });
    handle.tabIndex = 0;
    const second = page.children[1];
    if (second) page.insertBefore(handle, second);
    else page.append(handle);
  }

  let drag: { startX: number; startRem: number } | null = null;

  const onMove = (ev: PointerEvent) => {
    if (!drag) return;
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    rem = writeTowerSplitRem(drag.startRem + (ev.clientX - drag.startX) / rootPx, store);
    applyTowerSplit(page, rem);
    opts.onResize?.();
  };
  const onUp = (ev: PointerEvent) => {
    if (!drag) return;
    drag = null;
    handle.classList.remove("dragging");
    try {
      handle.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
  };

  handle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    drag = { startX: ev.clientX, startRem: rem };
    handle.classList.add("dragging");
    handle.setPointerCapture(ev.pointerId);
  });
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);

  return { handle, widthRem: () => rem };
}
