import { cutPanel, driverStrategy, stopPlans } from "../data/strategy";
import { tyreColor } from "../lib/colors";
import { el } from "../lib/dom";
import { formatDelta, formatLap } from "../lib/time";
import { panel } from "../ui/panel";
import { hasDriverSelection, isDriverSelected, selectDriver, state } from "../state";
import { driverNameCell } from "../ui/tower";

export function mountStrategy(parent: HTMLElement): { update: () => void } {
  const tableP = panel("Rolling pace  ·  all model outputs are estimates");
  const planP = panel("1 / 2 / 3 stop comparison");
  const cutP = panel("Undercut / overcut  ·  estimate");
  planP.root.style.gridColumn = "2";
  planP.root.style.gridRow = "1 / span 2";
  const page = el("div", { class: "page strategy" }, [tableP.root, planP.root, cutP.root]);
  parent.append(page);

  const update = () => {
    const bundle = state.bundle;
    const snap = state.snap;
    const issue = !snap && !state.lock ? state.error || (state.loading ? null : "No session data loaded.") : null;
    tableP.setError(issue);
    planP.setError(issue);
    cutP.setError(issue);
    tableP.body.replaceChildren();
    if (!bundle || !snap) return;
    const table = el("table", { class: "tower cols-strategy" });
    const group = document.createElement("colgroup");
    for (const cls of ["c-pos", "c-drv", "c-tyre", "c-pits", "c-n", "c-lap", "c-deg", "c-sets", "c-gap", "c-gap", "c-traf"]) {
      const c = document.createElement("col");
      c.className = cls;
      group.append(c);
    }
    table.append(group);
    const labels = [
      ["", "c-pos"],
      ["Driver", "c-drv"],
      ["Tyre", "c-tyre"],
      ["Pits", "c-pits"],
      ["Age", "c-n"],
      ["Pace est.", "c-lap"],
      ["Deg / lap", "c-deg"],
      ["Sets left est.", "c-sets"],
      ["Int", "c-gap"],
      ["Gap", "c-gap"],
      ["Traffic", "c-traf"],
    ] as const;
    table.append(
      el("thead", {}, [
        el("tr", {}, labels.map(([t, cls]) => el("th", { class: cls, text: t }))),
      ]),
    );
    const body = el("tbody");
    for (const row of snap.rows) {
      const s = driverStrategy(bundle, snap, row);
      const sets = Object.entries(s.setsLeft)
        .filter(([c]) => ["SOFT", "MEDIUM", "HARD"].includes(c))
        .map(([c, n]) => `${c[0]}${n}`)
        .join(" ");
      const on = isDriverSelected(row.driver.driver_number);
      const tr = el("tr", {
        class: on ? "sel" : hasDriverSelection() ? "dim" : "",
        "data-driver": String(row.driver.driver_number),
      });
      tr.onclick = (ev) => selectDriver(row.driver.driver_number, ev);
      const tyre = el("span", { class: "tyre", text: (row.compound ?? "?").slice(0, 1) });
      tyre.style.color = tyreColor(row.compound);
      tr.append(
        el("td", { class: "pos c-pos", text: String(row.pos) }),
        el("td", { class: "c-drv" }, [driverNameCell(row)]),
        el("td", { class: "c-tyre" }, [tyre]),
        el("td", { class: "c-pits", text: String(row.pits) }),
        el("td", { class: "c-n", text: row.tyreAge != null ? String(row.tyreAge) : "—" }),
        el("td", { class: "c-lap", text: formatLap(s.pace) }),
        el("td", { class: "c-deg", text: s.deg != null ? `${s.deg >= 0 ? "+" : ""}${s.deg.toFixed(3)}s` : "—" }),
        el("td", { class: "c-sets", text: sets || "—" }),
        el("td", { class: "c-gap", text: row.pos === 1 ? "—" : formatDelta(row.interval) }),
        el("td", { class: "c-gap", text: row.pos === 1 ? "LEADER" : formatDelta(row.gap) }),
        el("td", { class: `c-traf ${s.heldUp ? "warn" : ""}`, text: s.heldUp ? `HELD UP +${s.holdDelta?.toFixed(3) ?? ""}` : "clear" }),
      );
      body.append(tr);
    }
    table.append(body);
    tableP.body.append(table);

    const loss = state.pitLoss[state.pitMode];
    const dn = state.selectedDriver ?? snap.rows[0].driver.driver_number;
    const plans = stopPlans(bundle, snap, dn, loss);
    const d = snap.rows.find((r) => r.driver.driver_number === dn);
    planP.setTitle(`Strategy  ·  ${d?.driver.name_acronym ?? ""}  ·  estimates`);
    const wrap = el("div", { class: "plans" });
    const maxT = Math.max(...plans.map((p) => p.total));
    for (const plan of plans) {
      const box = el("div", { class: `plan ${plan.finish === "best" ? "best" : ""}` });
      box.append(el("div", { text: `${plan.stops} stop  ·  ${plan.finish}` }));
      const bar = el("div", { class: "bar" });
      let x = 0;
      for (const st of plan.stints) {
        const seg = el("span");
        const w = (st.time / maxT) * 100;
        seg.style.left = `${x}%`;
        seg.style.width = `${w}%`;
        seg.style.background = tyreColor(st.compound);
        seg.title = `${st.compound} ${st.laps} laps`;
        bar.append(seg);
        x += w;
      }
      box.append(bar);
      box.append(el("div", { class: "legend", text: `Σ ${plan.total.toFixed(1)}s remaining  ·  pit loss ${plan.pitLoss.toFixed(1)}s (est.)` }));
      wrap.append(box);
    }
    wrap.append(el("div", { class: "help", text: "Transparent model: remaining laps split evenly across stints, using current clean-lap pace and linear deg. Safety-car laps excluded. Not a race engineer tool." }));
    planP.body.replaceChildren(wrap);

    const cuts = cutPanel(bundle, snap, dn, loss);
    const grid = el("div", { class: "cuts" });
    const card = (title: string, body: { name: string; fresh: string; gap: string; verdict: string } | null) => {
      const c = el("div", { class: "cut" });
      c.append(el("div", { class: "legend", text: title }));
      if (!body) {
        c.append(el("div", { text: "n/a" }));
        return c;
      }
      c.append(el("div", { text: body.name }), el("div", { text: body.fresh }), el("div", { text: body.gap }));
      const v = el("strong", { text: body.verdict });
      v.className = body.verdict.includes("VIABLE") ? "ok" : body.verdict.includes("WEAK") ? "bad" : "warn";
      c.append(v);
      return c;
    };
    grid.append(
      card("vs car ahead · undercut", cuts.vsAhead),
      card("vs car behind", cuts.vsBehind),
      card("overcut vs ahead", cuts.vsAhead ? { ...cuts.vsAhead, verdict: cuts.vsAhead.verdict.includes("VIABLE") ? "OVERCUT WEAKER" : "OVERCUT OPTION" } : null),
    );
    cutP.body.replaceChildren(grid);
  };
  return { update };
}
