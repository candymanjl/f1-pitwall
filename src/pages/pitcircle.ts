import { asNumber } from "../lib/time";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { panel } from "../ui/panel";
import { renderTower } from "../ui/tower";
import { hasDriverSelection, isDriverSelected, selectDriver, setPitMode, state } from "../state";

function drawCircle(svg: SVGSVGElement): void {
  svg.replaceChildren();
  const snap = state.snap;
  if (!snap) return;
  const w = svg.clientWidth || 640;
  const h = svg.clientHeight || 640;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.36;
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("cx", String(cx));
  ring.setAttribute("cy", String(cy));
  ring.setAttribute("r", String(r));
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", "#e8edf7");
  ring.setAttribute("stroke-width", "2");
  svg.append(ring);

  const lap = snap.medianGreenLap;
  const loss = state.pitLoss[state.pitMode];
  const posOf = (gap: number) => {
    const ang = -Math.PI / 2 + (gap / lap) * Math.PI * 2;
    return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, ang] as const;
  };

  snap.rows.forEach((row, i) => {
    if (row.retired) return;
    const gap = row.pos === 1 ? 0 : asNumber(row.gap) ?? i * 1.2;
    const [x, y] = posOf(Math.max(0, gap));
    const on = isDriverSelected(row.driver.driver_number);
    const dim = hasDriverSelection() && !on;
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", String(y));
    c.setAttribute("r", on ? "7.5" : "5");
    c.setAttribute("fill", teamColor(row.driver.team_colour));
    c.setAttribute("class", `car-dot${on ? " on" : dim ? " dim" : ""}`);
    c.setAttribute("data-driver", String(row.driver.driver_number));
    c.setAttribute("stroke", on ? "#f8fafc" : "none");
    c.style.cursor = "pointer";
    c.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectDriver(row.driver.driver_number, ev);
    });
    svg.append(c);
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const [lx, ly] = posOf(Math.max(0, gap));
    t.setAttribute("x", String(lx + Math.cos(-Math.PI / 2 + (gap / lap) * Math.PI * 2) * 22));
    t.setAttribute("y", String(ly + Math.sin(-Math.PI / 2 + (gap / lap) * Math.PI * 2) * 22));
    t.setAttribute("class", "car-label");
    t.textContent = `${row.pos} ${row.driver.name_acronym}`;
    svg.append(t);
    if (i > 0 && !snap.rows[i - 1].retired) {
      const prevGap = snap.rows[i - 1].pos === 1 ? 0 : asNumber(snap.rows[i - 1].gap) ?? 0;
      const mid = (gap + prevGap) / 2;
      const [mx, my] = posOf(mid);
      const lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
      lab.setAttribute("x", String(mx));
      lab.setAttribute("y", String(my));
      lab.setAttribute("class", "car-label");
      lab.setAttribute("fill", "#8b93a7");
      lab.textContent = typeof row.interval === "number" ? `+${row.interval.toFixed(1)}` : "";
      svg.append(lab);
    }
  });

  const sel = snap.rows.find((r) => r.driver.driver_number === state.selectedDriver);
  if (sel) {
    const gap = sel.pos === 1 ? 0 : asNumber(sel.gap) ?? 0;
    const ghostGap = gap + loss;
    const [gx, gy] = posOf(ghostGap);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    g.setAttribute("cx", String(gx));
    g.setAttribute("cy", String(gy));
    g.setAttribute("r", "6");
    g.setAttribute("fill", "none");
    g.setAttribute("stroke", "#f8fafc");
    g.setAttribute("stroke-dasharray", "3 3");
    svg.append(g);
    const gt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    gt.setAttribute("x", String(cx));
    gt.setAttribute("y", String(cy));
    gt.setAttribute("text-anchor", "middle");
    gt.setAttribute("fill", "#cbd5e1");
    gt.setAttribute("class", "car-label");
    const behind = [...snap.rows].reverse().find((r) => {
      const rg = r.pos === 1 ? 0 : asNumber(r.gap) ?? 99;
      return rg <= ghostGap;
    });
    const ahead = snap.rows.find((r) => {
      const rg = r.pos === 1 ? 0 : asNumber(r.gap) ?? 0;
      return rg >= ghostGap && r.driver.driver_number !== sel.driver.driver_number;
    });
    gt.innerHTML = "";
    gt.textContent = `${sel.driver.name_acronym} ghost · ${state.pitMode.toUpperCase()} −${loss.toFixed(0)}s`;
    svg.append(gt);
    const cap = document.createElementNS("http://www.w3.org/2000/svg", "text");
    cap.setAttribute("x", String(cx));
    cap.setAttribute("y", String(cy + 36));
    cap.setAttribute("text-anchor", "middle");
    cap.setAttribute("fill", "#94a3b8");
    cap.setAttribute("class", "car-label");
    cap.textContent = `${ahead ? `rejoins ahead of ${ahead.driver.name_acronym}` : ""} ${behind ? `behind ${behind.driver.name_acronym}` : ""}`.trim();
    svg.append(cap);
  }

  const info = document.createElementNS("http://www.w3.org/2000/svg", "text");
  info.setAttribute("x", String(cx));
  info.setAttribute("y", String(cy + 18));
  info.setAttribute("text-anchor", "middle");
  info.setAttribute("fill", "#8b93a7");
  info.setAttribute("class", "car-label");
  info.textContent = `1 revolution = ${lap.toFixed(1)}s green-flag lap`;
  svg.append(info);
}

export function mountPitCircle(parent: HTMLElement): { update: () => void } {
  const left = panel("Timing tower");
  const right = panel("Pit circle");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("circle");
  const controls = el("div", { class: "drivers" });
  const wrap = el("div", { class: "chart-wrap" });
  wrap.append(svg);
  right.body.style.display = "flex";
  right.body.style.flexDirection = "column";
  wrap.style.flex = "1";
  wrap.style.minHeight = "0";
  right.body.append(controls, wrap);
  const page = el("div", { class: "page pitcircle" }, [left.root, right.root]);
  parent.append(page);

  const update = () => {
    const issue = !state.snap && !state.lock ? state.error || (state.loading ? null : "No session data loaded.") : null;
    left.setError(issue);
    right.setError(issue);
    left.body.replaceChildren();
    if (state.snap) {
      left.body.append(
        renderTower(state.snap.rows, {
          cols: "basic",
          selected: state.selectedDriver,
        }),
      );
    }
    controls.replaceChildren();
    for (const mode of ["green", "vsc", "sc"] as const) {
      const b = el("button", { class: state.pitMode === mode ? "on" : "", text: `${mode.toUpperCase()}  −${state.pitLoss[mode]}s` });
      b.onclick = () => {
        setPitMode(mode);
        update();
      };
      controls.append(b);
    }
    drawCircle(svg);
  };
  return { update };
}
