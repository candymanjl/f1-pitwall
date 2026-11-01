import type { DataMode } from "../config";
import type { LiveSource } from "../data/live";
import { formatClock } from "./time";

export function formatReplayBadge(opts: {
  mode: DataMode;
  followLive: boolean;
  playing: boolean;
  speed: number;
  liveSource: LiveSource;
}): string {
  if (opts.mode !== "live") return `replay ${opts.speed}×`;
  if (!opts.followLive) {
    return opts.playing ? `catch-up ${opts.speed}×` : `paused ${opts.speed}×`;
  }
  if (opts.liveSource === "mqtt") return "live mqtt";
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
    return `${prefix} / LAP ${n}/${Math.floor(opts.totalLaps)}`;
  }
  return `${prefix} / LAP ${n}`;
}
