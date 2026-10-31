import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { formatSector } from "../lib/time";
import { panel } from "../ui/panel";
import { renderTower } from "../ui/tower";
import { setSelectedDriver, state } from "../state";

export function mountTiming(parent: HTMLElement): { update: () => void } {
  const tablePanel = panel("Live timing  ·  2025-style sectors  ·  no team radio");
  const strip = el("div", { class: "strip" });
  const page = el("div", { class: "page timing" }, [tablePanel.root, strip]);
  parent.append(page);

  const update = () => {
    const snap = state.snap;
    tablePanel.setError(!snap && !state.lock ? state.error || (state.loading ? null : "No session data loaded.") : null);
    tablePanel.body.replaceChildren();
    if (snap) {
      tablePanel.body.append(
        renderTower(snap.rows, {
          cols: "timing",
          selected: state.selectedDriver,
          onSelect: setSelectedDriver,
          showSegments: true,
        }),
      );
    }
    strip.replaceChildren();
    if (!snap) return;
    const best = el("div", {}, [
      el("div", { class: "legend", text: "Best sectors" }),
      el("div", { class: "sec-purple", text: `S1 ${snap.bestSectors.s1 ? `${snap.bestSectors.s1.code} ${formatSector(snap.bestSectors.s1.time)}` : "—"}` }),
      el("div", { class: "sec-purple", text: `S2 ${snap.bestSectors.s2 ? `${snap.bestSectors.s2.code} ${formatSector(snap.bestSectors.s2.time)}` : "—"}` }),
      el("div", { class: "sec-purple", text: `S3 ${snap.bestSectors.s3 ? `${snap.bestSectors.s3.code} ${formatSector(snap.bestSectors.s3.time)}` : "—"}` }),
    ]);
    const w = snap.weather;
    const wx = el("div", {}, [
      el("div", { class: "legend", text: "Conditions" }),
      el("div", { text: w ? `Air ${w.air_temperature?.toFixed(1) ?? "—"}°C` : "—" }),
      el("div", { text: w ? `Track ${w.track_temperature?.toFixed(1) ?? "—"}°C` : "—" }),
      el("div", { text: w ? `Wind ${w.wind_speed?.toFixed(1) ?? "—"} m/s` : "—" }),
    ]);
    const canvas = el("canvas", { class: "gapline" }) as HTMLCanvasElement;
    strip.append(best, canvas, wx);
    requestAnimationFrame(() => drawGap(canvas, snap.rows));
  };
  return { update };
}

function drawGap(canvas: HTMLCanvasElement, rows: NonNullable<typeof state.snap>["rows"]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth || 400;
  const h = 36;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#2a3144";
  ctx.beginPath();
  ctx.moveTo(8, h / 2);
  ctx.lineTo(w - 8, h / 2);
  ctx.stroke();
  const gaps = rows.map((r) => (typeof r.gap === "number" ? r.gap : r.pos === 1 ? 0 : null)).filter((g): g is number => g != null);
  const max = Math.max(8, ...(gaps.length ? gaps : [8]));
  for (const row of rows) {
    const g = row.pos === 1 ? 0 : typeof row.gap === "number" ? row.gap : null;
    if (g == null) continue;
    const x = 8 + (g / max) * (w - 16);
    ctx.fillStyle = teamColor(row.driver.team_colour);
    ctx.beginPath();
    ctx.arc(x, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
