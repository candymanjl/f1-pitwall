import { MQTT_URL, TOKEN_REFRESH_SKEW_MS } from "../config";
import type { PageId } from "./types";
import { getAccessToken, peekAuth } from "./auth";
import { apiGet, parseRetryAfterMs } from "./client";
import { OpenF1Error } from "./errors";
import {
  duePollSpecs,
  emptyLiveDebug,
  emptyRateState,
  fallbackSinceIso,
  FAST_POLL_MS,
  lastMessageAgeMs,
  lastSeenIso,
  livePollParams,
  LIVE_POLL_SPECS,
  LAPS_POLL_MS,
  LOCATION_POLL_MS,
  locationLiveSinceIso,
  MQTT_CAR_DATA_TOPIC,
  MQTT_SILENCE_MS,
  mqttTopicsForPage,
  nextDueInMs,
  nextPollDelayMs,
  pollSpecsForPage,
  recordTopicHit,
  seedLastRan,
  STINTS_POLL_MS,
  topicRates,
  type LivePollDebug,
  type LivePollSpec,
  type TopicRateState,
} from "./livePoll";
import { startLiveTabLock, type TabLockChannel, type TabLockHandle } from "./liveTabLock";

export type LiveSource = "mqtt" | "poll" | "off";

export type LiveHandle = { stop: () => void };

export type MqttLike = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  subscribe: (topic: string | string[]) => void;
  unsubscribe?: (topic: string | string[]) => void;
  end: (force?: boolean) => void;
};

export type ConnectMqttFn = (
  url: string,
  options: {
    username: string;
    password: string;
    reconnectPeriod: number;
    connectTimeout: number;
    clean: boolean;
  },
) => MqttLike;

async function defaultConnectMqtt(
  url: string,
  options: {
    username: string;
    password: string;
    reconnectPeriod: number;
    connectTimeout: number;
    clean: boolean;
  },
): Promise<MqttLike> {
  const mqttMod = await import("mqtt");
  return mqttMod.default.connect(url, options) as MqttLike;
}

function mqttUsername(raw: string): string {
  return raw.trim() || "pitwall";
}

/** Wait for OpenF1 to publish the new stint after a pit in, pit out, or lane change. */
export const STINT_AFTER_PIT_MS = 5_000;

function pitLaneEvent(topic: string, payload: unknown): boolean {
  const name = topic.replace(/^\//, "");
  if (name === "v1/pit") return true;
  if (name !== "v1/laps") return false;
  const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? [payload] : [];
  return rows.some((row) => !!row && typeof row === "object" && Boolean((row as { is_pit_out_lap?: boolean }).is_pit_out_lap));
}

function payloadFromMqtt(buf: unknown): unknown {
  const text =
    typeof buf === "string"
      ? buf
      : buf && typeof buf === "object" && "toString" in buf
        ? String((buf as { toString: () => string }).toString())
        : "";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function startLiveFeed(opts: {
  username: string;
  /** Loaded session key — a getter so picker changes never redirect the poll. */
  sessionKey: number | (() => number);
  cursors?: Record<string, string>;
  page?: () => PageId | undefined;
  /** Practice/Qualifying skip /intervals (OpenF1 404s; would burn the rate budget). */
  sessionName?: () => string | undefined;
  onMessage: (topic: string, payload: unknown, mode: "merge" | "replace") => void;
  onStatus: (source: LiveSource, detail?: string) => void;
  onDebug?: (debug: LivePollDebug) => void;
  /** Injected MQTT connect — used by tests with a mocked broker. */
  connectMqtt?: ConnectMqttFn;
  getToken?: () => Promise<string>;
  now?: () => number;
  /** `null` skips BroadcastChannel and this tab always leads. */
  tabChannel?: TabLockChannel | null;
}): LiveHandle {
  let stopped = false;
  let client: MqttLike | null = null;
  let pollTimer = 0;
  let polling = false;
  let tokenTimer = 0;
  let silenceTimer = 0;
  let mqttRetryTimer = 0;
  let pageTimer = 0;
  let mqttAttempt: Promise<void> | null = null;
  let mqttWanted = false;
  let mqttUp = false;
  let holdPoll = false;
  let carDataSub = false;
  let lastMqttAt = 0;
  let stintRushAt = 0;
  const cursors: Record<string, string> = { ...(opts.cursors ?? {}) };
  const lastRan: Record<string, number> = seedLastRan(Date.now());
  let failures = 0;
  let debug: LivePollDebug = emptyLiveDebug();
  const rates: TopicRateState = emptyRateState();
  const clock = opts.now ?? Date.now;
  const readToken = opts.getToken ?? getAccessToken;

  const loadedKey = (): number => {
    const key = typeof opts.sessionKey === "function" ? opts.sessionKey() : opts.sessionKey;
    return Number(key) || 0;
  };
  const loadedName = (): string | undefined => opts.sessionName?.();

  const report = (next: Partial<LivePollDebug>) => {
    const now = clock();
    debug = {
      ...debug,
      ...next,
      topicRates: next.topicRates ?? topicRates(rates, now),
      lastMessageAgeMs: next.lastMessageAgeMs ?? lastMessageAgeMs(debug.lastMessageAt, now),
    };
    opts.onDebug?.(debug);
  };

  const noteIncoming = (topic: string) => {
    const now = clock();
    recordTopicHit(rates, topic, now);
    const lastMessageAt = { ...debug.lastMessageAt, [topic]: now };
    report({ lastMessageAt, lastMessageAgeMs: 0, topicRates: topicRates(rates, now) });
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

  const fetchSpec = async (spec: LivePollSpec, sessionKey: number, since: string, added: Record<string, number>) => {
    lastRan[spec.path] = clock();
    try {
      const rows = await apiGet<unknown[]>(spec.path, livePollParams(spec, sessionKey, cursors, since), {
        ttlMs: 0,
        force: true,
      });
      const list = Array.isArray(rows) ? rows : [];
      added[spec.path] = list.length;
      if (!list.length) return "";
      if (spec.dateField) {
        const last = lastSeenIso(list, spec.dateField);
        if (last && last > (cursors[spec.path] || "")) cursors[spec.path] = last;
      }
      noteIncoming(spec.topic);
      opts.onMessage(spec.topic, list, "merge");
      return "";
    } catch (err) {
      const status = err instanceof OpenF1Error ? err.status : null;
      if (status === 404) {
        added[spec.path] = 0;
        return "";
      }
      if (status === 422 && spec.path === "location") {
        cursors.location = locationLiveSinceIso(clock());
        added[spec.path] = 0;
        return "422 location (cursor rewind)";
      }
      if (status === 429) {
        added[spec.path] = added[spec.path] ?? 0;
        return `429 ${spec.path}`;
      }
      return status ? `${status} ${spec.path}` : `${spec.path}: ${err instanceof Error ? err.message : "error"}`;
    }
  };

  /**
   * Location starts immediately and is never awaited before the other specs,
   * so a slow GPS dump cannot stall position / intervals.
   */
  const runDueSpecs = async (
    specs: LivePollSpec[],
    sessionKey: number,
    since: string,
  ): Promise<{ added: Record<string, number>; lastError: string; hardError: boolean; retryAfterMs: number }> => {
    const added: Record<string, number> = {};
    let lastError = "";
    let hardError = false;
    let retryAfterMs = 0;
    const loc = specs.find((s) => s.path === "location");
    const others = specs.filter((s) => s.path !== "location");
    const locWork = loc
      ? fetchSpec(loc, sessionKey, since, added).then((err) => {
          if (err) lastError = err;
          if (err.startsWith("429")) {
            retryAfterMs = Math.max(retryAfterMs, parseRetryAfterMs(null, 4000));
            hardError = true;
          } else if (err && !err.startsWith("422")) {
            const status = Number(err.slice(0, 3));
            if (!status || status >= 500) hardError = true;
          }
        })
      : Promise.resolve();
    for (const spec of others) {
      if (stopped) break;
      const err = await fetchSpec(spec, sessionKey, since, added);
      if (!err) continue;
      lastError = err;
      if (err.startsWith("429")) {
        retryAfterMs = Math.max(retryAfterMs, parseRetryAfterMs(null, 4000));
        hardError = true;
        break;
      }
      const status = Number(err.slice(0, 3));
      if (!status || status >= 500) hardError = true;
    }
    await locWork;
    return { added, lastError, hardError, retryAfterMs };
  };

  const backfillOnce = async () => {
    const sessionKey = loadedKey();
    if (!sessionKey) return;
    const started = clock();
    const specs = pollSpecsForPage(opts.page?.(), loadedName());
    const since = fallbackSinceIso(started);
    const { added, lastError } = await runDueSpecs(specs, sessionKey, since);
    if (stopped) return;
    report({ lastPollAt: clock(), lastCycleMs: clock() - started, added, lastError });
  };

  const locationMqttStale = () => {
    const at = debug.lastMessageAt["v1/location"];
    return !Number.isFinite(at) || clock() - at > LOCATION_POLL_MS * 2;
  };

  const stintsWanted = (now: number) => {
    if (stintRushAt && now >= stintRushAt) return true;
    return now - (lastRan.stints ?? 0) >= STINTS_POLL_MS;
  };

  const lapsWanted = (now: number) => now - (lastRan.laps ?? 0) >= LAPS_POLL_MS;

  const armStintRush = () => {
    const when = clock() + STINT_AFTER_PIT_MS;
    if (!stintRushAt || when < stintRushAt) stintRushAt = when;
  };

  const startPoll = (detail?: string) => {
    if (stopped || polling) return;
    if (holdPoll && !locationMqttStale() && !stintsWanted(clock()) && !lapsWanted(clock())) {
      if (!pollTimer) schedule(LOCATION_POLL_MS, detail);
      return;
    }
    if (pollTimer) {
      if (!holdPoll) opts.onStatus("poll", detail);
      return;
    }
    polling = true;
    if (!holdPoll) {
      report({ mode: "POLLING", lastError: detail || debug.lastError });
      opts.onStatus("poll", detail);
    }
    const tick = async () => {
      if (stopped) return;
      const sessionKey = loadedKey();
      if (!sessionKey) {
        schedule(FAST_POLL_MS, "Relay live");
        return;
      }
      const started = clock();
      const specs = duePollSpecs(opts.page?.(), lastRan, started, loadedName());
      let due = specs;
      if (holdPoll) {
        const keep = new Set<string>();
        if (locationMqttStale()) keep.add("location");
        if (stintsWanted(started)) keep.add("stints");
        if (lapsWanted(started)) keep.add("laps");
        due = pollSpecsForPage(opts.page?.(), loadedName()).filter((spec) => keep.has(spec.path));
        if (keep.has("stints") && !due.some((spec) => spec.path === "stints")) {
          const spec = LIVE_POLL_SPECS.find((row) => row.path === "stints");
          if (spec) due.push(spec);
        }
        if (keep.has("laps") && !due.some((spec) => spec.path === "laps")) {
          const spec = LIVE_POLL_SPECS.find((row) => row.path === "laps");
          if (spec) due.push(spec);
        }
        if (!due.length) {
          report({ mode: "STREAM" });
          schedule(LOCATION_POLL_MS, detail);
          return;
        }
      }
      if (!due.length) {
        schedule(holdPoll ? LOCATION_POLL_MS : nextDueInMs(opts.page?.(), lastRan, clock(), loadedName()), detail);
        return;
      }
      const since = fallbackSinceIso(started);
      const { added, lastError, hardError, retryAfterMs } = await runDueSpecs(due, sessionKey, since);

      if (stopped) return;
      if (holdPoll) {
        if (due.some((spec) => spec.path === "stints")) stintRushAt = 0;
        report({ mode: "STREAM", lastPollAt: clock(), lastCycleMs: clock() - started, added, lastError });
        schedule(LOCATION_POLL_MS, detail);
        return;
      }
      report({ mode: "POLLING", lastPollAt: clock(), lastCycleMs: clock() - started, added, lastError });
      if (hardError) {
        failures += 1;
        const wait = retryAfterMs || nextPollDelayMs(failures);
        opts.onStatus("poll", `Relay retry in ${Math.round(wait / 1000)}s`);
        schedule(wait, `Relay live (backoff ${failures})`);
        return;
      }
      failures = 0;
      opts.onStatus("poll", detail || "REST fallback");
      schedule(nextDueInMs(opts.page?.(), lastRan, clock(), loadedName()), detail || "REST fallback");
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
    mqttUp = false;
    carDataSub = false;
  };

  const clearSilence = () => {
    if (silenceTimer) window.clearTimeout(silenceTimer);
    silenceTimer = 0;
  };

  const armSilence = () => {
    clearSilence();
    silenceTimer = window.setTimeout(() => {
      silenceTimer = 0;
      if (stopped || !mqttWanted) return;
      if (!lastMqttAt || clock() - lastMqttAt >= MQTT_SILENCE_MS) {
        holdPoll = false;
        startPoll("MQTT silent 15s — REST fallback");
      }
      if (mqttWanted && !mqttUp) scheduleMqttRetry();
      armSilence();
    }, MQTT_SILENCE_MS);
  };

  const scheduleMqttRetry = () => {
    if (stopped || mqttRetryTimer || !mqttWanted) return;
    mqttRetryTimer = window.setTimeout(() => {
      mqttRetryTimer = 0;
      if (!stopped && mqttWanted && !mqttUp) mqttAttempt = connectMqtt();
    }, 8_000);
  };

  const syncCarDataSub = () => {
    if (!client || !mqttUp) return;
    const want = opts.page?.() === "telemetry";
    if (want && !carDataSub) {
      client.subscribe(MQTT_CAR_DATA_TOPIC);
      carDataSub = true;
    } else if (!want && carDataSub) {
      client.unsubscribe?.(MQTT_CAR_DATA_TOPIC);
      carDataSub = false;
    }
  };

  const enterStream = (detail?: string) => {
    holdPoll = true;
    report({ mode: "STREAM", lastError: detail || "" });
    opts.onStatus("mqtt", detail);
    if (!polling && !pollTimer) startPoll(detail);
  };

  const connectMqtt = async () => {
    if (stopped || !mqttWanted) return;
    let token = "";
    try {
      token = await readToken();
    } catch (err) {
      startPoll(err instanceof Error ? err.message : "token refresh failed");
      scheduleMqttRetry();
      return;
    }
    if (!token) {
      startPoll("No OpenF1 token");
      scheduleMqttRetry();
      return;
    }
    try {
      disconnectMqtt();
      const connect = opts.connectMqtt ?? ((url, options) => defaultConnectMqtt(url, options));
      const next = await Promise.resolve(
        connect(MQTT_URL, {
          username: mqttUsername(opts.username),
          password: token,
          reconnectPeriod: 5000,
          connectTimeout: 8000,
          clean: true,
        }),
      );
      if (stopped || !mqttWanted) {
        try {
          next.end(true);
        } catch {
          /* ignore */
        }
        return;
      }
      client = next;
      next.on("connect", () => {
        if (stopped || !mqttWanted) return;
        mqttUp = true;
        lastMqttAt = clock();
        enterStream();
        const topics = mqttTopicsForPage(opts.page?.());
        carDataSub = topics.includes(MQTT_CAR_DATA_TOPIC);
        next.subscribe(topics);
        void backfillOnce();
        armSilence();
      });
      next.on("message", (topic, buf) => {
        if (stopped) return;
        const payload = payloadFromMqtt(buf);
        if (payload == null) return;
        lastMqttAt = clock();
        noteIncoming(String(topic));
        enterStream();
        if (pitLaneEvent(String(topic), payload)) armStintRush();
        opts.onMessage(String(topic), payload, "merge");
        armSilence();
      });
      next.on("error", () => {
        mqttUp = false;
        holdPoll = false;
        if (!stopped) {
          startPoll("MQTT socket error");
          scheduleMqttRetry();
        }
      });
      next.on("offline", () => {
        mqttUp = false;
        holdPoll = false;
        if (!stopped) {
          startPoll("MQTT offline");
          scheduleMqttRetry();
        }
      });
      next.on("close", () => {
        mqttUp = false;
      });
      const exp = peekAuth().expiresAt;
      const wait = Number.isFinite(exp) && exp > 0
        ? Math.max(15_000, exp - clock() - TOKEN_REFRESH_SKEW_MS)
        : 50 * 60 * 1000;
      if (tokenTimer) window.clearTimeout(tokenTimer);
      tokenTimer = window.setTimeout(() => {
        if (stopped || !mqttWanted) return;
        disconnectMqtt();
        mqttAttempt = connectMqtt();
      }, wait);
    } catch (err) {
      startPoll(err instanceof Error ? err.message : "MQTT unavailable");
      scheduleMqttRetry();
    }
  };

  const startLeader = () => {
    if (stopped) return;
    mqttWanted = true;
    report({ tabRole: "leader" });
    mqttAttempt = connectMqtt();
    if (!pageTimer) {
      pageTimer = window.setInterval(() => {
        if (!stopped && mqttUp) syncCarDataSub();
      }, 1000);
    }
  };

  const becomeFollower = () => {
    mqttWanted = false;
    stopPoll();
    clearSilence();
    if (mqttRetryTimer) window.clearTimeout(mqttRetryTimer);
    mqttRetryTimer = 0;
    disconnectMqtt();
    report({ mode: "OFF", tabRole: "follower", lastError: "another tab is polling" });
    opts.onStatus("off", "Another tab is live");
  };

  let lock: TabLockHandle | null = null;
  lock = startLiveTabLock({
    now: clock,
    channel: opts.tabChannel,
    onRole: (role) => {
      if (stopped) return;
      if (role === "leader") startLeader();
      else becomeFollower();
    },
  });

  return {
    stop: () => {
      stopped = true;
      mqttWanted = false;
      stopPoll();
      clearSilence();
      if (tokenTimer) window.clearTimeout(tokenTimer);
      if (mqttRetryTimer) window.clearTimeout(mqttRetryTimer);
      if (pageTimer) window.clearInterval(pageTimer);
      disconnectMqtt();
      lock?.stop();
      void mqttAttempt;
      opts.onStatus("off");
    },
  };
}
