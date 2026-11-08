import { describe, expect, it } from "vitest";
import { circuitCoord, hasIemRadar } from "./circuitCoords";

describe("circuitCoord", () => {
  it("finds Interlagos by circuit_key 14 and by name", () => {
    expect(circuitCoord({ circuit_key: 14, circuit_short_name: "X", location: "X", country_name: "X" })?.name).toBe(
      "Interlagos",
    );
    expect(circuitCoord({ circuit_short_name: "Interlagos", location: "", country_name: "Brazil" })?.lat).toBeCloseTo(
      -23.7,
      0,
    );
  });

  it("marks only Austin, Miami, and Las Vegas for IEM radar", () => {
    expect(hasIemRadar({ circuit_short_name: "Austin", location: "Austin", country_name: "USA" })).toBe(true);
    expect(hasIemRadar({ circuit_short_name: "Miami", location: "Miami", country_name: "USA" })).toBe(true);
    expect(hasIemRadar({ circuit_short_name: "Las Vegas", location: "Las Vegas", country_name: "USA" })).toBe(true);
    expect(hasIemRadar({ circuit_short_name: "Mexico City", location: "Mexico City", country_name: "Mexico" })).toBe(
      false,
    );
    expect(hasIemRadar({ circuit_short_name: "Interlagos", location: "São Paulo", country_name: "Brazil" })).toBe(false);
  });
});
