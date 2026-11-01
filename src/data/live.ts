import { MQTT_URL, readRelayUrl } from "../config";
import type { PageId } from "./types";
import { getAccessToken, peekAuth } from "./auth";
import { apiGet, parseRetryAfterMs } from "./client";
import { OpenF1Error } from "./errors";
import { LIVE_TOPICS } from "./liveMerge";
import {
  duePollSpecs,
  emptyLiveDebug,
  fallbackSinceIso,
  FAST_POLL_MS,
  lastSeenIso,
  livePollParams,
  nextDueInMs,
  nextPollDelayMs,
  seedLastRan,
  type LivePollDebug,
} from "./livePoll";

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
  onDebug?: (debug: LivePollDebug) => void;
}): LiveHandle {
  let stopped = false;
  let client: { end: (force?: boolean) => void } | null = null;
  let pollTimer = 0;
  let polling = false;
  let tokenTimer = 0;
  let mqttAttempt: Promise<void> | null = null;
  const cursors: Record<string, string> = { ...(opts.cursors ?? {}) };
  const lastRan: Record<string, number> = seedLastRan(Date.now());
  let failures = 0;
  let debug: LivePollDebug = emptyLiveDebug();

  const loadedKey = (): number => {
    const key = typeof opts.sessionKey === "function" ? opts.sessionKey() : opts.sessionKey;
    return Number(key) || 0;
  };

  const report = (next: Partial<LivePollDebug>) => {
    debug = { ...debug, ...next };
    opts.onDebug?.(debug);
  };

  const stopPoll = () => {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = 0;
    polling = false;
  };

  const schedule = (wait: number, detail?: string) => {
    polling = false;
    pollTimer = window.setTimeout(() => {
      pollTimer = 0;
      if (!stopped) startPoll(detail);
    }, wait);
  };

  const startPoll = (detail?: string) => {
    if (stopped || polling) return;
    polling = true;
    opts.onStatus("poll", detail);
    const tick = async () => {
      if (stopped) return;
      const sessionKey = loadedKey();
      if (!sessionKey) {
        schedule(FAST_POLL_MS, "Relay live");
        return;
      }
      const started = Date.now();
      const specs = duePollSpecs(opts.page?.(), lastRan, started);
      const since = fallbackSinceIso();
      const added: Record<string, number> = {};
      let lastError = "";
      let retryAfterMs = 0;
      let hardError = false;

      for (const spec of specs) {
        if (stopped) return;
        lastRan[spec.path] = Date.now();
        try {
          const rows = await apiGet<unknown[]>(spec.path, livePollParams(spec, sessionKey, cursors, since), {
            ttlMs: 0,
            force: true,
          });
          const list = Array.isArray(rows) ? rows : [];
          added[spec.path] = list.length;
          if (!list.length) continue;
          if (spec.dateField) {
            const last = lastSeenIso(list, spec.dateField);
            if (last && last > (cursors[spec.path] || "")) cursors[spec.path] = last;
          }
          opts.onMessage(spec.topic, list, "merge");
        } catch (err) {
          const status = err instanceof OpenF1Error ? err.status : null;
          if (status === 404) {
            added[spec.path] = 0;
            continue;
          }
          if (status === 429) {
            retryAfterMs = Math.max(retryAfterMs, parseRetryAfterMs(null, 4000));
            lastError = `429 ${spec.path}`;
            hardError = true;
            break;
          }
          lastError = status ? `${status} ${spec.path}` : `${spec.path}: ${err instanceof Error ? err.message : "error"}`;
          if (!status || status >= 500) hardError = true;
        }
      }

      if (stopped) return;
      report({ lastPollAt: Date.now(), lastCycleMs: Date.now() - started, added, lastError });
      if (hardError) {
        failures += 1;
        const wait = retryAfterMs || nextPollDelayMs(failures);
        opts.onStatus("poll", `Relay retry in ${Math.round(wait / 1000)}s`);
        schedule(wait, `Relay live (backoff ${failures})`);
        return;
      }
      failures = 0;
      opts.onStatus("poll", "Relay live");
      schedule(nextDueInMs(opts.page?.(), lastRan, Date.now()), "Relay live");
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
    startPoll("Relay: staggered REST poll (MQTT skipped)");
  } else {
    mqttAttempt = connectMqtt();
    window.setTimeout(() => {
      if (!stopped && !pollTimer && !polling) startPoll("Waiting for MQTT…");
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
