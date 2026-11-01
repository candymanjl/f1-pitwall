/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { state } from "../state";
import { bindDriverSelect } from "./bindSelect";

describe("bindDriverSelect", () => {
  afterEach(() => {
    state.selectedDrivers = [];
    state.selectedDriver = null;
    document.body.replaceChildren();
  });

  it("selects on pointerdown of a stable host after the row is replaced", () => {
    const host = document.createElement("div");
    document.body.append(host);
    bindDriverSelect(host);

    const row = () => {
      const tr = document.createElement("tr");
      tr.setAttribute("data-driver", "1");
      const td = document.createElement("td");
      td.textContent = "VER";
      tr.append(td);
      return tr;
    };

    host.append(row());
    host.querySelector("td")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(state.selectedDrivers).toEqual([1]);

    host.replaceChildren(row());
    host.querySelector("tr")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    host.querySelector("tr")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.selectedDrivers).toEqual([1]);

    host.querySelector("td")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(state.selectedDrivers).toEqual([]);
  });
});
