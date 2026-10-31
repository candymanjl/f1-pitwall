import { DEFAULT_PIT_LOSS, readToken } from "../config";
import { peekAuth, signIn, signOut, writeManualToken } from "../data/auth";
import { el } from "../lib/dom";
import { UI_SCALE_OPTIONS, type UiScalePref } from "../lib/scale";
import { clearLiveLock, retryNow, setDataMode, setPitLoss, setUiScale, state, syncLiveFeed } from "../state";
import { closeAllModals } from "./overlays";

function labeled(label: string, input: HTMLElement): HTMLElement {
  return el("div", {}, [el("label", { text: label }), input]);
}

function authStatusText(): string {
  const a = peekAuth();
  if (a.signedIn && a.username) {
    const mins = Math.max(0, Math.round((a.expiresAt - Date.now()) / 60000));
    return `Signed in as ${a.username}. Token refreshes automatically (~${mins} min left).`;
  }
  if (a.source === "manual") return "Using a manually pasted bearer token (no auto-refresh).";
  return "Not signed in.";
}

export function openSettings(): void {
  closeAllModals();
  const bg = el("div", { class: "modal-bg" });
  const user = el("input", { type: "email", placeholder: "OpenF1 username or email" }) as HTMLInputElement;
  user.value = peekAuth().username;
  const pass = el("input", { type: "password", placeholder: "OpenF1 password" }) as HTMLInputElement;
  const status = el("p", { class: "auth-status", text: authStatusText() });
  const authErr = el("p", { class: "auth-error" });
  authErr.hidden = true;
  const signInBtn = el("button", { class: "primary", text: peekAuth().signedIn ? "Refresh token" : "Sign in" });
  const signOutBtn = el("button", { class: "ghost", text: "Sign out" });
  signOutBtn.hidden = !peekAuth().signedIn;

  const token = el("input", { type: "password", placeholder: "Bearer token (optional fallback)" }) as HTMLInputElement;
  token.value = readToken();
  const mode = el("select") as HTMLSelectElement;
  mode.append(el("option", { value: "historical", text: "Historical replay (REST)" }));
  mode.append(el("option", { value: "live", text: "Live (MQTT over WebSocket, REST fallback)" }));
  mode.value = state.mode;
  const scale = el("select") as HTMLSelectElement;
  for (const opt of UI_SCALE_OPTIONS) {
    const label = opt === "auto" ? "Auto (fit viewport)" : `${opt}%`;
    scale.append(el("option", { value: String(opt), text: label }));
  }
  scale.value = String(state.uiScale);
  const g = el("input", { type: "number", step: "0.1" }) as HTMLInputElement;
  const v = el("input", { type: "number", step: "0.1" }) as HTMLInputElement;
  const s = el("input", { type: "number", step: "0.1" }) as HTMLInputElement;
  g.value = String(state.pitLoss.green);
  v.value = String(state.pitLoss.vsc);
  s.value = String(state.pitLoss.sc);
  const save = el("button", { class: "primary", text: "Save" });
  const cancel = el("button", { class: "ghost", text: "Cancel" });
  const reset = el("button", { class: "ghost", text: "Reset pit loss" });

  const setBusy = (busy: boolean) => {
    signInBtn.disabled = busy;
    signInBtn.textContent = busy ? "Signing in…" : peekAuth().signedIn ? "Refresh token" : "Sign in";
  };

  const refreshAuthChrome = () => {
    status.textContent = authStatusText();
    signOutBtn.hidden = !peekAuth().signedIn;
    signInBtn.textContent = peekAuth().signedIn ? "Refresh token" : "Sign in";
    user.value = peekAuth().username || user.value;
  };

  signInBtn.onclick = async () => {
    authErr.hidden = true;
    setBusy(true);
    try {
      await signIn(user.value, pass.value);
      pass.value = "";
      refreshAuthChrome();
      clearLiveLock();
      syncLiveFeed();
      void retryNow();
    } catch (err) {
      authErr.hidden = false;
      authErr.textContent = err instanceof Error ? err.message : "Sign-in failed.";
    } finally {
      setBusy(false);
    }
  };

  signOutBtn.onclick = () => {
    signOut();
    pass.value = "";
    refreshAuthChrome();
    syncLiveFeed();
  };

  bg.append(
    el("div", { class: "modal" }, [
      el("h2", { text: "Settings" }),
      el("p", {
        text: "Sign in with your OpenF1 account to unlock live sessions and raise rate limits. Username and password stay in this browser (localStorage) and are never committed. You accepted that risk for this static GitHub Pages app.",
      }),
      el("label", { text: "OpenF1 username" }),
      user,
      el("label", { text: "OpenF1 password" }),
      pass,
      el("div", { class: "row" }, [signInBtn, signOutBtn]),
      status,
      authErr,
      el("label", { text: "Data mode" }),
      mode,
      el("label", { text: "UI scale" }),
      scale,
      el("p", {
        text: "Auto grows the pitwall to fill 1440p / 4K without browser zoom. Manual 100–200% locks the rem root size. Driver hit targets stay at least 14 CSS px.",
      }),
      el("details", { class: "advanced" }, [
        el("summary", { text: "Advanced — paste a bearer token" }),
        el("p", {
          text: "Optional fallback if sign-in is unavailable. A pasted token is not refreshed; prefer Sign in above.",
        }),
        token,
      ]),
      el("p", { text: "Pit loss used by the pit circle ghost and strategy model (seconds, estimates)." }),
      el("div", { class: "row" }, [labeled("Green", g), labeled("VSC", v), labeled("SC", s)]),
      el("div", { class: "row" }, [save, reset, cancel]),
    ]),
  );

  save.onclick = () => {
    writeManualToken(token.value);
    setDataMode(mode.value === "live" ? "live" : "historical");
    setPitLoss({ green: Number(g.value), vsc: Number(v.value), sc: Number(s.value) });
    const pref = scale.value === "auto" ? "auto" : (Number(scale.value) as UiScalePref);
    setUiScale(pref);
    closeAllModals();
    if (state.lock === "live" || peekAuth().signedIn || token.value.trim()) void retryNow();
  };
  reset.onclick = () => {
    g.value = String(DEFAULT_PIT_LOSS.green);
    v.value = String(DEFAULT_PIT_LOSS.vsc);
    s.value = String(DEFAULT_PIT_LOSS.sc);
  };
  cancel.onclick = () => closeAllModals();
  bg.addEventListener("click", (ev) => {
    if (ev.target === bg) closeAllModals();
  });
  document.body.append(bg);
}
