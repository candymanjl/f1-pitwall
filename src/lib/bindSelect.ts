import { selectDriver } from "../state";
import { driverFromTarget, pickDriverAt } from "./hit";

const IGNORE = "input, textarea, button, select, option, a, label.pit-delta";

/**
 * Pointerdown on a stable host. Rows/dots can be rebuilt every playback tick;
 * a click (mousedown+mouseup on the same node) then misses or hits a new node
 * and toggles the wrong driver. pointerdown + delegation + nearest-dot does not.
 */
export function bindDriverSelect(host: Element): () => void {
  const onDown = (ev: Event) => {
    const pe = ev as PointerEvent;
    if (typeof pe.button === "number" && pe.button !== 0) return;
    const raw = pe.target;
    if (raw instanceof Element && raw.closest(IGNORE)) return;
    const n = host instanceof SVGSVGElement ? pickDriverAt(host, pe) : driverFromTarget(raw);
    if (n == null) return;
    pe.preventDefault();
    pe.stopPropagation();
    selectDriver(n, pe);
  };
  host.addEventListener("pointerdown", onDown);
  return () => host.removeEventListener("pointerdown", onDown);
}
