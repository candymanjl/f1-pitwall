import { describe, expect, it } from "vitest";
import { iemLoopTimes, iemWmsUrl, roundToRadarStep } from "./iemRadar";

describe("IEM NEXRAD WMS", () => {
  it("rounds to 5 minute steps and points at mesonet", () => {
    const t = Date.parse("2025-10-19T19:07:00Z");
    expect(roundToRadarStep(t)).toBe(Date.parse("2025-10-19T19:05:00Z"));
    const url = iemWmsUrl(30.13, -97.64, t);
    expect(url).toContain("mesonet.agron.iastate.edu");
    expect(url).toContain("nexrad-n0q-wmst");
    expect(url).toContain("time=2025-10-19T19%3A05%3A00Z");
  });

  it("loops the past hour at 5 minute steps and never includes a future frame", () => {
    const playhead = Date.parse("2025-10-19T19:07:00Z");
    const times = iemLoopTimes(playhead);
    expect(times[0]).toBe(Date.parse("2025-10-19T18:05:00Z"));
    expect(times.at(-1)).toBe(Date.parse("2025-10-19T19:05:00Z"));
    expect(times.every((t) => t <= playhead)).toBe(true);
    expect(times).not.toContain(Date.parse("2025-10-19T19:10:00Z"));
  });
});
