import { el } from "../lib/dom";

export function panel(title: string, extraClass = "", right?: Node): { root: HTMLElement; body: HTMLElement; setTitle: (t: string) => void } {
  const titleEl = el("div", { class: "t", text: title });
  const head = el("div", { class: "panel-h" }, [titleEl, right ?? null]);
  const body = el("div", { class: "panel-b" });
  const root = el("section", { class: `panel ${extraClass}` }, [head, body]);
  return { root, body, setTitle: (t) => { titleEl.textContent = t; } };
}
