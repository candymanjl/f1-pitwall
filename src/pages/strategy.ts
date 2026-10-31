import { driverStrategy, strategyBrief } from "../data/strategy";
import { compoundLetter } from "../data/tyres";
import { tyreColor } from "../lib/colors";
import { el } from "../lib/dom";
import { formatDelta, formatLap } from "../lib/time";
import { panel } from "../ui/panel";
import { setSelectedDriver, state } from "../state";

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
    const table = el("table", { class: "tower" });
    table.append(
      el("thead", {}, [
        el("tr", {}, ["", "Driver", "Tyre", "Age", "Pace est.", "Deg / lap", "Sets left est.", "Int", "Gap", "Traffic"].map((t) => el("th", { text: t }))),
      ]),
    );
    const body = el("tbody");
    for (const row of snap.rows) {
      const s = driverStrategy(bundle, snap, row);
      const sets = Object.entries(s.setsLeft)
        .filter(([c]) => ["SOFT", "MEDIUM", "HARD"].includes(c))
        .map(([c, n]) => `${c[0]}${n}`)
        .join(" ");
      const tr = el("tr", { class: row.driver.driver_number === state.selectedDriver ? "sel" : "" });
      tr.onclick = () => setSelectedDriver(row.driver.driver_number);
      const tyre = el("span", { class: "tyre", text: (row.compound ?? "?").slice(0, 1) });
      tyre.style.color = tyreColor(row.compound);
      tr.append(
        el("td", { class: "pos", text: String(row.pos) }),
        el("td", { class: "code" }, [
          (() => {
            const d = el("span", { class: "swatch" });
            d.style.background = `#${row.driver.team_colour}`;
            return d;
          })(),
          document.createTextNode(row.driver.name_acronym),
        ]),
        el("td", {}, [tyre]),
        el("td", { text: row.tyreAge != null ? String(row.tyreAge) : "—" }),
        el("td", { text: formatLap(s.pace) }),
        el("td", { text: s.deg != null ? `${s.deg >= 0 ? "+" : ""}${s.deg.toFixed(3)}s` : "—" }),
        el("td", { text: sets || "—" }),
        el("td", { text: row.pos === 1 ? "—" : formatDelta(row.interval) }),
        el("td", { text: row.pos === 1 ? "LEADER" : formatDelta(row.gap) }),
        el("td", { class: s.heldUp ? "warn" : "", text: s.heldUp ? `HELD UP +${s.holdDelta?.toFixed(3) ?? ""}` : "clear" }),
      );
      body.append(tr);
    }
    table.append(body);
    tableP.body.append(table);

    const loss = state.pitLoss[state.pitMode];
    const dn = state.selectedDriver ?? snap.rows[0].driver.driver_number;
    const brief = strategyBrief(bundle, snap, dn, loss);
    const plans = brief.plans;
    const d = snap.rows.find((r) => r.driver.driver_number === dn);
    planP.setTitle(`Strategy  ·  ${d?.driver.name_acronym ?? ""}  ·  tyre model`);
    const wrap = el("div", { class: "plans" });
    const maxT = Math.max(1, ...plans.map((p) => p.total));
    if (!plans.length) {
      wrap.append(el("div", { class: "help", text: "No legal 1/2/3-stop plan with the sets and compound rule." }));
    }
    for (const plan of plans) {
      const box = el("div", { class: `plan ${plan.finish === "best" ? "best" : ""}` });
      const mix = plan.stints.map((st) => `${compoundLetter(st.compound)}${st.laps}`).join(" ");
      box.append(el("div", { text: `${plan.stops} stop  ·  ${mix}  ·  ${plan.finish}` }));
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
    wrap.append(el("div", { class: "legend", text: `Pit windows  ·  ${brief.windows}` }));
    wrap.append(el("div", { class: "legend", text: brief.rule }));
    wrap.append(el("div", { class: "help", text: "Stint times come from the Tyres page: offset vs a new Soft, linear fade or cliff, lifespan, and fuel. Dry plans that use only one dry compound are left out. Edit the model on Tyres." }));
    planP.body.replaceChildren(wrap);

    const cuts = brief.cuts;
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
      card("overcut vs ahead", cuts.overcut),
    );
    cutP.body.replaceChildren(grid);
  };
  return { update };
}
