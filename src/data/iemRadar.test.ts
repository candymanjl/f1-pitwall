import { describe, expect, it } from "vitest";
import { iemWmsUrl, roundToRadarStep } from "./iemRadar";

describe("IEM NEXRAD WMS", () => {
  it("rounds to 5 minute steps and points at mesonet", () => {
    const t = Date.parse("2025-10-19T19:07:00Z");
    expect(roundToRadarStep(t)).toBe(Date.parse("2025-10-19T19:05:00Z"));
    const url = iemWmsUrl(30.13, -97.64, t);
    expect(url).toContain("mesonet.agron.iastate.edu");
    expect(url).toContain("nexrad-n0q-wmst");
    expect(url).toContain("time=2025-10-19T19%3A05%3A00Z");
  });
});
