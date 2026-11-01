import { LIVE_POLL_MS, MQTT_URL, readRelayUrl } from "../config";
import { getAccessToken, peekAuth } from "./auth";
import { apiGet } from "./client";
import { LIVE_TOPICS } from "./liveMerge";

export type LiveSource = "mqtt" | "poll" | "off";

export type LiveHandle = { stop: () => void };

const POLL_PATHS = ["laps", "position", "intervals", "race_control", "weather", "pit", "stints"] as const;

export function startLiveFeed(opts: {
  username: string;
  sessionKey: number;
  onMessage: (topic: string, payload: unknown, mode: "merge" | "replace") => void;
  onStatus: (source: LiveSource, detail?: string) => void;
}): LiveHandle {
  let stopped = false;
  let client: { end: (force?: boolean) => void } | null = null;
  let pollTimer = 0;
  let pollIndex = 0;
  let tokenTimer = 0;
  let mqttAttempt: Promise<void> | null = null;

  const stopPoll = () => {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = 0;
  };

  const startPoll = (detail?: string) => {
    if (stopped || pollTimer) return;
    opts.onStatus("poll", detail);
    const tick = async () => {
      if (stopped) return;
      const path = POLL_PATHS[pollIndex++ % POLL_PATHS.length];
      try {
        const rows = await apiGet<unknown[]>(path, { session_key: opts.sessionKey }, { ttlMs: 0, force: true });
        const topic = path === "position" ? "v1/position" : `v1/${path}`;
        opts.onMessage(topic, rows, "replace");
      } catch {
        /* keep rotating */
      }
    };
    void tick();
    pollTimer = window.setInterval(() => void tick(), LIVE_POLL_MS);
  };

  const disconnectMqtt = () => {
    try {
      client?.end(true);
    } catch {
      /* ignore */
    }
    client = null;
  };

  const connectMqtt = async () => {
    if (stopped) return;
    let token = "";
    try {
      token = await getAccessToken();
    } catch (err) {
      startPoll(err instanceof Error ? err.message : "token refresh failed");
      return;
    }
    if (!token) {
      startPoll("No OpenF1 token");
      return;
    }
    try {
      const mqttMod = await import("mqtt");
      const mqtt = mqttMod.default;
      disconnectMqtt();
      const next = mqtt.connect(MQTT_URL, {
        username: opts.username || "openf1",
        password: token,
        reconnectPeriod: 5000,
        connectTimeout: 8000,
        clean: true,
      });
      client = next;
      next.on("connect", () => {
        if (stopped) return;
        stopPoll();
        opts.onStatus("mqtt");
        for (const topic of LIVE_TOPICS) next.subscribe(topic);
      });
      next.on("message", (topic, buf) => {
        if (stopped) return;
        try {
          opts.onMessage(topic, JSON.parse(buf.toString()), "merge");
        } catch {
          /* ignore malformed */
        }
      });
      next.on("error", () => {
        if (!stopped) startPoll("MQTT socket error");
      });
      next.on("offline", () => {
        if (!stopped) startPoll("MQTT offline");
      });
      const exp = peekAuth().expiresAt;
      const wait = Math.max(15_000, exp - Date.now() - 60_000);
      if (tokenTimer) window.clearTimeout(tokenTimer);
      tokenTimer = window.setTimeout(() => {
        if (stopped) return;
        disconnectMqtt();
        mqttAttempt = connectMqtt();
      }, Number.isFinite(wait) ? wait : 50 * 60 * 1000);
    } catch (err) {
      startPoll(err instanceof Error ? err.message : "MQTT unavailable");
    }
  };

  if (readRelayUrl()) {
    startPoll("Relay: REST poll every 4s (MQTT skipped)");
  } else {
    mqttAttempt = connectMqtt();
    window.setTimeout(() => {
      if (!stopped && !pollTimer) startPoll("Waiting for MQTT…");
    }, 4000);
  }

  return {
    stop: () => {
      stopped = true;
      stopPoll();
      if (tokenTimer) window.clearTimeout(tokenTimer);
      disconnectMqtt();
      void mqttAttempt;
      opts.onStatus("off");
    },
  };
}
