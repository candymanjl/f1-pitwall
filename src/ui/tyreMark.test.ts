/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { tyreAgeMark } from "./tyreMark";

describe("tyreAgeMark", () => {
  it("keeps a fixed icon slot and a 2-digit age slot for 1- and 2-digit ages", () => {
    const one = tyreAgeMark("MEDIUM", 4);
    const two = tyreAgeMark("HARD", 12);
    const none = tyreAgeMark(null, null);
    expect(one.className).toBe("tyre-age");
    expect(two.className).toBe("tyre-age");
    expect(one.querySelector(".tyre")?.textContent).toBe("M");
    expect(two.querySelector(".tyre")?.textContent).toBe("H");
    expect(one.querySelector(".tyre-age-n")?.textContent).toBe("4");
    expect(two.querySelector(".tyre-age-n")?.textContent).toBe("12");
    expect(none.querySelector(".tyre-age-n")?.textContent).toBe("—");
    const updating = tyreAgeMark("UPDATING", 12);
    expect(updating.querySelector(".tyre")?.textContent).toBe("·");
    expect(updating.querySelector(".tyre")?.className).toContain("updating");
    expect(updating.querySelector(".tyre")?.getAttribute("aria-label")).toBe("tyre updating");
    expect(updating.querySelector(".tyre-age-n")?.textContent).toBe("—");
    expect(one.querySelector(".tyre-age-n")?.textContent?.length).toBeLessThan(2);
    expect(two.querySelector(".tyre-age-n")?.textContent?.length).toBe(2);
  });
});
