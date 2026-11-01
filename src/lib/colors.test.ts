import { describe, expect, it } from "vitest";
import { teamColor, teamFill } from "./colors";

describe("teamFill", () => {
  it("keeps a stable rgba tied to the team hex", () => {
    expect(teamColor("3671C6")).toBe("#3671C6");
    expect(teamFill("3671C6")).toBe("rgba(54, 113, 198, 0.22)");
    expect(teamFill("#E8002D", 0.4)).toBe("rgba(232, 0, 45, 0.4)");
    expect(teamFill(undefined)).toBe("rgba(148, 163, 184, 0.22)");
  });
});
