import { currentUiScale } from "./scale";

/** Generous driver target at 100% UI scale, in CSS pixels. Grows with --ui-scale. */
export const DRIVER_HIT_CSS = 22;

export function driverHitRadius(): number {
  return DRIVER_HIT_CSS * currentUiScale();
}

export function setupCanvas(
  canvas: HTMLCanvasElement,
  fallbackW = 800,
  fallbackH = 600,
): { ctx: CanvasRenderingContext2D | null; w: number; h: number; dpr: number } {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const w = canvas.clientWidth || fallbackW;
  const h = canvas.clientHeight || fallbackH;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

/** Event position in the element's CSS pixel box. Safe under DPR and browser zoom. */
export function cssPoint(
  ev: { clientX: number; clientY: number },
  el: Pick<Element, "getBoundingClientRect">,
): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
}

export function hitCircle(x: number, y: number, cx: number, cy: number, r: number): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

export function nearestPoint<T extends { x: number; y: number }>(
  items: T[],
  x: number,
  y: number,
  radius: number,
): T | null {
  let best: T | null = null;
  let bestD = radius * radius;
  for (const item of items) {
    const dx = x - item.x;
    const dy = y - item.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = item;
    }
  }
  return best;
}

/** Event position in the SVG user space (viewBox), not raw CSS pixels. */
export function svgPoint(svg: SVGSVGElement, ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const ctm = typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
  if (ctm && typeof svg.createSVGPoint === "function") {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox?.baseVal;
  const sx = vb && vb.width > 0 && r.width > 0 ? vb.width / r.width : 1;
  const sy = vb && vb.height > 0 && r.height > 0 ? vb.height / r.height : 1;
  return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
}

export function driverFromTarget(target: EventTarget | null): number | null {
  const el = target instanceof Element ? target.closest("[data-driver]") : null;
  if (!el) return null;
  const n = Number(el.getAttribute("data-driver"));
  return Number.isFinite(n) ? n : null;
}

/** Nearest on-track / pit-circle dot under a pointer, using a generous hit radius. */
export function pickDriverAt(svg: SVGSVGElement, ev: { clientX: number; clientY: number }): number | null {
  const { x, y } = svgPoint(svg, ev);
  const items: { n: number; x: number; y: number }[] = [];
  for (const node of svg.querySelectorAll("[data-driver]")) {
    const n = Number(node.getAttribute("data-driver"));
    const px = Number(node.getAttribute("data-x"));
    const py = Number(node.getAttribute("data-y"));
    if (Number.isFinite(n) && Number.isFinite(px) && Number.isFinite(py)) items.push({ n, x: px, y: py });
  }
  return nearestPoint(items, x, y, driverHitRadius())?.n ?? null;
}

export function gapX(gap: number, max: number, width: number, pad = 8): number {
  return pad + (gap / Math.max(max, 1e-6)) * (width - pad * 2);
}
