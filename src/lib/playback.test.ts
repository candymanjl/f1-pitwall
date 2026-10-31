import { describe, expect, it } from "vitest";
import {
  followLiveFromScrub,
  followLiveOnPlay,
  isAtLiveEdge,
  liveEdgeMs,
  stepPlayback,
} from "./playback";

const START = 1_000_000;
const END = START + 60_000;
const MID = START + 20_000;

describe("live edge", () => {
  it("caps the live edge at session end", () => {
    expect(liveEdgeMs(END, END + 10_000)).toBe(END);
    expect(liveEdgeMs(END, MID)).toBe(MID);
  });

  it("treats a cursor near the newest sample as the live edge", () => {
    expect(isAtLiveEdge(END, END, END + 5_000)).toBe(true);
    expect(isAtLiveEdge(MID, END, END)).toBe(false);
    expect(followLiveFromScrub(END, END, END, "live")).toBe(true);
    expect(followLiveFromScrub(MID, END, END, "live")).toBe(false);
    expect(followLiveFromScrub(END, END, END, "historical")).toBe(false);
    expect(followLiveOnPlay(END - 200, END, END, "live")).toBe(true);
  });
});

describe("stepPlayback", () => {
  it("advances from the current scrub position at the chosen speed", () => {
    const next = stepPlayback({
      t: MID,
      start: START,
      end: END,
      playing: true,
      speed: 4,
      dt: 250,
      mode: "historical",
      followLive: false,
      now: END + 1_000,
    });
    expect(next.t).toBe(MID + 1000);
    expect(next.playing).toBe(true);
    expect(next.followLive).toBe(false);
  });

  it("does not jump to the session end when Play starts mid-session", () => {
    const next = stepPlayback({
      t: MID,
      start: START,
      end: END,
      playing: true,
      speed: 1,
      dt: 16,
      mode: "live",
      followLive: false,
      now: END,
    });
    expect(next.t).toBe(MID + 16);
    expect(next.t).toBeLessThan(END - 1000);
    expect(next.followLive).toBe(false);
  });

  it("holds the cursor on Pause even in live mode", () => {
    const next = stepPlayback({
      t: MID,
      start: START,
      end: END,
      playing: false,
      speed: 8,
      dt: 500,
      mode: "live",
      followLive: true,
      now: END,
    });
    expect(next.t).toBe(MID);
    expect(next.playing).toBe(false);
    expect(next.followLive).toBe(false);
  });

  it("follows the live edge only when armed and playing", () => {
    const follow = stepPlayback({
      t: MID,
      start: START,
      end: END,
      playing: true,
      speed: 4,
      dt: 16,
      mode: "live",
      followLive: true,
      now: END - 100,
    });
    expect(follow.t).toBe(END - 100);
    expect(follow.followLive).toBe(true);
    expect(follow.playing).toBe(true);
  });

  it("latches onto the live edge once playback catches it", () => {
    const next = stepPlayback({
      t: END - 50,
      start: START,
      end: END,
      playing: true,
      speed: 4,
      dt: 20,
      mode: "live",
      followLive: false,
      now: END - 40,
    });
    expect(next.t).toBe(END - 40);
    expect(next.followLive).toBe(true);
    expect(next.playing).toBe(true);
  });

  it("stops at the recorded end in historical mode", () => {
    const next = stepPlayback({
      t: END - 10,
      start: START,
      end: END,
      playing: true,
      speed: 4,
      dt: 20,
      mode: "historical",
      followLive: false,
      now: END + 5_000,
    });
    expect(next.t).toBe(END);
    expect(next.playing).toBe(false);
  });
});
