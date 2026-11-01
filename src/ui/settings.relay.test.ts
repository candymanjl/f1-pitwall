/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { readRelayUrl, writeRelayUrl } from "../config";
import { closeAllModals } from "./overlays";
import { openSettings } from "./settings";

afterEach(() => {
  closeAllModals();
  writeRelayUrl("");
});

describe("Settings relay field", () => {
  it("shows the saved relay URL and writes it on Save", () => {
    writeRelayUrl("https://f1pw-openf1-relay.azurewebsites.net/api");
    openSettings();
    expect(document.body.textContent).toMatch(/OpenF1 relay URL/);
    const input = document.querySelector("input[type=url]") as HTMLInputElement | null;
    expect(input?.value).toBe("https://f1pw-openf1-relay.azurewebsites.net/api");
    expect(input?.placeholder).toMatch(/azurewebsites\.net\/api/);

    input!.value = "https://other.azurewebsites.net/api/";
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    expect(save).toBeTruthy();
    save!.click();
    expect(readRelayUrl()).toBe("https://other.azurewebsites.net/api");
  });
});
