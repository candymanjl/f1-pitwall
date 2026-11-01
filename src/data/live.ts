import { LIVE_POLL_MS, MQTT_URL, readRelayUrl } from "../config";
import type { PageId } from "./types";
import { getAccessToken, peekAuth } from "./auth";
import { apiGet } from "./client";
import { LIVE_TOPICS } from "./liveMerge";
import { fallbackSinceIso, lastSeenIso, livePollParams, nextPollDelayMs, pollSpecsForPage } from "./livePoll";

export type LiveSource = "mqtt" | "poll" | "off";

export type LiveHandle = { stop: () => void };

export function startLiveFeed(opts: {
  username: string;
  /** Loaded session key — a getter so picker changes never redirect the poll. */
  sessionKey: number | (() => number);
  cursors?: Record<string, string>;
  page?: () => PageId | undefined;
  onMessage: (topic: string, payload: unknown, mode: "merge" | "replace") => void;
  onStatus: (source: LiveSource, detail?: string) => void;
}): LiveHandle {
  let stopped = false;
  let client: { end: (force?: boolean) => void } | null = null;
  let pollTimer = 0;
  let polling = false;
  let tokenTimer = 0;
  let mqttAttempt: Promise<void> | null = null;
  const cursors: Record<string, string> = { ...(opts.cursors ?? {}) };
  let failures = 0;

  const loadedKey = (): number => {
    const key = typeof opts.sessionKey === "function" ? opts.sessionKey() : opts.sessionKey;
    return Number(key) || 0;
  };

  const stopPoll = () => {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = 0;
    polling = false;
  };

  const startPoll = (detail?: string) => {
    if (stopped || polling) return;
    polling = true;
    opts.onStatus("poll", detail);
    const tick = async () => {
      if (stopped) return;
      const sessionKey = loadedKey();
      if (!sessionKey) {
        polling = false;
        pollTimer = window.setTimeout(() => {
          pollTimer = 0;
          if (!stopped) startPoll("Relay live");
        }, LIVE_POLL_MS);
        return;
      }
      const specs = pollSpecsForPage(opts.page?.());
      const since = fallbackSinceIso();
      let hadError = false;
      await Promise.all(
        specs.map(async (spec) => {
          try {
            const rows = await apiGet<unknown[]>(spec.path, livePollParams(spec, sessionKey, cursors, since), {
              ttlMs: 0,
              force: true,
            });
            if (!Array.isArray(rows) || !rows.length) return;
            if (spec.dateField) {
              const last = lastSeenIso(rows, spec.dateField);
              if (last && last > (cursors[spec.path] || "")) cursors[spec.path] = last;
            }
            opts.onMessage(spec.topic, rows, "merge");
          } catch {
            hadError = true;
          }
        }),
      );
      if (stopped) return;
      if (hadError) {
        failures += 1;
        const wait = nextPollDelayMs(failures);
        opts.onStatus("poll", `Relay retry in ${Math.round(wait / 1000)}s`);
        polling = false;
        pollTimer = window.setTimeout(() => {
          pollTimer = 0;
          if (!stopped) startPoll(`Relay live (backoff ${failures})`);
        }, wait);
        return;
      }
      failures = 0;
      opts.onStatus("poll", "Relay live");
      polling = false;
      pollTimer = window.setTimeout(() => {
        pollTimer = 0;
        if (!stopped) startPoll("Relay live");
      }, LIVE_POLL_MS);
    };
    void tick();
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
