/** Column splitter used by the Telemetry drivers panel. Kept in this file so other pages can grow their own. */

export function clampSplit(px: number, min: number, max: number): number {
  if (!Number.isFinite(px)) return min;
  return Math.min(max, Math.max(min, px));
}

export function splitWidthFromDrag(
  originWidth: number,
  originX: number,
  pointerX: number,
  min: number,
  max: number,
): number {
  return clampSplit(originWidth + (pointerX - originX), min, max);
}

export function readSplitWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return clampSplit(fallback, min, max);
    return clampSplit(Number(raw), min, max);
  } catch {
    return clampSplit(fallback, min, max);
  }
}

export function writeSplitWidth(key: string, px: number): void {
  try {
    localStorage.setItem(key, String(Math.round(px)));
  } catch {
    /* private mode */
  }
}

export function bindColumnSplitter(
  handle: HTMLElement,
  opts: {
    width: () => number;
    onWidth: (px: number) => void;
    min: number;
    max: number;
  },
): void {
  let drag: { x: number; width: number } | null = null;
  const apply = (px: number) => opts.onWidth(clampSplit(px, opts.min, opts.max));
  const onMove = (event: PointerEvent) => {
    if (!drag) return;
    apply(splitWidthFromDrag(drag.width, drag.x, event.clientX, opts.min, opts.max));
  };
  const end = () => {
    drag = null;
    handle.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };

  handle.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, width: opts.width() };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* The window listeners still follow the pointer. */
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    handle.classList.add("dragging");
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 16 : -16;
    apply(opts.width() + step);
  });
}
