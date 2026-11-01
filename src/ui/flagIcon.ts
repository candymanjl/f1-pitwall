import { FLAG_LABEL, FLAG_SHEET_KINDS, sheetFlagState, type TrackFlagKind, type TrackFlagState } from "../data/trackFlag";

const SVG = "http://www.w3.org/2000/svg";
let flagUid = 0;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function nextId(prefix: string): string {
  flagUid += 1;
  return `f1flag-${prefix}-${flagUid}`;
}

/** Mostly rectangular cloth; long edges only dip a couple of units. */
const CLOTH =
  "M3.2,6.4 C16,5.4 28.5,7.5 40.5,6.3 C53,5.1 62,7.2 69.2,5.8 L69.6,35.4 C62,36.8 53,34.8 40.5,36 C28.5,37.2 16,35.2 3.4,36.4 Z";

function foldStops(shade: "light" | "dark"): Array<[number, string]> {
  if (shade === "dark") {
    return [
      [0, "#0000001c"],
      [28, "#ffffff0c"],
      [52, "#00000018"],
      [78, "#ffffff0a"],
      [100, "#00000012"],
    ];
  }
  return [
    [0, "#ffffff20"],
    [30, "#0000000c"],
    [58, "#ffffff18"],
    [82, "#0000000a"],
    [100, "#ffffff10"],
  ];
}

function addFolds(defs: SVGDefsElement, id: string, shade: "light" | "dark"): void {
  const grad = svgEl("linearGradient", {
    id,
    x1: "0%",
    y1: "12%",
    x2: "100%",
    y2: "20%",
  });
  for (const [offset, color] of foldStops(shade)) {
    grad.append(svgEl("stop", { offset: `${offset}%`, "stop-color": color }));
  }
  defs.append(grad);
}

function clothFill(kind: TrackFlagKind): string {
  switch (kind) {
    case "green":
      return "#16a34a";
    case "yellow":
    case "doubleYellow":
    case "sc":
    case "vsc":
      return "#f5d000";
    case "red":
      return "#dc2626";
    case "blue":
      return "#2563eb";
    case "white":
      return "#f8fafc";
    case "black":
    case "blackOrange":
      return "#111827";
    case "slippery":
      return "#f5d000";
    default:
      return "#e5e7eb";
  }
}

function paintPattern(kind: TrackFlagKind, clipId: string, defs: SVGDefsElement): SVGGElement | null {
  const g = svgEl("g", { "clip-path": `url(#${clipId})` });
  if (kind === "chequered") {
    const pid = nextId("chk");
    const pat = svgEl("pattern", { id: pid, width: "10", height: "10", patternUnits: "userSpaceOnUse" });
    pat.append(svgEl("rect", { width: "10", height: "10", fill: "#f8fafc" }));
    pat.append(svgEl("rect", { width: "5", height: "5", fill: "#111827" }));
    pat.append(svgEl("rect", { x: "5", y: "5", width: "5", height: "5", fill: "#111827" }));
    defs.append(pat);
    g.append(svgEl("rect", { x: "0", y: "0", width: "72", height: "42", fill: `url(#${pid})` }));
    return g;
  }
  if (kind === "blackWhite") {
    g.append(svgEl("path", { d: "M-2,-2 L78,-2 L-2,48 Z", fill: "#111827" }));
    g.append(svgEl("path", { d: "M78,-2 L78,48 L-2,48 Z", fill: "#f8fafc" }));
    return g;
  }
  if (kind === "blackOrange") {
    g.append(svgEl("rect", { x: "0", y: "0", width: "72", height: "42", fill: "#111827" }));
    g.append(svgEl("circle", { cx: "36", cy: "21", r: "10.5", fill: "#ea580c" }));
    return g;
  }
  if (kind === "slippery") {
    const pid = nextId("slip");
    const pat = svgEl("pattern", { id: pid, width: "9", height: "42", patternUnits: "userSpaceOnUse" });
    pat.append(svgEl("rect", { width: "9", height: "42", fill: "#f5d000" }));
    pat.append(svgEl("rect", { x: "4.5", width: "4.5", height: "42", fill: "#dc2626" }));
    defs.append(pat);
    g.append(svgEl("rect", { x: "0", y: "0", width: "72", height: "42", fill: `url(#${pid})` }));
    return g;
  }
  return null;
}

function drawOneFlag(kind: TrackFlagKind, flipped: boolean): SVGGElement {
  const clipId = nextId("clip");
  const foldId = nextId("fold");
  const shineId = nextId("shine");
  const shadowId = nextId("shadow");
  const g = svgEl("g");
  if (flipped) g.setAttribute("transform", "translate(72,0) scale(-1,1)");
  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id: clipId });
  clip.append(svgEl("path", { d: CLOTH }));
  defs.append(clip);
  addFolds(defs, foldId, "dark");
  addFolds(defs, shineId, "light");
  const filter = svgEl("filter", { id: shadowId, x: "-6%", y: "-8%", width: "114%", height: "120%" });
  filter.append(svgEl("feDropShadow", { dx: "0.2", dy: "0.6", stdDeviation: "0.45", "flood-color": "#000", "flood-opacity": "0.28" }));
  defs.append(filter);
  g.append(defs);

  const body = svgEl("g", { filter: `url(#${shadowId})` });
  const pattern = paintPattern(kind, clipId, defs);
  if (pattern) body.append(pattern);
  else body.append(svgEl("path", { d: CLOTH, fill: clothFill(kind) }));

  body.append(svgEl("path", { d: CLOTH, fill: `url(#${foldId})` }));
  body.append(svgEl("path", { d: CLOTH, fill: `url(#${shineId})` }));
  body.append(
    svgEl("path", {
      d: "M3.6,6.8 L3.6,36.2",
      fill: "none",
      stroke: "#00000028",
      "stroke-width": "2.2",
      "stroke-linecap": "round",
      "clip-path": `url(#${clipId})`,
    }),
  );
  body.append(
    svgEl("path", {
      d: CLOTH,
      fill: "none",
      stroke: "#0b0f14",
      "stroke-width": "1.2",
      "stroke-linejoin": "round",
    }),
  );

  if (kind === "sc" || kind === "vsc") {
    const label = svgEl("text", {
      x: "36",
      y: "24.8",
      "text-anchor": "middle",
      fill: "#111827",
      stroke: "#fff7cc",
      "stroke-width": "0.75",
      "paint-order": "stroke",
      "font-size": kind === "vsc" ? "13.5" : "16",
      "font-weight": "800",
      "font-family": "Titillium Web, sans-serif",
      "clip-path": `url(#${clipId})`,
    });
    label.textContent = kind === "sc" ? "SC" : "VSC";
    body.append(label);
  }
  g.append(body);
  return g;
}

export function flagViewBox(kind: TrackFlagKind): { w: number; h: number } {
  return kind === "doubleYellow" ? { w: 132, h: 44 } : { w: 72, h: 42 };
}

export function buildFlagSvg(state: TrackFlagState, opts: { badge?: boolean } = {}): SVGSVGElement {
  const { w, h } = flagViewBox(state.kind);
  const svg = svgEl("svg", {
    class: "flag-svg",
    viewBox: `0 0 ${w} ${h}`,
    role: "img",
    "aria-label": state.label,
  });
  if (state.kind === "doubleYellow") {
    const left = drawOneFlag("doubleYellow", true);
    left.setAttribute("transform", "translate(0,1) scale(0.7,0.94) translate(72,0) scale(-1,1)");
    const right = drawOneFlag("doubleYellow", false);
    right.setAttribute("transform", "translate(62,1) scale(0.7,0.94)");
    svg.append(left, right);
  } else {
    svg.append(drawOneFlag(state.kind, false));
  }

  if (state.badge && opts.badge !== false) {
    const badgeW = Math.max(18, state.badge.length * 4.55 + 7);
    const bx = Math.max(2, w - badgeW - 1.2);
    const badge = svgEl("g", { class: "flag-badge" });
    badge.append(
      svgEl("rect", {
        x: String(bx),
        y: "0.8",
        width: String(badgeW),
        height: "11.4",
        rx: "2.4",
        fill: "#f5d000",
        stroke: "#111827",
        "stroke-width": "0.85",
      }),
    );
    const t = svgEl("text", {
      x: String(bx + badgeW / 2),
      y: "9.3",
      "text-anchor": "middle",
      fill: "#111827",
      "font-size": state.badge.length > 4 ? "6.6" : "7.2",
      "font-weight": "800",
      "font-family": "Titillium Web, sans-serif",
    });
    t.textContent = state.badge;
    badge.append(t);
    svg.append(badge);
  }
  return svg;
}

export function renderFlagIndicator(state: TrackFlagState): HTMLElement {
  const root = document.createElement("div");
  root.className = "flag-indicator";
  root.dataset.kind = state.kind;
  if (state.badge) root.dataset.badge = state.badge;
  const icon = document.createElement("div");
  icon.className = "flag-icon-wrap";
  icon.append(buildFlagSvg(state, { badge: false }));
  if (state.badge) {
    const badge = document.createElement("span");
    badge.className = "flag-badge";
    badge.textContent = state.badge;
    icon.append(badge);
  }
  root.append(icon);
  const name = document.createElement("div");
  name.className = "flag-name";
  name.textContent = state.label;
  root.append(name);
  return root;
}

export function mountFlagSheet(parent: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "flag-sheet-overlay";
  wrap.setAttribute("data-flagsheet", "1");
  const title = document.createElement("div");
  title.className = "flag-sheet-title";
  title.textContent = "Race control flags";
  const sheet = document.createElement("div");
  sheet.className = "flag-sheet";
  for (const kind of FLAG_SHEET_KINDS) {
    const cell = document.createElement("div");
    cell.className = "flag-sheet-cell";
    cell.dataset.kind = kind;
    const demo = sheetFlagState(kind);
    cell.append(buildFlagSvg(demo));
    const cap = document.createElement("div");
    cap.className = "flag-sheet-label";
    cap.textContent = FLAG_LABEL[kind];
    cell.append(cap);
    sheet.append(cell);
  }
  wrap.append(title, sheet);
  parent.append(wrap);
  return wrap;
}
