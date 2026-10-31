import { selectDriver } from "../state";
import { driverHitRadius } from "./hit";

export function appendDriverDot(
  svg: SVGSVGElement,
  px: number,
  py: number,
  opts: {
    n: number;
    color: string;
    selected: boolean;
    dim: boolean;
    visualR?: number;
    stroke?: string;
    label?: string;
    labelX?: number;
    labelY?: number;
  },
): SVGGElement {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", `car-hit${opts.selected ? " on" : opts.dim ? " dim" : ""}`);
  g.setAttribute("data-driver", String(opts.n));
  g.style.cursor = "pointer";
  const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hit.setAttribute("cx", String(px));
  hit.setAttribute("cy", String(py));
  hit.setAttribute("r", String(driverHitRadius()));
  hit.setAttribute("class", "car-hit-pad");
  const vis = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const vr = opts.visualR ?? (opts.selected ? 7 : 4.5);
  vis.setAttribute("cx", String(px));
  vis.setAttribute("cy", String(py));
  vis.setAttribute("r", String(vr));
  vis.setAttribute("fill", opts.color);
  vis.setAttribute("class", `car-dot${opts.selected ? " on" : opts.dim ? " dim" : ""}`);
  vis.setAttribute("stroke", opts.stroke ?? (opts.selected ? "#f8fafc" : "#07080d"));
  vis.setAttribute("stroke-width", opts.selected ? "2" : "1");
  vis.setAttribute("pointer-events", "none");
  g.append(hit, vis);
  if (opts.label) {
    const lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lab.setAttribute("x", String(opts.labelX ?? px + 10));
    lab.setAttribute("y", String(opts.labelY ?? py - 6));
    lab.setAttribute("class", "car-label");
    lab.textContent = opts.label;
    g.append(lab);
  }
  g.addEventListener("click", (ev) => {
    ev.stopPropagation();
    selectDriver(opts.n, ev);
  });
  svg.append(g);
  return g;
}
