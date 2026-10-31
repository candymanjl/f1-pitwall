import { describe, expect, it } from "vitest";
import {
  anchorForPace,
  buildStopPlans,
  compoundRuleStatus,
  crossoverAge,
  defaultTyreModel,
  fitTyreModel,
  gripIndex,
  lapTimeLoss,
  planMeetsCompoundRule,
  predictedLapTime,
  prepareFitLaps,
  readTyreStore,
  resetTyreStore,
  writeTyreStore,
  type FitLapInput,
  type TyreModel,
} from "./tyres";

function lap(partial: Partial<FitLapInput> & Pick<FitLapInput, "lapNumber" | "lapTime">): FitLapInput {
  return {
    driver: 1,
    isPitOut: false,
    dateStart: 1_000_000 + partial.lapNumber * 90_000,
    compound: "SOFT",
    stintStart: 1,
    tyreAgeAtStart: 0,
    isPitIn: false,
    inSc: false,
    interval: null,
    ...partial,
  };
}

describe("lap time loss interpolation", () => {
  const cliff = {
    offset: 0,
    degPerLap: 0.05,
    lifespan: 20,
    shape: "cliff" as const,
    cliffLap: 10,
    cliffDeg: 0.2,
  };

  it("interpolates fractional ages on the cliff polyline", () => {
    expect(lapTimeLoss(cliff, 0)).toBe(0);
    expect(lapTimeLoss(cliff, 10)).toBeCloseTo(0.5);
    expect(lapTimeLoss(cliff, 12)).toBeCloseTo(1);
    const mid = (lapTimeLoss(cliff, 11) + lapTimeLoss(cliff, 12)) / 2;
    expect(lapTimeLoss(cliff, 11.5)).toBeCloseTo(mid);
  });

  it("ignores the cliff when the shape is a linear fade", () => {
    expect(lapTimeLoss({ ...cliff, shape: "linear" }, 12)).toBeCloseTo(0.6);
  });

  it("interpolates grip from new to the end of the useful life", () => {
    const model = defaultTyreModel();
    model.compounds.SOFT = { ...cliff, shape: "linear", offset: 0 };
    expect(gripIndex(model, "SOFT", 0)).toBeCloseTo(1);
    expect(gripIndex(model, "SOFT", 10)).toBeCloseTo(0.5);
    expect(gripIndex(model, "SOFT", 20)).toBeCloseTo(0);
    expect(gripIndex(model, "SOFT", 5.5)).toBeCloseTo(1 - 5.5 / 20);
  });

  it("applies fuel as a gain on later race laps", () => {
    const model = defaultTyreModel();
    const fresh = predictedLapTime(model, "SOFT", 0, 0);
    const later = predictedLapTime(model, "SOFT", 0, 10);
    expect(fresh - later).toBeCloseTo(0.3);
  });
});

describe("crossover", () => {
  it("finds the stint lap where a harder tyre takes over", () => {
    const model = defaultTyreModel();
    model.compounds.SOFT = {
      offset: 0,
      degPerLap: 0.1,
      lifespan: 40,
      shape: "linear",
      cliffLap: 30,
      cliffDeg: 0.5,
    };
    model.compounds.HARD = {
      offset: 1,
      degPerLap: 0.02,
      lifespan: 40,
      shape: "linear",
      cliffLap: 30,
      cliffDeg: 0,
    };
    // 0.1a = 1 + 0.02a → a = 12.5
    expect(crossoverAge(model, "SOFT", "HARD")).toBeCloseTo(12.5, 2);
    expect(crossoverAge(model, "HARD", "SOFT")).toBeNull();
  });

  it("returns null when the slopes never meet", () => {
    const model = defaultTyreModel();
    model.compounds.SOFT.degPerLap = 0.02;
    model.compounds.SOFT.shape = "linear";
    model.compounds.MEDIUM.offset = 1;
    model.compounds.MEDIUM.degPerLap = 0.02;
    model.compounds.MEDIUM.shape = "linear";
    expect(crossoverAge(model, "SOFT", "MEDIUM", 40)).toBeNull();
  });
});

describe("two-compound rule", () => {
  it("rejects a single dry compound and allows a mix", () => {
    expect(planMeetsCompoundRule(["MEDIUM", "MEDIUM"], true)).toBe(false);
    expect(planMeetsCompoundRule(["MEDIUM", "HARD"], true)).toBe(true);
    expect(planMeetsCompoundRule(["SOFT", "SOFT", "SOFT"], true)).toBe(false);
  });

  it("lifts the rule when the race is declared wet or inters are used", () => {
    expect(compoundRuleStatus({ rainfall: 0, messages: [], compoundsSeen: ["SOFT", "MEDIUM"] }).ruleActive).toBe(
      true,
    );
    const wet = compoundRuleStatus({ rainfall: 1.2, messages: [], compoundsSeen: ["SOFT"] });
    expect(wet.declaredWet).toBe(true);
    expect(wet.ruleActive).toBe(false);
    expect(planMeetsCompoundRule(["INTERMEDIATE", "INTERMEDIATE"], wet.ruleActive)).toBe(true);
    const used = compoundRuleStatus({
      rainfall: 0,
      messages: ["CHANGE TO INTERMEDIATE TYRES"],
      compoundsSeen: ["INTERMEDIATE"],
    });
    expect(used.ruleActive).toBe(false);
    expect(planMeetsCompoundRule(["SOFT", "SOFT"], false)).toBe(true);
  });

  it("drops single-compound plans from the 1/2/3-stop ranking", () => {
    const model: TyreModel = defaultTyreModel();
    model.fuelPerLap = 0;
    model.compounds.MEDIUM = {
      offset: 0,
      degPerLap: 0.001,
      lifespan: 80,
      shape: "linear",
      cliffLap: 40,
      cliffDeg: 0,
    };
    model.compounds.HARD = {
      offset: 0.4,
      degPerLap: 0.001,
      lifespan: 80,
      shape: "linear",
      cliffLap: 40,
      cliffDeg: 0,
    };
    model.compounds.SOFT = {
      offset: 2,
      degPerLap: 0.2,
      lifespan: 12,
      shape: "linear",
      cliffLap: 8,
      cliffDeg: 0,
    };
    const common = {
      model,
      remaining: 16,
      raceLap: 10,
      currentCompound: "MEDIUM" as const,
      currentAge: 2,
      pitLoss: 22,
      setsLeft: { SOFT: 2, MEDIUM: 2, HARD: 2 },
      anchor: model.baseLap,
    };
    const dry = buildStopPlans({ ...common, ruleActive: true });
    expect(dry.excluded).toBeGreaterThan(0);
    expect(dry.plans.length).toBeGreaterThan(0);
    for (const plan of dry.plans) {
      expect(new Set(plan.stints.map((stint) => stint.compound)).size).toBeGreaterThanOrEqual(2);
    }
    const bestDry = [...dry.plans].sort((a, b) => a.total - b.total)[0];
    expect(bestDry.stints.some((stint) => stint.compound === "HARD")).toBe(true);

    const lifted = buildStopPlans({ ...common, ruleActive: false });
    const bestWet = [...lifted.plans].sort((a, b) => a.total - b.total)[0];
    expect(new Set(bestWet.stints.map((stint) => stint.compound))).toEqual(new Set(["MEDIUM"]));
    expect(bestWet.total).toBeLessThan(bestDry.total);
  });
});

describe("clean laps and fit", () => {
  it("excludes in-laps, out-laps, safety car, and traffic", () => {
    const laps: FitLapInput[] = [
      lap({ lapNumber: 1, lapTime: 80 }),
      lap({ lapNumber: 2, lapTime: 80.1 }),
      lap({ lapNumber: 3, lapTime: 80.2, isPitOut: true }),
      lap({ lapNumber: 4, lapTime: 80.2, isPitIn: true }),
      lap({ lapNumber: 5, lapTime: 90, inSc: true }),
      lap({ lapNumber: 6, lapTime: 80.4, interval: 0.4 }),
      lap({ lapNumber: 7, lapTime: 83, interval: null }),
      lap({ lapNumber: 8, lapTime: 80.5 }),
    ];
    const { clean, counts } = prepareFitLaps(laps);
    expect(clean.map((row) => row.lapNumber)).toEqual([1, 2, 8]);
    expect(counts.inOut).toBe(2);
    expect(counts.sc).toBe(1);
    expect(counts.traffic).toBe(2);
  });

  it("recovers offset, deg, and a high R² from a synthetic long run", () => {
    const laps: FitLapInput[] = [];
    const push = (compound: "SOFT" | "MEDIUM", offset: number, deg: number, start: number) => {
      for (let i = 0; i < 12; i++) {
        laps.push(
          lap({
            driver: compound === "SOFT" ? 1 : 2,
            lapNumber: start + i,
            stintStart: start,
            compound,
            lapTime: 80 + offset + deg * i,
            dateStart: (start + i) * 1000,
          }),
        );
      }
    };
    push("SOFT", 0, 0.08, 1);
    push("MEDIUM", 0.6, 0.04, 1);
    const fitted = fitTyreModel(laps, { ...defaultTyreModel(), fuelPerLap: 0 }, {
      mode: "practice",
      label: "FP2",
      sessionKey: 5,
    });
    expect(fitted.fit.quality.SOFT?.r2).toBeGreaterThan(0.95);
    expect(fitted.fit.quality.MEDIUM?.r2).toBeGreaterThan(0.95);
    expect(fitted.model.compounds.SOFT.offset).toBeCloseTo(0, 2);
    expect(fitted.model.compounds.SOFT.degPerLap).toBeCloseTo(0.08, 2);
    expect(fitted.model.compounds.MEDIUM.offset).toBeCloseTo(0.6, 1);
    expect(fitted.model.compounds.MEDIUM.degPerLap).toBeCloseTo(0.04, 2);
    expect(fitted.model.baseLap).toBeCloseTo(80, 1);
    expect(fitted.fit.used).toBe(24);
  });
});

describe("plan search speed", () => {
  it("ranks a full race distance quickly enough for a slider", () => {
    const t0 = performance.now();
    const result = buildStopPlans({
      model: defaultTyreModel(),
      remaining: 57,
      raceLap: 14,
      currentCompound: "MEDIUM",
      currentAge: 8,
      pitLoss: 22,
      setsLeft: { SOFT: 2, MEDIUM: 1, HARD: 1 },
      ruleActive: true,
      anchor: 80,
    });
    const ms = performance.now() - t0;
    expect(result.plans.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(250);
  });
});

describe("persistence", () => {
  it("round-trips the model through localStorage", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    resetTyreStore();
    const model = defaultTyreModel();
    model.baseLap = 81.5;
    model.compounds.HARD.lifespan = 40;
    writeTyreStore({ model, fit: null });
    const again = readTyreStore();
    expect(again.model.baseLap).toBeCloseTo(81.5);
    expect(again.model.compounds.HARD.lifespan).toBe(40);
    const pace = 82;
    const anchor = anchorForPace(model, "MEDIUM", 4, 12, pace);
    expect(predictedLapTime({ ...model, baseLap: anchor }, "MEDIUM", 4, 12)).toBeCloseTo(pace);
  });
});
