/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { readRelayUrl, writeRelayUrl } from "../config";
import { state } from "../state";
import { closeAllModals } from "./overlays";
import { openSettings } from "./settings";

afterEach(() => {
  closeAllModals();
  writeRelayUrl("");
});

describe("Settings relay field", () => {
  it("starts empty and only saves a pasted Function App origin", () => {
    openSettings();
    const input = document.querySelector("input[type=url]") as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input?.value).toBe("");
    expect(input?.placeholder).toBe("https://f1-pitwall-relay-11686.azurewebsites.net");
    expect(document.body.textContent).toMatch(/Leave blank to call OpenF1 directly/);

    input!.value = "https://f1-pitwall-relay-11686.azurewebsites.net/";
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    expect(save).toBeTruthy();
    save!.click();
    expect(readRelayUrl()).toBe("https://f1-pitwall-relay-11686.azurewebsites.net");
  });

  it("saves the live poll debug toggle", () => {
    openSettings();
    const box = document.querySelector("label.check input[type=checkbox]") as HTMLInputElement | null;
    expect(box).toBeTruthy();
    expect(box?.checked).toBe(false);
    box!.checked = true;
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    save!.click();
    expect(state.showLiveDebug).toBe(true);
    state.showLiveDebug = false;
  });
});
