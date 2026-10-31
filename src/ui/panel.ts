import { el } from "../lib/dom";

export function panel(title: string, extraClass = "", right?: Node): {
  root: HTMLElement;
  body: HTMLElement;
  setTitle: (t: string) => void;
  setError: (msg: string | null) => void;
} {
  const titleEl = el("div", { class: "t", text: title });
  const head = el("div", { class: "panel-h" }, [titleEl, right ?? null]);
  const errEl = el("div", { class: "panel-error" });
  errEl.hidden = true;
  const body = el("div", { class: "panel-b" });
  const root = el("section", { class: `panel ${extraClass}` }, [head, errEl, body]);
  return {
    root,
    body,
    setTitle: (t) => {
      titleEl.textContent = t;
    },
    setError: (msg) => {
      errEl.hidden = !msg;
      errEl.textContent = msg ?? "";
    },
  };
}
