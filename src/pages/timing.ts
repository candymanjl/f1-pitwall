import { bindDriverSelect } from "../lib/bindSelect";
import { el } from "../lib/dom";
import { panel } from "../ui/panel";
import { renderTower } from "../ui/tower";
import { state } from "../state";

export function mountTiming(parent: HTMLElement): { update: () => void } {
  const tablePanel = panel("Live timing  ·  2025-style sectors  ·  no team radio");
  const page = el("div", { class: "page timing" }, [tablePanel.root]);
  parent.append(page);
  bindDriverSelect(tablePanel.body);

  const update = () => {
    const snap = state.snap;
    tablePanel.setError(!snap && !state.lock ? state.error || (state.loading ? null : "No session data loaded.") : null);
    tablePanel.body.replaceChildren();
    if (snap) {
      tablePanel.body.append(
        renderTower(snap.rows, {
          cols: "timing",
          selected: state.selectedDriver,
          showSegments: true,
        }),
      );
    }
  };
  return { update };
}
