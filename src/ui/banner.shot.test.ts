/** @vitest-environment happy-dom */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldShowLiveLockBanner } from "../data/errors";

describe("live-lock banner vs signed-in token", () => {
  it("writes before/after HTML: banner stays up while REST is locked, signed in or not", () => {
    expect(shouldShowLiveLockBanner("live", false)).toBe(true);
    expect(shouldShowLiveLockBanner("live", true)).toBe(true);
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    const chrome = (authed: boolean, lock: "live" | null) => {
      const show = shouldShowLiveLockBanner(lock, authed);
      return `<!doctype html><html><head><meta charset="utf-8"><title>Lock ${authed ? "signed-in" : "signed-out"}</title>
<style>${css} html,body{margin:0;background:#07080d} .shot{width:1280px;padding:16px}</style></head>
<body><div class="shot">
<header class="topbar"><div class="brand"><span class="bar"></span><span>F1</span></div>
<div class="session-title">FORMULA 1 GRAN PREMIO DE LA CIUDAD DE MÉXICO 2026</div>
<div class="session-clock">RACE / LIVE</div><div class="brand-right"><span>F1</span> TV</div></header>
<nav class="nav"><button class="active">Track map</button><button>Timing</button><button>Strategy</button></nav>
${
  show
    ? `<div class="lock-banner"><strong>OpenF1 is locked while a live F1 session is running.</strong>
<p>Until that session ends, unauthenticated REST is blocked. Sign-in still works, but the browser often cannot send the bearer token.</p>
<div class="lock-actions"><button class="link">Open Settings</button><button class="primary">Retry</button></div></div>`
    : ""
}
<div class="auth-status" style="padding:8px 16px;color:#c5d0e6">${authed ? "Signed in as ada. Token refreshes automatically (~60 min left)." : "Not signed in."}</div>
<main style="padding:12px"><table class="tower"><thead><tr><th></th><th>Driver</th><th>Last</th></tr></thead>
<tbody>${authed ? "<tr><td class='pos'>1</td><td class='code'>NOR</td><td>1:18.214</td></tr><tr><td class='pos'>2</td><td class='code'>LEC</td><td>1:18.401</td></tr>" : "<tr><td colspan='3'>No session data loaded.</td></tr>"}</tbody></table></main>
</div></body></html>`;
    };
    writeFileSync("/tmp/lock-signed-out.html", chrome(false, "live"));
    writeFileSync("/tmp/lock-signed-in.html", chrome(true, "live"));
  });
});
