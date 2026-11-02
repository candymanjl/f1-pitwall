import { compoundLetter } from "../data/tyres";
import { tyreColor } from "../lib/colors";
import { el } from "../lib/dom";

/** Compound icon + age for tables: fixed-width icon, then 2ch tabular age. */
export function tyreAgeMark(compound: string | null | undefined, age: number | null | undefined): HTMLElement {
  const icon = el("span", { class: "tyre", text: compoundLetter(compound ?? "?") });
  icon.style.color = tyreColor(compound);
  const n = el("span", {
    class: "tyre-age-n",
    text: age != null && Number.isFinite(age) ? String(age) : "—",
  });
  return el("span", { class: "tyre-age" }, [icon, n]);
}
