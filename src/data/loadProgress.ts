/** Per-endpoint fetch progress for a session Load. */

export type FetchProgress = {
  done: number;
  total: number;
  label: string;
  pct: number;
};

export function fetchProgressPct(done: number, total: number): number {
  if (total <= 0) return done > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((100 * done) / total)));
}

export function emptyFetchProgress(label = "Starting…"): FetchProgress {
  return { done: 0, total: 0, label, pct: 0 };
}

export type FetchTracker = {
  add: (n: number) => void;
  mark: (label: string) => void;
  wrap: <T>(label: string, work: Promise<T>) => Promise<T>;
  snapshot: () => FetchProgress;
};

export function createFetchTracker(onChange?: (p: FetchProgress) => void): FetchTracker {
  const inner = { done: 0, total: 0, label: "Starting…" };
  const snapshot = (): FetchProgress => ({
    done: inner.done,
    total: inner.total,
    label: inner.label,
    pct: fetchProgressPct(inner.done, inner.total),
  });
  const emit = () => onChange?.(snapshot());
  const add = (n: number) => {
    if (n <= 0) return;
    inner.total += n;
    emit();
  };
  const mark = (label: string) => {
    inner.done += 1;
    if (inner.done > inner.total) inner.total = inner.done;
    inner.label = label;
    emit();
  };
  const wrap = <T>(label: string, work: Promise<T>): Promise<T> => work.finally(() => mark(label));
  emit();
  return { add, mark, wrap, snapshot };
}

/** Count a job before it starts, then mark the label when it settles. */
export function trackJob<T>(tracker: FetchTracker, label: string, work: Promise<T>): Promise<T> {
  tracker.add(1);
  return tracker.wrap(label, work);
}
