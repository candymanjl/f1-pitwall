/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import type { Driver, Lap, Pit, SessionBundle } from "../data/types";
import { state } from "../state";
import { mountTelemetry } from "./telemetry";

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Test",
    team_colour: "ffffff",
    first_name: code,
    last_name: code,
  };
}

function lap(partial: Partial<Lap> & Pick<Lap, "driver_number" | "lap_number" | "lap_duration">): Lap {
  return {
    date_start: "2025-10-26T20:00:00.000Z",
    duration_sector_1: 28,
    duration_sector_2: 30,
    duration_sector_3: 22,
    is_pit_out_lap: false,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
    ...partial,
  };
}

const pits: Pit[] = [
  { date: "2025-10-26T20:20:00.000Z", driver_number: 44, lap_number: 12, lane_duration: 12, pit_duration: 22, stop_duration: 2 },
];

describe("telemetry drivers panel", () => {
  const previousBundle = state.bundle;
  const previousSlots = state.telemetry.slice();

  afterEach(() => {
    state.bundle = previousBundle;
    state.telemetry = previousSlots;
  });

  it("defaults new drivers to a complete lap, sets every driver, and resizes the list", () => {
    const fetchImpl = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("offline"));
    const root = document.createElement("div");
    document.body.append(root);
    state.telemetry = [];
    state.bundle = {
      drivers: [driver(1, "NOR"), driver(44, "HAM"), driver(63, "RUS")],
      laps: [
        lap({ driver_number: 1, lap_number: 1, lap_duration: 60, is_pit_out_lap: true }),
        lap({ driver_number: 1, lap_number: 5, lap_duration: 82 }),
        lap({ driver_number: 1, lap_number: 10, lap_duration: 80 }),
        lap({ driver_number: 44, lap_number: 12, lap_duration: 70 }),
        lap({ driver_number: 44, lap_number: 4, lap_duration: 81 }),
        lap({ driver_number: 44, lap_number: 10, lap_duration: 79 }),
        lap({ driver_number: 63, lap_number: 8, lap_duration: 83 }),
      ],
      pits,
      corners: [],
      track: [],
    } as unknown as SessionBundle;

    try {
      const api = mountTelemetry(root);
      api.update();
      expect(state.telemetry).toEqual([
        { driver: 1, lap: 10 },
        { driver: 44, lap: 10 },
      ]);

      const add = root.querySelector(".telem-add") as HTMLButtonElement;
      expect(add).toBeTruthy();
      expect(add.classList.contains("ghost")).toBe(false);
      expect(add.textContent).toContain("Add driver");
      add.click();
      api.update();
      expect(state.telemetry[2]).toEqual({ driver: 63, lap: 8 });
      const remove = root.querySelector(".telem-remove") as HTMLButtonElement;
      expect(remove).toBeTruthy();
      expect(remove.getAttribute("aria-label")).toBe("Remove driver");

      const lapSelect = root.querySelectorAll(".telem-slot select")[1] as HTMLSelectElement;
      lapSelect.value = "5";
      lapSelect.dispatchEvent(new Event("change"));
      api.update();
      expect(state.telemetry[0].lap).toBe(5);
      (root.querySelector(".telem-fast") as HTMLButtonElement).click();
      api.update();
      expect(state.telemetry[0].lap).toBe(10);
      state.telemetry = state.telemetry.map((slot, index) => (index === 0 ? { driver: 1, lap: 5 } : slot));
      api.update();

      const input = root.querySelector(".telem-bulk input") as HTMLInputElement;
      input.value = "10";
      const allLap = [...root.querySelectorAll(".telem-bulk-btn")].find((node) => node.textContent === "All to lap") as HTMLButtonElement;
      allLap.click();
      api.update();
      expect(state.telemetry).toEqual([
        { driver: 1, lap: 10 },
        { driver: 44, lap: 10 },
        { driver: 63, lap: 8 },
      ]);

      const fastest = root.querySelectorAll(".telem-fast")[2] as HTMLButtonElement;
      expect(fastest.disabled).toBe(false);

      state.telemetry = [
        { driver: 1, lap: 5 },
        { driver: 44, lap: 4 },
        { driver: 63, lap: 8 },
      ];
      api.update();
      const allFast = [...root.querySelectorAll(".telem-bulk-btn")].find((node) => node.textContent === "All to fastest") as HTMLButtonElement;
      allFast.click();
      api.update();
      expect(state.telemetry).toEqual([
        { driver: 1, lap: 10 },
        { driver: 44, lap: 10 },
        { driver: 63, lap: 8 },
      ]);

      const split = root.querySelector(".telem-split") as HTMLElement;
      expect(split.getAttribute("aria-valuenow")).toBe("352");
      split.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, bubbles: true, pointerId: 1 }));
      split.dispatchEvent(new PointerEvent("pointermove", { clientX: 140, bubbles: true, pointerId: 1 }));
      split.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
      const page = root.querySelector(".page.telemetry") as HTMLElement;
      expect(page.style.getPropertyValue("--telem-side")).toBe("392px");
      expect(localStorage.getItem("f1pitwall.telemetryDriversWidth")).toBe("392");
      split.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      expect(page.style.getPropertyValue("--telem-side")).toBe("376px");
    } finally {
      globalThis.fetch = fetchImpl;
      root.remove();
    }
  });

  it("follows a new fastest lap and repaints the chart when the column moves", () => {
    const fetchImpl = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("offline"));
    const root = document.createElement("div");
    document.body.append(root);
    state.telemetry = [{ driver: 1, lap: 1 }];
    const laps = [lap({ driver_number: 1, lap_number: 1, lap_duration: 70, is_pit_out_lap: true })];
    state.bundle = {
      drivers: [driver(1, "NOR")],
      laps,
      pits: [],
      corners: [],
      track: [],
    } as unknown as SessionBundle;

    try {
      const api = mountTelemetry(root);
      api.update();
      const shown = root.querySelector(".lap-times");
      expect(shown?.textContent).toContain("Displayed lap time");
      expect(shown?.textContent).toContain("NOR");
      expect(shown?.textContent).toContain("1:10.000");
      expect((shown?.querySelector(".lap-time") as HTMLElement | null)?.style.color).toBe("#ffffff");
      const fastest = root.querySelector(".telem-fast") as HTMLButtonElement;
      expect(fastest.disabled).toBe(true);

      laps.push(lap({ driver_number: 1, lap_number: 6, lap_duration: 80 }));
      api.update();
      const enabled = root.querySelector(".telem-fast") as HTMLButtonElement;
      expect(enabled.disabled).toBe(false);
      expect(enabled.title).toContain("6");
      enabled.click();
      api.update();
      expect(state.telemetry[0]).toEqual({ driver: 1, lap: 6 });
      expect(root.querySelector(".lap-times")?.textContent).toContain("1:20.000");

      laps.push(lap({ driver_number: 1, lap_number: 3, lap_duration: 79 }));
      const allFast = [...root.querySelectorAll(".telem-bulk-btn")].find((node) => node.textContent === "All to fastest") as HTMLButtonElement;
      allFast.click();
      expect(state.telemetry[0].lap).toBe(3);

      const canvas = root.querySelector("canvas.chart") as HTMLCanvasElement;
      const bag: Record<string, unknown> = {};
      const ctx = new Proxy(bag, {
        get(target, prop) {
          if (typeof prop !== "string") return undefined;
          if (prop in target) return target[prop];
          return () => undefined;
        },
      }) as unknown as CanvasRenderingContext2D;
      canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
      let chartW = 500;
      Object.defineProperty(canvas, "clientWidth", { configurable: true, get: () => chartW });
      Object.defineProperty(canvas, "clientHeight", { configurable: true, get: () => 240 });
      const split = root.querySelector(".telem-split") as HTMLElement;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      split.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(canvas.width).toBe(Math.round(500 * dpr));
      chartW = 640;
      split.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, bubbles: true, pointerId: 7 }));
      split.dispatchEvent(new PointerEvent("pointermove", { clientX: 24, bubbles: true, pointerId: 7 }));
      expect(canvas.width).toBe(Math.round(640 * dpr));
    } finally {
      globalThis.fetch = fetchImpl;
      root.remove();
    }
  });
});
