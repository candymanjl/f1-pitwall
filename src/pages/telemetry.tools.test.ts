/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import type { SessionBundle } from "../data/types";
import { state } from "../state";
import { mountTelemetry } from "./telemetry";

describe("telemetry tools", () => {
  it("toggles channels, overlay, the brush, and corner windows", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const previous = state.bundle;
    const slots = state.telemetry;
    state.telemetry = [];
    state.bundle = {
      drivers: [],
      laps: [],
      corners: [
        { n: 1, x: 0, y: 0, dist: 0.25 },
        { n: 2, x: 10, y: 10, dist: 0.7 },
      ],
      track: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    } as unknown as SessionBundle;

    try {
      const api = mountTelemetry(root);
      api.update();

      const brake = [...root.querySelectorAll(".telem-tools .trace-chip")].find(
        (node) => node.textContent === "Brake",
      ) as HTMLButtonElement;
      expect(brake.getAttribute("aria-pressed")).toBe("true");
      brake.click();
      expect(brake.getAttribute("aria-pressed")).toBe("false");
      expect(brake.classList.contains("off")).toBe(true);
      const saved = JSON.parse(localStorage.getItem("f1pitwall.telemetryView") ?? "{}") as {
        visible: { brake: boolean };
        overlay: boolean;
      };
      expect(saved.visible.brake).toBe(false);

      const overlay = root.querySelector(".trace-chip.overlay") as HTMLButtonElement;
      overlay.click();
      expect(overlay.getAttribute("aria-pressed")).toBe("true");
      expect(overlay.classList.contains("on")).toBe(true);
      expect(JSON.parse(localStorage.getItem("f1pitwall.telemetryView") ?? "{}").overlay).toBe(true);

      const host = root.querySelector(".brush") as HTMLElement;
      host.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 200,
          height: 48,
          right: 200,
          bottom: 48,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      const start = root.querySelector(".brush-handle.start") as HTMLElement;
      start.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, bubbles: true, pointerId: 1 }));
      host.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, bubbles: true, pointerId: 1 }));
      expect(parseFloat(start.style.left)).toBeCloseTo(20);
      host.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));

      const turn1 = [...root.querySelectorAll(".corner-row button")].find((node) => node.textContent === "T1") as HTMLButtonElement;
      expect(turn1).toBeTruthy();
      turn1.click();
      const windowEl = root.querySelector(".brush-window") as HTMLElement;
      expect(parseFloat(windowEl.style.left)).toBeCloseTo(19);
      expect(parseFloat(windowEl.style.width)).toBeCloseTo(12);

      host.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(parseFloat(windowEl.style.left)).toBeCloseTo(0);
      expect(parseFloat(windowEl.style.width)).toBeCloseTo(100);

      const readout = root.querySelector(".readout");
      expect(readout?.textContent).toContain("0–1 m");
    } finally {
      state.bundle = previous;
      state.telemetry = slots;
      root.remove();
    }
  });
});
