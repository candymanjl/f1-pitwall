import type { DataMode } from "../config";
import type { LiveSource } from "../data/live";
import { formatClock } from "./time";

export function formatReplayBadge(opts: {
  mode: DataMode;
  followLive: boolean;
  playing: boolean;
  speed: number;
  liveSource: LiveSource;
  /** Age of the newest MQTT/REST live message. Null = nothing received yet. */
  streamAgeMs?: number | null;
  streamMode?: "STREAM" | "POLLING" | "OFF";
  /** Chosen live hold-back. 0 or omitted keeps the plain live label. */
  liveDelayMs?: number;
}): string {
  if (opts.mode !== "live") return `replay ${opts.speed}×`;
  if (!opts.followLive) {
    return opts.playing ? `catch-up ${opts.speed}×` : `paused ${opts.speed}×`;
  }
  const delayMs = opts.liveDelayMs ?? 0;
  if (delayMs > 0) {
    const label = `LIVE · ${Math.round(delayMs / 1000)}s delay`;
    const silent =
      opts.streamMode != null && opts.streamMode !== "STREAM"
        ? opts.liveSource === "mqtt"
        : opts.liveSource === "mqtt" && (opts.streamAgeMs == null || opts.streamAgeMs > 5_000);
    return silent ? `${label} · silent` : label;
  }
  if (opts.liveSource === "mqtt") {
    const silent =
      opts.streamMode != null && opts.streamMode !== "STREAM"
        ? true
        : opts.streamAgeMs == null || opts.streamAgeMs > 5_000;
    return silent ? "live mqtt · silent" : "live mqtt";
  }
  if (opts.liveSource === "poll") return "live polling";
  return "live";
}

export function formatSessionHeadline(opts: {
  sessionName?: string | null;
  elapsedMs: number;
  currentLap?: number | null;
  totalLaps?: number | null;
  race?: boolean;
}): string {
  const name = (opts.sessionName ?? "").trim().toUpperCase();
  const clock = formatClock(opts.elapsedMs);
  const prefix = name ? `${name} / ${clock}` : clock;
  const lap = opts.currentLap;
  if (lap == null || !Number.isFinite(lap) || lap < 1) return prefix;
  const n = Math.floor(lap);
  if (opts.race && opts.totalLaps && opts.totalLaps > 0) {
    return `${prefix} / Lap ${n} / ${Math.floor(opts.totalLaps)}`;
  }
  return `${prefix} / Lap ${n}`;
}
