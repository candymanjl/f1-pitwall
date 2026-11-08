import { describe, expect, it } from "vitest";
import { geoCircuitFor, lngLatToMetres, metresToLngLat } from "./geoCircuit";

describe("bacinger GeoJSON circuits", () => {
  it("matches OpenF1 Interlagos / São Paulo to the Sao Paulo outline", () => {
    const row = geoCircuitFor({ circuit_short_name: "Interlagos", location: "São Paulo", country_name: "Brazil" });
    expect(row?.location).toBe("Sao Paulo");
    expect(row?.lngLat.length).toBeGreaterThan(20);
  });

  it("matches Silverstone, Monza, and Las Vegas", () => {
    expect(geoCircuitFor({ circuit_short_name: "Silverstone", location: "Silverstone", country_name: "United Kingdom" })?.location).toBe(
      "Silverstone",
    );
    expect(geoCircuitFor({ circuit_short_name: "Monza", location: "Monza", country_name: "Italy" })?.location).toBe("Monza");
    expect(geoCircuitFor({ circuit_short_name: "Las Vegas", location: "Las Vegas", country_name: "United States" })?.location).toBe(
      "Las Vegas",
    );
  });

  it("round-trips local metres around the circuit centre", () => {
    const row = geoCircuitFor({ circuit_short_name: "Monza", location: "Monza", country_name: "Italy" })!;
    const metres = lngLatToMetres(row.lngLat, row.lat0, row.lon0);
    const [lon, lat] = metresToLngLat(metres[3][0], metres[3][1], row.lat0, row.lon0);
    expect(lon).toBeCloseTo(row.lngLat[3][0], 6);
    expect(lat).toBeCloseTo(row.lngLat[3][1], 6);
  });
});
