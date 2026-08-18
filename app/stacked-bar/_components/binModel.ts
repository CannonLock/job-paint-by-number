// Deriving one day's 4-hour census from the baked window-long series.
//
// The bake ships sparse per-cluster counts (placed / completed / removed per bin).
// Everything drawn is arithmetic over those: a running balance gives "active when
// the day opened", then cumulative sums inside the day give each bar's census.

import type { StackedBarData } from "../types";

export const ALL_CLUSTERS = "all";

/** The selected clusters' series, summed into dense window-long arrays. */
export interface DenseSeries {
  openingActive: number;
  placed: number[];
  completed: number[];
  removed: number[];
}

function addSparse(dense: number[], sparse: [number, number][]) {
  for (const [bin, count] of sparse) {
    if (bin >= 0 && bin < dense.length) dense[bin] += count;
  }
}

export function expandSeries(data: StackedBarData, cluster: string): DenseSeries {
  const totalBins = data.days.length * data.binsPerDay;
  const out: DenseSeries = {
    openingActive: 0,
    placed: new Array(totalBins).fill(0),
    completed: new Array(totalBins).fill(0),
    removed: new Array(totalBins).fill(0),
  };
  for (const series of data.series) {
    if (cluster !== ALL_CLUSTERS && String(series.cluster) !== cluster) continue;
    out.openingActive += series.openingActive;
    addSparse(out.placed, series.placed);
    addSparse(out.completed, series.completed);
    addSparse(out.removed, series.removed);
  }
  return out;
}

/** The census at the end of one 4-hour bin. */
export interface BinCensus {
  /** "00–04" .. "20–24". */
  label: string;
  /** Everything in play by the end of this bin: active at day start + placed so far today. */
  inPlay: number;
  /**
   * Still active and carried from an earlier bin. Together with `becameActive`
   * this is inPlay minus today's terminations so far.
   */
  active: number;
  /**
   * Placed in THIS bin and still active -- the segment that marks when work
   * arrived. Attribution when a job is placed and terminated inside the same bin
   * is not measured, so terminations are assumed to drain older jobs first; that
   * keeps the new-placement signal whole at the cost of occasionally overstating
   * it by the same-bin churn.
   */
  becameActive: number;
  /** Completed today, cumulative up to this bin. */
  completed: number;
  /** Removed today, cumulative up to this bin. */
  removed: number;
  /** Placed today, cumulative up to this bin. */
  placedSoFar: number;
}

export interface DayCensus {
  bins: BinCensus[];
  /** Jobs already active when the day opened (carried in from earlier days). */
  activeAtDayStart: number;
  /** Placed at any point during the day. */
  placedToday: number;
  /** True when at least one bin has anything in play. */
  hasData: boolean;
}

/**
 * How the census counts terminations and sizes its denominator:
 *
 *  - "day": terminations reset at midnight and the denominator is the day's own
 *    work (active at open + placed today). The all-jobs reading of one day.
 *  - "journey": nothing resets. The denominator is every job placed so far
 *    (window opening included) and Completed/Removed accumulate for good, so a
 *    cluster's bars drift steadily toward teal over the days and no job ever
 *    drops out of view.
 */
export type CensusMode = "day" | "journey";

/**
 * The six per-bin censuses for one day.
 *
 * Each bar is a snapshot of where the work stands at the bin's end, not a per-bin
 * transition count -- see buildDayActivity for that.
 */
export function buildDayCensus(
  data: StackedBarData,
  dense: DenseSeries,
  dayIndex: number,
  mode: CensusMode = "day",
): DayCensus {
  const binsPerDay = data.binsPerDay;
  const startBin = dayIndex * binsPerDay;

  // Balances carried into the day. Clamped: counting noise between the two
  // sources can push the active balance a hair negative, which would poison
  // every later day if left to accumulate.
  let basePlaced = dense.openingActive;
  let baseCompleted = 0;
  let baseRemoved = 0;
  for (let b = 0; b < startBin; b++) {
    basePlaced += dense.placed[b];
    baseCompleted += dense.completed[b];
    baseRemoved += dense.removed[b];
  }
  const activeAtDayStart = Math.max(0, basePlaced - baseCompleted - baseRemoved);

  const bins: BinCensus[] = [];
  let placedCum = 0;
  let completedCum = 0;
  let removedCum = 0;
  for (let b = 0; b < binsPerDay; b++) {
    const placedThisBin = dense.placed[startBin + b];
    placedCum += placedThisBin;
    completedCum += dense.completed[startBin + b];
    removedCum += dense.removed[startBin + b];

    const journey = mode === "journey";
    const inPlay = journey ? basePlaced + placedCum : activeAtDayStart + placedCum;
    const completed = journey ? baseCompleted + completedCum : completedCum;
    const removed = journey ? baseRemoved + removedCum : removedCum;
    const activeTotal = Math.max(0, inPlay - completed - removed);
    // This bin's arrivals, capped by what is still active at all (see BinCensus).
    const becameActive = Math.min(placedThisBin, activeTotal);
    bins.push({
      label: `${String(b * data.binHours).padStart(2, "0")}–${String((b + 1) * data.binHours).padStart(2, "0")}`,
      inPlay,
      active: activeTotal - becameActive,
      becameActive,
      completed,
      removed,
      placedSoFar: placedCum,
    });
  }

  return {
    bins,
    activeAtDayStart,
    placedToday: placedCum,
    // Journey mode: a day counts only while the cluster is alive -- something was
    // active when it opened, placed during it, or finished during it. Without
    // this, a cluster that wrapped up weeks ago would keep drawing its static
    // all-terminal bar every day to the end of the window. Day mode keeps the
    // in-play test.
    hasData:
      mode === "journey"
        ? activeAtDayStart > 0 || placedCum > 0 || completedCum > 0 || removedCum > 0
        : bins.some((bin) => bin.inPlay > 0),
  };
}

/** The state changes inside one 4-hour bin -- deltas, not a census. */
export interface BinActivity {
  /** "00–04" .. "20–24". */
  label: string;
  placed: number;
  completed: number;
  removed: number;
  /** All changes in the bin; the bar's height. */
  total: number;
}

export interface DayActivity {
  bins: BinActivity[];
  /** All changes across the day. */
  total: number;
  hasData: boolean;
}

/**
 * The magnitude view for one day: how many state changes landed in each bin. A
 * busy bin is a tall bar, a quiet one is empty -- the complement of the census,
 * which shows composition but deliberately hides scale.
 */
export function buildDayActivity(
  data: StackedBarData,
  dense: DenseSeries,
  dayIndex: number,
): DayActivity {
  const binsPerDay = data.binsPerDay;
  const startBin = dayIndex * binsPerDay;

  const bins: BinActivity[] = [];
  let total = 0;
  for (let b = 0; b < binsPerDay; b++) {
    const placed = dense.placed[startBin + b];
    const completed = dense.completed[startBin + b];
    const removed = dense.removed[startBin + b];
    const binTotal = placed + completed + removed;
    total += binTotal;
    bins.push({
      label: `${String(b * data.binHours).padStart(2, "0")}–${String((b + 1) * data.binHours).padStart(2, "0")}`,
      placed,
      completed,
      removed,
      total: binTotal,
    });
  }

  return { bins, total, hasData: total > 0 };
}

// --- Trailing periods (the "What happened Yesterday / Last Week / Last Month"
// card). Mirrors the Sankey page's period model: periods end on the last
// complete day, since the as-of day is still in progress and would understate
// every count.

export type PeriodKey = "yesterday" | "week" | "month";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string; days: number }[] = [
  { key: "yesterday", label: "Yesterday", days: 1 },
  { key: "week", label: "Last Week", days: 7 },
  { key: "month", label: "Last Month", days: 30 },
];

export interface PeriodSlice {
  /** Days actually covered, ascending. */
  days: string[];
  startIndex: number;
  endIndex: number;
  /** True when the requested length ran off the front of the baked window. */
  truncated: boolean;
}

export function slicePeriod(data: StackedBarData, key: PeriodKey): PeriodSlice | null {
  const option = PERIOD_OPTIONS.find((o) => o.key === key) ?? PERIOD_OPTIONS[0];
  const endIndex = data.days.length - 2;
  if (endIndex < 0) return null;
  const wantedStart = endIndex - (option.days - 1);
  const startIndex = Math.max(0, wantedStart);
  return {
    days: data.days.slice(startIndex, endIndex + 1),
    startIndex,
    endIndex,
    truncated: wantedStart < 0,
  };
}

/**
 * The magnitude view over a period, one bar per DAY: 4-hour bins would put 180
 * bars on a month, so multi-day periods coarsen to daily totals.
 */
export function buildPeriodActivity(
  data: StackedBarData,
  dense: DenseSeries,
  period: PeriodSlice,
): DayActivity {
  const bins: BinActivity[] = [];
  let total = 0;
  for (let i = period.startIndex; i <= period.endIndex; i++) {
    const day = buildDayActivity(data, dense, i);
    const placed = day.bins.reduce((sum, bin) => sum + bin.placed, 0);
    const completed = day.bins.reduce((sum, bin) => sum + bin.completed, 0);
    const removed = day.bins.reduce((sum, bin) => sum + bin.removed, 0);
    const dayTotal = placed + completed + removed;
    total += dayTotal;
    bins.push({ label: formatDayTick(data.days[i]), placed, completed, removed, total: dayTotal });
  }
  return { bins, total, hasData: total > 0 };
}

/**
 * The journey ratio over a period, one bar per DAY: each bar is the whole
 * cluster's census at that day's close, so a week reads as the cohort drifting
 * to completed.
 */
export function buildPeriodCensus(
  data: StackedBarData,
  dense: DenseSeries,
  period: PeriodSlice,
): { bins: BinCensus[]; hasData: boolean } {
  const bins: BinCensus[] = [];
  for (let i = period.startIndex; i <= period.endIndex; i++) {
    const day = buildDayCensus(data, dense, i, "journey");
    const last = day.bins[day.bins.length - 1];
    bins.push({ ...last, label: formatDayTick(data.days[i]) });
  }
  return { bins, hasData: bins.some((bin) => bin.inPlay > 0) };
}

/** "Jul 21" -- compact axis tick for per-day bars. */
export function formatDayTick(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** "Tue, Jul 21" */
export function formatDayShort(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Tuesday, July 21" */
export function formatDayLong(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
