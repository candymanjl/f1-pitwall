/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { bindMenuHold, menuHoldActive } from "./menuHold";

function option(value: string, text: string): HTMLOptionElement {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = text;
  return opt;
}

function mountToolbar(): {
  year: HTMLSelectElement;
  meeting: HTMLSelectElement;
  session: HTMLSelectElement;
  speed: HTMLSelectElement;
} {
  document.body.innerHTML = `
    <div class="toolbar">
      <select id="year"></select>
      <select id="meeting"></select>
      <select id="session"></select>
      <div class="replay"><select id="speed"></select></div>
    </div>
  `;
  const year = document.querySelector("#year") as HTMLSelectElement;
  const meeting = document.querySelector("#meeting") as HTMLSelectElement;
  const session = document.querySelector("#session") as HTMLSelectElement;
  const speed = document.querySelector("#speed") as HTMLSelectElement;
  year.append(option("2025", "2025"), option("2026", "2026"));
  meeting.append(option("1272", "Mexico"), option("1220", "Sao Paulo"));
  session.append(option("9877", "Race"), option("9871", "Practice 1"));
  speed.append(option("1", "1×"), option("2", "2×"), option("4", "4×"));
  year.value = "2025";
  meeting.value = "1272";
  session.value = "9877";
  speed.value = "1";
  return { year, meeting, session, speed };
}

describe("menu hold during live refresh", () => {
  let dispose = () => {};

  afterEach(() => {
    dispose();
    document.body.innerHTML = "";
  });

  it("does not rebuild or reset an open session menu on live ticks or live messages", async () => {
    const { session, meeting } = mountToolbar();
    let sessionKey = 9877;
    let paints = 0;
    const gate = bindMenuHold(document, () => {
      paints += 1;
      const nextMeet = [option("1272", "Mexico"), option("1220", "Sao Paulo")];
      const nextSess = [option("9877", "Race"), option("9871", "Practice 1")];
      meeting.replaceChildren(...nextMeet);
      session.replaceChildren(...nextSess);
      session.value = String(sessionKey);
    });
    dispose = gate.dispose;

    session.focus();
    const race = session.options[0];
    const practice = session.options[1];
    session.value = "9871";
    session.onchange = () => {
      sessionKey = Number(session.value);
    };
    session.dispatchEvent(new Event("change"));

    gate.onUpdate();
    gate.onUpdate();
    gate.onUpdate();

    expect(paints).toBe(0);
    expect(session.options[0]).toBe(race);
    expect(session.options[1]).toBe(practice);
    expect(session.value).toBe("9871");
    expect(sessionKey).toBe(9871);

    session.blur();
    await Promise.resolve();
    expect(paints).toBe(1);
    expect(session.value).toBe("9871");
  });

  it("keeps a playback speed choice through live ticks and applies it", async () => {
    const { speed } = mountToolbar();
    let chosen = 1;
    let paints = 0;
    const gate = bindMenuHold(document, () => {
      paints += 1;
    });
    dispose = gate.dispose;
    speed.focus();
    speed.value = "4";
    speed.onchange = () => {
      chosen = Number(speed.value);
    };
    speed.dispatchEvent(new Event("change"));
    gate.onUpdate();
    gate.onUpdate();
    expect(paints).toBe(0);
    expect(speed.value).toBe("4");
    expect(chosen).toBe(4);
    speed.blur();
    await Promise.resolve();
    expect(paints).toBe(1);
    expect(speed.value).toBe("4");
    expect(chosen).toBe(4);
  });

  it("still repaints when no menu is open, and holds while Settings is open", async () => {
    const { meeting } = mountToolbar();
    let paints = 0;
    const gate = bindMenuHold(document, () => {
      paints += 1;
      meeting.replaceChildren(option("1272", "Mexico"));
    });
    dispose = gate.dispose;
    const first = meeting.options[0];
    gate.onUpdate();
    expect(paints).toBe(1);
    expect(meeting.options[0]).not.toBe(first);

    const bg = document.createElement("div");
    bg.className = "modal-bg";
    const delay = document.createElement("select");
    delay.id = "live-delay";
    bg.append(delay);
    document.body.append(bg);
    delay.focus();
    const held = meeting.options[0];
    gate.onUpdate();
    expect(paints).toBe(1);
    expect(meeting.options[0]).toBe(held);
    expect(menuHoldActive()).toBe(true);

    bg.remove();
    await Promise.resolve();
    expect(paints).toBe(2);
  });
});
