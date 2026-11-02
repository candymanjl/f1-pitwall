export const LIVE_TAB_CHANNEL = "f1pitwall.live-lock";

export type TabLockRole = "leader" | "follower";

export type TabLockChannel = {
  postMessage: (msg: unknown) => void;
  addEventListener: (type: "message", listener: (ev: { data: unknown }) => void) => void;
  removeEventListener: (type: "message", listener: (ev: { data: unknown }) => void) => void;
  close?: () => void;
};

export type TabLockHandle = {
  role: () => TabLockRole;
  stop: () => void;
};

type LockMsg = {
  type: "hello" | "claim" | "heartbeat" | "release";
  tabId: string;
  at: number;
};

const HEARTBEAT_MS = 1500;
const STALE_MS = 4000;
const ELECT_MS = 80;

function isLockMsg(raw: unknown): raw is LockMsg {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    (o.type === "hello" || o.type === "claim" || o.type === "heartbeat" || o.type === "release") &&
    typeof o.tabId === "string" &&
    typeof o.at === "number"
  );
}

export function openLiveTabChannel(): TabLockChannel | null {
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    return new BroadcastChannel(LIVE_TAB_CHANNEL);
  } catch {
    return null;
  }
}

/**
 * First tab to claim stays leader. A stale leader (no heartbeat) is replaced.
 * Followers must not poll OpenF1.
 */
export function startLiveTabLock(opts: {
  now?: () => number;
  channel?: TabLockChannel | null;
  tabId?: string;
  onRole: (role: TabLockRole) => void;
}): TabLockHandle {
  const now = opts.now ?? Date.now;
  const tabId = opts.tabId ?? `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = opts.channel === undefined ? openLiveTabChannel() : opts.channel;
  let role: TabLockRole = channel ? "follower" : "leader";
  let stopped = false;
  let heartbeatTimer = 0;
  let electTimer = 0;
  let staleTimer = 0;
  let lastOther = 0;
  let otherLeader = "";

  const setRole = (next: TabLockRole) => {
    if (stopped || next === role) return;
    role = next;
    opts.onRole(role);
    if (role === "leader") startHeartbeat();
    else stopHeartbeat();
  };

  const post = (type: LockMsg["type"]) => {
    if (!channel || stopped) return;
    try {
      channel.postMessage({ type, tabId, at: now() } satisfies LockMsg);
    } catch {
      /* closed */
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    post("claim");
    post("heartbeat");
    heartbeatTimer = window.setInterval(() => post("heartbeat"), HEARTBEAT_MS);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
  };

  const armStale = () => {
    if (staleTimer) window.clearTimeout(staleTimer);
    staleTimer = window.setTimeout(() => {
      staleTimer = 0;
      if (stopped) return;
      if (now() - lastOther >= STALE_MS) {
        otherLeader = "";
        setRole("leader");
      }
    }, STALE_MS);
  };

  const onMessage = (ev: { data: unknown }) => {
    if (stopped || !isLockMsg(ev.data) || ev.data.tabId === tabId) return;
    lastOther = now();
    if (ev.data.type === "release") {
      if (ev.data.tabId === otherLeader) {
        otherLeader = "";
        setRole("leader");
      }
      return;
    }
    if (ev.data.type === "hello") {
      if (role === "leader") post("heartbeat");
      return;
    }
    otherLeader = ev.data.tabId;
    setRole("follower");
    armStale();
  };

  if (!channel) {
    opts.onRole("leader");
    return {
      role: () => "leader",
      stop: () => {
        stopped = true;
      },
    };
  }

  channel.addEventListener("message", onMessage);
  post("hello");
  electTimer = window.setTimeout(() => {
    electTimer = 0;
    if (stopped) return;
    if (!otherLeader) setRole("leader");
    else opts.onRole(role);
  }, ELECT_MS);

  return {
    role: () => role,
    stop: () => {
      stopped = true;
      if (electTimer) window.clearTimeout(electTimer);
      if (staleTimer) window.clearTimeout(staleTimer);
      stopHeartbeat();
      post("release");
      channel.removeEventListener("message", onMessage);
      try {
        channel.close?.();
      } catch {
        /* ignore */
      }
    },
  };
}
