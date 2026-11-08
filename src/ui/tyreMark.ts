import { compoundLetter } from "../data/tyres";
import { tyreColor } from "../lib/colors";
import { el } from "../lib/dom";

/** Compound icon + age for tables: fixed-width icon, then 2ch tabular age. */
export function tyreAgeMark(compound: string | null | undefined, age: number | null | undefined): HTMLElement {
  const updating = compound === "UPDATING";
  const icon = el("span", {
    class: updating ? "tyre updating" : "tyre",
    text: compoundLetter(compound ?? "?"),
  });
  icon.style.color = tyreColor(compound);
  if (updating) {
    icon.title = "Tyre updating";
    icon.setAttribute("aria-label", "tyre updating");
  }
  const n = el("span", {
    class: "tyre-age-n",
    text: !updating && age != null && Number.isFinite(age) ? String(age) : "—",
  });
  return el("span", { class: "tyre-age" }, [icon, n]);
}
