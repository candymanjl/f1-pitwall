/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { addClass, el } from "./dom";

describe("addClass", () => {
  it("never passes an empty token to classList.add", () => {
    const node = document.createElement("td");
    const spy = vi.spyOn(node.classList, "add");
    addClass(node, "", "  ", undefined, null, "sec-yellow", "lt-live");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("sec-yellow", "lt-live");
    expect(spy.mock.calls.flat().every((token) => token.length > 0)).toBe(true);
    expect(node.className).toBe("sec-yellow lt-live");
    spy.mockRestore();
  });
});

describe("el class attr", () => {
  it("ignores empty class strings instead of calling classList.add('')", () => {
    expect(() => el("td", { class: "", text: "1:19.310" })).not.toThrow();
    expect(() => el("td", { class: "  lt-live  ", text: "…" })).not.toThrow();
    expect(el("td", { class: "  lt-live  " }).className).toBe("lt-live");
    expect(el("td", { class: "" }).className).toBe("");
  });
});
