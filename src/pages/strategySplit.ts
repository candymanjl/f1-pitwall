import { el } from "../lib/dom";

const MAIN_KEY = "f1pitwall.strategyMainFr";
const CUTS_KEY = "f1pitwall.strategyCutsFr";

/** Share of the flexible span, stored as fr versus the other side. */
export function frAgainstRest(share: number): number {
  const clamped = Math.min(0.82, Math.max(0.18, share));
  return clamped / (1 - clamped);
}

export function shareFromPointer(pointer: number, origin: number, span: number, min: number, max: number): number {
  const spanSafe = Math.max(1, span);
  const raw = (pointer - origin) / spanSafe;
  return Math.min(max, Math.max(min, raw));
}

function readFr(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw == null || raw === "" ? fallback : Number(raw);
    return Number.isFinite(n) && n > 0.15 && n < 8 ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeFr(key: string, n: number): void {
  try {
    localStorage.setItem(key, n.toFixed(3));
  } catch {
    /* private mode */
  }
}

function bindDrag(handle: HTMLElement, axis: "x" | "y", onPointer: (client: number) => void): void {
  const move = (ev: PointerEvent) => onPointer(axis === "x" ? ev.clientX : ev.clientY);
  const end = (ev: PointerEvent) => {
    handle.classList.remove("dragging");
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    try {
      handle.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
  };
  handle.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    handle.classList.add("dragging");
    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {
      /* window listeners still follow */
    }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
}

/**
 * Strategy-only splitters. The shared tower splitter stays on Track map and Pit circle.
 * Horizontal handle sets the plans column. Vertical handle sets the undercut panel.
 */
export function mountStrategyLayout(
  page: HTMLElement,
  tower: HTMLElement,
  cuts: HTMLElement,
  plans: HTMLElement,
): void {
  const main = el("div", { class: "strat-main" });
  const y = el("div", {
    class: "strat-split y",
    role: "separator",
    "aria-orientation": "horizontal",
    "aria-label": "Resize undercut panel",
  });
  const x = el("div", {
    class: "strat-split x",
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize strategy plans",
  });
  y.tabIndex = 0;
  x.tabIndex = 0;
  main.append(tower, y, cuts);
  page.append(main, x, plans);

  let mainFr = readFr(MAIN_KEY, 1.35);
  let cutsFr = readFr(CUTS_KEY, 0.42);
  const applyMain = () => page.style.setProperty("--strat-main", `${mainFr.toFixed(3)}fr`);
  const applyCuts = () => main.style.setProperty("--strat-cuts", `${cutsFr.toFixed(3)}fr`);
  applyMain();
  applyCuts();

  const dragMain = (clientX: number) => {
    const rect = page.getBoundingClientRect();
    const handle = x.getBoundingClientRect().width || 8;
    const span = Math.max(1, rect.width - handle);
    const share = shareFromPointer(clientX, rect.left, span, 0.4, 0.78);
    mainFr = frAgainstRest(share);
    writeFr(MAIN_KEY, mainFr);
    applyMain();
  };
  const dragCuts = (clientY: number) => {
    const rect = main.getBoundingClientRect();
    const handle = y.getBoundingClientRect().height || 8;
    const span = Math.max(1, rect.height - handle);
    const towerShare = shareFromPointer(clientY, rect.top, span, 0.45, 0.82);
    cutsFr = frAgainstRest(1 - towerShare);
    writeFr(CUTS_KEY, cutsFr);
    applyCuts();
  };

  bindDrag(x, "x", dragMain);
  bindDrag(y, "y", dragCuts);
  x.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    mainFr = Math.min(4.5, Math.max(0.7, mainFr + (ev.key === "ArrowRight" ? 0.08 : -0.08)));
    writeFr(MAIN_KEY, mainFr);
    applyMain();
  });
  y.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
    ev.preventDefault();
    cutsFr = Math.min(1.4, Math.max(0.22, cutsFr + (ev.key === "ArrowDown" ? 0.06 : -0.06)));
    writeFr(CUTS_KEY, cutsFr);
    applyCuts();
  });
}
