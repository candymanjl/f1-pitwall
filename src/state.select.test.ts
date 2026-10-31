import { afterEach, describe, expect, it } from "vitest";
import { selectDriver, setTelemetrySlots, state } from "./state";

describe("selectDriver / telemetry slots", () => {
  afterEach(() => {
    state.selectedDrivers = [];
    state.selectedDriver = null;
    state.telemetry = [];
  });

  it("keeps selectedDriver in sync with the multi-select list", () => {
    selectDriver(44);
    expect(state.selectedDrivers).toEqual([44]);
    expect(state.selectedDriver).toBe(44);
    selectDriver(1, { shiftKey: true });
    expect(state.selectedDrivers).toEqual([44, 1]);
    expect(state.selectedDriver).toBe(1);
    selectDriver(1);
    expect(state.selectedDrivers).toEqual([1]);
    selectDriver(1);
    expect(state.selectedDrivers).toEqual([]);
    expect(state.selectedDriver).toBeNull();
  });

  it("caps telemetry comparison slots at 4", () => {
    setTelemetrySlots([
      { driver: 1, lap: 5 },
      { driver: 44, lap: 6 },
      { driver: 16, lap: 7 },
      { driver: 63, lap: 8 },
      { driver: 55, lap: 9 },
    ]);
    expect(state.telemetry).toHaveLength(4);
    expect(state.telemetry.map((s) => s.driver)).toEqual([1, 44, 16, 63]);
  });
});
