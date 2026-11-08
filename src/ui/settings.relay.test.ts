/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { readLiveDelay, readRelayUrl, writeRelayUrl } from "../config";
import { setLiveDelay, state } from "../state";
import { BUILD_VERSION } from "../lib/buildInfo";
import { closeAllModals } from "./overlays";
import { openSettings } from "./settings";

afterEach(() => {
  closeAllModals();
  writeRelayUrl("");
  setLiveDelay(3000);
});

describe("Settings relay field", () => {
  it("shows the injected build version", () => {
    openSettings();
    expect(document.querySelector(".modal .build-ver")?.textContent).toBe(BUILD_VERSION);
    expect(BUILD_VERSION).toMatch(/^v [0-9a-f]{7} · .+ ET$/);
  });

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

  it("offers Off, 3 s, and 5 s for the live delay and saves the choice", () => {
    openSettings();
    const select = document.querySelector("#live-delay") as HTMLSelectElement | null;
    expect(select).toBeTruthy();
    expect([...select!.options].map((opt) => opt.text)).toEqual(["Off", "3 s", "5 s"]);
    expect(select!.value).toBe("3000");
    select!.value = "5000";
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    expect(save).toBeTruthy();
    save!.click();
    expect(readLiveDelay()).toBe(5000);
    expect(state.liveDelayMs).toBe(5000);
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
