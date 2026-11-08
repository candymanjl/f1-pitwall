import { describe, expect, it } from "vitest";
import { parseTs } from "../lib/time";
import { FLAG_LABEL, FLAG_SHEET_KINDS, racingSector, sheetFlagState, trackFlagAt } from "./trackFlag";
import type { RaceControl } from "./types";

const T0 = "2025-10-26T20:00:00.000Z";

function rc(partial: Partial<RaceControl> & { date: string }): RaceControl {
  return {
    category: "Flag",
    flag: null,
    scope: null,
    message: null,
    lap_number: null,
    driver_number: null,
    sector: null,
    ...partial,
  };
}

function at(iso: string, plusSec = 0): number {
  return parseTs(iso) + plusSec * 1000;
}

describe("trackFlagAt", () => {
  it("starts green with no events", () => {
    const flag = trackFlagAt([], at(T0));
    expect(flag.kind).toBe("green");
    expect(flag.label).toBe("GREEN");
    expect(flag.badge).toBeNull();
  });

  it("shows a sector yellow with an S2 badge", () => {
    const flag = trackFlagAt(
      [rc({ date: T0, flag: "YELLOW", scope: "Sector", sector: 2, message: "YELLOW FLAG IN SECTOR 2" })],
      at(T0, 1),
    );
    expect(flag.kind).toBe("yellow");
    expect(flag.label).toBe("YELLOW");
    expect(flag.scope).toBe("Sector");
    expect(flag.badge).toBe("S2");
  });

  it("maps mini-sectors 9–16 onto racing sector 2", () => {
    expect(racingSector({ sector: 11, message: null, scope: "Sector" })).toBe(2);
    const flag = trackFlagAt(
      [rc({ date: T0, flag: "YELLOW", scope: "Sector", sector: 11, message: "YELLOW" })],
      at(T0, 1),
    );
    expect(flag.badge).toBe("S2");
  });

  it("clears only that sector on CLEAR, then a later GREEN clears remaining yellows", () => {
    const events = [
      rc({ date: T0, flag: "YELLOW", scope: "Sector", sector: 1, message: "YELLOW S1" }),
      rc({ date: "2025-10-26T20:00:10.000Z", flag: "DOUBLE YELLOW", scope: "Sector", sector: 2, message: "DY S2" }),
      rc({ date: "2025-10-26T20:00:20.000Z", flag: "CLEAR", scope: "Sector", sector: 2, message: "CLEAR S2" }),
      rc({ date: "2025-10-26T20:00:40.000Z", flag: "GREEN", scope: "Track", message: "GREEN FLAG" }),
    ];
    const duringBoth = trackFlagAt(events, at("2025-10-26T20:00:15.000Z"));
    expect(duringBoth.kind).toBe("doubleYellow");
    expect(duringBoth.badge).toBe("S1+S2");

    const afterClear = trackFlagAt(events, at("2025-10-26T20:00:25.000Z"));
    expect(afterClear.kind).toBe("yellow");
    expect(afterClear.badge).toBe("S1");

    const afterGreen = trackFlagAt(events, at("2025-10-26T20:00:41.000Z"));
    expect(afterGreen.kind).toBe("green");
    expect(afterGreen.badge).toBeNull();
  });

  it("ignores future events so replay and live share the same clock", () => {
    const events = [
      rc({ date: T0, flag: "YELLOW", scope: "Sector", sector: 2, message: "YELLOW" }),
      rc({ date: "2025-10-26T20:05:00.000Z", flag: "RED", scope: "Track", message: "RED FLAG" }),
    ];
    expect(trackFlagAt(events, at("2025-10-26T20:01:00.000Z")).kind).toBe("yellow");
    expect(trackFlagAt(events, at("2025-10-26T20:05:01.000Z")).kind).toBe("red");
  });

  it("shows RED FLAG over sector yellows", () => {
    const flag = trackFlagAt(
      [
        rc({ date: T0, flag: "YELLOW", scope: "Sector", sector: 3, message: "YELLOW" }),
        rc({ date: "2025-10-26T20:00:05.000Z", flag: "RED", scope: "Track", message: "RED FLAG" }),
      ],
      at("2025-10-26T20:00:06.000Z"),
    );
    expect(flag.kind).toBe("red");
    expect(flag.label).toBe("RED FLAG");
    expect(flag.badge).toBeNull();
  });

  it("shows SAFETY CAR from a deploy message and keeps it over yellows", () => {
    const events = [
      rc({ date: T0, category: "SafetyCar", message: "SAFETY CAR DEPLOYED" }),
      rc({ date: "2025-10-26T20:00:04.000Z", flag: "YELLOW", scope: "Sector", sector: 1, message: "YELLOW" }),
    ];
    const flag = trackFlagAt(events, at("2025-10-26T20:00:05.000Z"));
    expect(flag.kind).toBe("sc");
    expect(flag.label).toBe("SAFETY CAR");
  });

  it("shows VSC from category or message, then returns to green when it ends", () => {
    const events = [
      rc({ date: T0, category: "VSC", message: "VIRTUAL SAFETY CAR DEPLOYED" }),
      rc({ date: "2025-10-26T20:01:00.000Z", category: "SafetyCar", message: "VIRTUAL SAFETY CAR ENDING" }),
    ];
    expect(trackFlagAt(events, at("2025-10-26T20:00:30.000Z"))).toMatchObject({ kind: "vsc", label: "VSC" });
    expect(trackFlagAt(events, at("2025-10-26T20:01:01.000Z")).kind).toBe("green");
  });

  it("keeps GREEN when a lapped car gets a blue flag", () => {
    const flag = trackFlagAt(
      [
        rc({ date: T0, flag: "GREEN", scope: "Track", message: "GREEN FLAG" }),
        rc({
          date: "2025-10-26T20:00:05.000Z",
          flag: "BLUE",
          scope: "Driver",
          driver_number: 44,
          message: "BLUE FLAG",
        }),
      ],
      at("2025-10-26T20:00:06.000Z"),
    );
    expect(flag.kind).toBe("green");
    expect(flag.badge).toBeNull();
  });

  it("keeps SAFETY CAR when a blue flag arrives during SC", () => {
    const flag = trackFlagAt(
      [
        rc({ date: T0, category: "SafetyCar", message: "SAFETY CAR DEPLOYED" }),
        rc({
          date: "2025-10-26T20:00:04.000Z",
          flag: "BLUE",
          scope: "Driver",
          driver_number: 22,
          message: "BLUE FLAG FOR CAR 22",
        }),
      ],
      at("2025-10-26T20:00:05.000Z"),
    );
    expect(flag.kind).toBe("sc");
    expect(flag.label).toBe("SAFETY CAR");
  });

  it("ignores black and white and other car-only flags even with missing scope", () => {
    const events = [
      rc({ date: T0, flag: "GREEN", scope: "Track", message: "GREEN FLAG" }),
      rc({ date: "2025-10-26T20:00:03.000Z", flag: "BLACK AND WHITE", message: "BLACK AND WHITE FLAG" }),
      rc({ date: "2025-10-26T20:00:04.000Z", flag: "BLACK AND ORANGE", message: "BLACK AND ORANGE" }),
      rc({ date: "2025-10-26T20:00:05.000Z", flag: "BLACK", message: "BLACK FLAG" }),
    ];
    expect(trackFlagAt(events, at("2025-10-26T20:00:06.000Z")).kind).toBe("green");
  });

  it("ignores a yellow that carries a driver_number", () => {
    const flag = trackFlagAt(
      [
        rc({ date: T0, flag: "GREEN", scope: "Track", message: "GREEN FLAG" }),
        rc({
          date: "2025-10-26T20:00:04.000Z",
          flag: "YELLOW",
          driver_number: 16,
          message: "YELLOW FLAG",
        }),
      ],
      at("2025-10-26T20:00:05.000Z"),
    );
    expect(flag.kind).toBe("green");
  });

  it("ignores penalty and admin messages so they do not blank the track flag", () => {
    const flag = trackFlagAt(
      [
        rc({ date: T0, category: "SafetyCar", message: "SAFETY CAR DEPLOYED" }),
        rc({
          date: "2025-10-26T20:00:04.000Z",
          category: "Other",
          message: "10 SECOND TIME PENALTY FOR CAR 44",
        }),
        rc({
          date: "2025-10-26T20:00:05.000Z",
          category: "Penalty",
          message: "DRIVE THROUGH PENALTY",
        }),
      ],
      at("2025-10-26T20:00:06.000Z"),
    );
    expect(flag.kind).toBe("sc");
  });

  it("clears only that sector on a Sector GREEN FLAG, not all sectors", () => {
    const events = [
      rc({ date: T0, flag: "YELLOW", scope: "Sector", sector: 1, message: "YELLOW S1" }),
      rc({ date: "2025-10-26T20:00:10.000Z", flag: "DOUBLE YELLOW", scope: "Sector", sector: 2, message: "DY S2" }),
      rc({
        date: "2025-10-26T20:00:20.000Z",
        flag: "GREEN",
        scope: "Sector",
        sector: 2,
        message: "GREEN FLAG IN SECTOR 2",
      }),
    ];
    const afterSectorGreen = trackFlagAt(events, at("2025-10-26T20:00:21.000Z"));
    expect(afterSectorGreen.kind).toBe("yellow");
    expect(afterSectorGreen.badge).toBe("S1");
  });

  it("still applies missing-scope red, chequered, and SC deploy", () => {
    expect(trackFlagAt([rc({ date: T0, flag: "RED", message: "RED FLAG" })], at(T0, 1)).kind).toBe("red");
    expect(trackFlagAt([rc({ date: T0, flag: "CHEQUERED", message: "CHEQUERED FLAG" })], at(T0, 1)).kind).toBe(
      "chequered",
    );
    expect(
      trackFlagAt([rc({ date: T0, category: "SafetyCar", message: "SAFETY CAR DEPLOYED" })], at(T0, 1)).kind,
    ).toBe("sc");
    expect(
      trackFlagAt([rc({ date: T0, category: "VSC", message: "VIRTUAL SAFETY CAR DEPLOYED" })], at(T0, 1)).kind,
    ).toBe("vsc");
    expect(trackFlagAt([rc({ date: T0, flag: "GREEN", message: "GREEN FLAG" })], at(T0, 1)).kind).toBe("green");
  });

  it("does not treat pit-exit green lights as a track clear", () => {
    const flag = trackFlagAt(
      [
        rc({ date: T0, flag: "YELLOW", scope: "Sector", sector: 2, message: "YELLOW" }),
        rc({
          date: "2025-10-26T20:00:08.000Z",
          flag: "GREEN",
          message: "GREEN LIGHT - PIT EXIT OPEN",
        }),
      ],
      at("2025-10-26T20:00:09.000Z"),
    );
    expect(flag.kind).toBe("yellow");
    expect(flag.badge).toBe("S2");
  });

  it("recognizes chequered and slippery aliases on the track indicator", () => {
    expect(trackFlagAt([rc({ date: T0, flag: "CHEQUERED", scope: "Track" })], at(T0, 1)).kind).toBe("chequered");
    expect(trackFlagAt([rc({ date: T0, flag: "YELLOW AND RED", scope: "Track" })], at(T0, 1)).kind).toBe("slippery");
  });
});

describe("flag labels", () => {
  it("keeps every published label free of dashes", () => {
    for (const kind of FLAG_SHEET_KINDS) {
      expect(FLAG_LABEL[kind]).not.toMatch(/[-–—]/);
      expect(sheetFlagState(kind).label).toBe(FLAG_LABEL[kind]);
    }
  });

  it("puts a sector or car badge on the sheet demos that need one", () => {
    expect(sheetFlagState("yellow").badge).toBe("S2");
    expect(sheetFlagState("doubleYellow").badge).toBe("S1");
    expect(sheetFlagState("blue").badge).toBe("CAR 44");
    expect(sheetFlagState("sc").badge).toBeNull();
  });
});
