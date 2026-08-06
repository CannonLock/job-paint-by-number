// Deriving day and month views out of the baked aggregate.
//
// The page always reads "as of today", so there is a single as-of day: the last
// day in the baked window. That is taken from the data rather than the wall clock
// on purpose -- the demo data is a snapshot, and a page that asked the browser for
// today's date would start showing empty days the morning after it was baked.

import type { DayCarry, DayData, DayFlows, DaySlice, StateCounts } from "../types";

export const ALL_CLUSTERS = "all";

/**
 * Sentinel day key the bake uses for the census taken as the window opens, so the
 * first real day has a measured carry-in rather than a guess. Must match
 * WINDOW_START_DAY in scripts/build-day-data.mjs.
 */
export const WINDOW_START_DAY = "window-start";

const ZERO: StateCounts = [0, 0, 0, 0];

export function addCounts(a: StateCounts, b: StateCounts): StateCounts {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}

export const FLOW_KEYS = [
  "placedTodayToActive",
  "placedBeforeToActive",
  "activeToCompleted",
  "activeToRemoved",
  "placedTodayToRemoved",
  "placedBeforeToRemoved",
  "placedTodayToCompleted",
  "placedBeforeToCompleted",
] as const;

function addFlows(a: DayFlows | null, b: DayFlows): DayFlows {
  if (!a) return { ...b };
  const out = {} as DayFlows;
  for (const key of FLOW_KEYS) out[key] = a[key] + b[key];
  return out;
}

/** True when any edge carries weight; an all-zero day has nothing to draw. */
export function hasFlow(flows: DayFlows | null): flows is DayFlows {
  return !!flows && FLOW_KEYS.some((key) => flows[key] > 0);
}

/** Local "YYYY-MM-DD" for a Date. Never use toISOString here -- it shifts to UTC. */
export function dayKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local midnight Date for a "YYYY-MM-DD" key. */
export function parseDayKey(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The day the whole page is viewed as of. */
export function asOfDay(data: DayData): string {
  return data.days[data.days.length - 1];
}

/** The day before the as-of day, or null if the window is one day long. */
export function previousDay(data: DayData): string | null {
  return data.days.length >= 2 ? data.days[data.days.length - 2] : null;
}

/**
 * One slice per day in the window for the chosen cluster, with cohort state read
 * as of the as-of day. Keyed by day so the calendar can look tiles up directly.
 */
export function buildSliceMap(data: DayData, cluster: string): Map<string, DaySlice> {
  const asOf = asOfDay(data);
  const slices = new Map<string, DaySlice>();
  for (const day of data.days) {
    slices.set(day, {
      day,
      queued: 0,
      stateAsOf: null,
      started: 0,
      completed: 0,
      removed: 0,
      changed: 0,
      flows: null,
      carry: null,
    });
  }

  for (const cohort of data.cohorts) {
    if (cluster !== ALL_CLUSTERS && String(cohort.cluster) !== cluster) continue;
    const slice = slices.get(cohort.day);
    if (!slice) continue;
    slice.queued += cohort.queued;
    const row = cohort.asOf[asOf];
    if (row) slice.stateAsOf = addCounts(slice.stateAsOf ?? ZERO, row);
  }

  for (const row of data.activity) {
    if (cluster !== ALL_CLUSTERS && String(row.cluster) !== cluster) continue;
    const slice = slices.get(row.day);
    if (!slice) continue;
    slice.started += row.started;
    slice.completed += row.completed;
    slice.removed += row.removed;
    // Summing distinct-job counts across clusters stays a distinct-job count: a job
    // belongs to exactly one cluster.
    slice.changed += row.changed;
    if (row.flows) slice.flows = addFlows(slice.flows, row.flows);
  }

  // End-of-day census, summed over the selected clusters.
  const endOfDay = new Map<string, { placed: number; active: number }>();
  for (const row of data.carry ?? []) {
    if (cluster !== ALL_CLUSTERS && String(row.cluster) !== cluster) continue;
    const entry = endOfDay.get(row.day) ?? { placed: 0, active: 0 };
    entry.placed += row.placed;
    entry.active += row.active;
    endOfDay.set(row.day, entry);
  }

  // Turn the census into per-day carry-in/carry-out. Day 0 reads its carry-in from
  // the window-start census -- the state measured at the instant the window opened.
  // Inferring it from the day's own flows instead understated the opening backlog
  // badly (345,341 against a measured ~708,716), which then propagated into every
  // period that began on day 0.
  if (data.carry) {
    const beforeWindow = endOfDay.get(WINDOW_START_DAY) ?? { placed: 0, active: 0 };
    data.days.forEach((day, index) => {
      const slice = slices.get(day);
      if (!slice) return;
      const today = endOfDay.get(day) ?? { placed: 0, active: 0 };
      const yesterday = index > 0 ? (endOfDay.get(data.days[index - 1]) ?? today) : beforeWindow;

      slice.carry = {
        placedIn: yesterday.placed,
        activeIn: yesterday.active,
        placedOut: today.placed,
        activeOut: today.active,
        placedNew: slice.queued,
      };
    });
  }

  return slices;
}

export interface MonthRollup {
  /** Jobs queued during this month. */
  queued: number;
  /** Their state as of the as-of day. */
  stateAsOf: StateCounts;
  /** Days in this month that have any data at all. */
  daysWithData: number;
}

/** Roll the slices up over one calendar month (month is 0-based, as in Date). */
export function monthRollup(
  slices: Map<string, DaySlice>,
  year: number,
  month: number,
): MonthRollup {
  let queued = 0;
  let stateAsOf: StateCounts = ZERO;
  let daysWithData = 0;

  for (const slice of slices.values()) {
    const date = parseDayKey(slice.day);
    if (date.getFullYear() !== year || date.getMonth() !== month) continue;
    queued += slice.queued;
    if (slice.stateAsOf) stateAsOf = addCounts(stateAsOf, slice.stateAsOf);
    if (slice.queued > 0 || slice.started > 0 || slice.completed > 0 || slice.removed > 0) {
      daysWithData++;
    }
  }

  return { queued, stateAsOf, daysWithData };
}

export type PeriodKey = "yesterday" | "week" | "month";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string; days: number }[] = [
  { key: "yesterday", label: "Yesterday", days: 1 },
  { key: "week", label: "Last Week", days: 7 },
  { key: "month", label: "Last Month", days: 30 },
];

export interface PeriodSummary {
  key: PeriodKey;
  label: string;
  /** Days actually covered, ascending. */
  days: string[];
  flows: DayFlows | null;
  carry: DayCarry | null;
  started: number;
  completed: number;
  removed: number;
  /**
   * Distinct jobs that moved. Only meaningful for a single day: per-day distinct
   * counts cannot be summed without double-counting a job that moved on two days,
   * so multi-day periods leave this null and report transitions instead.
   */
  distinctChanged: number | null;
  /** Total transitions in the period; a job may contribute more than one. */
  transitions: number;
  placedNew: number;
  /** True when the requested length ran off the front of the baked window. */
  truncated: boolean;
}

/**
 * Roll a trailing period up into one summary, ending at the last complete day
 * (the day before the as-of day).
 *
 * Transitions are additive across days, so they sum directly. Carry-over is not:
 * it is read from the census at the period's two edges, giving what the period
 * inherited and what it hands on, rather than summing intermediate days that
 * cancel out internally.
 */
export function buildPeriodSummary(
  data: DayData,
  slices: Map<string, DaySlice>,
  key: PeriodKey,
): PeriodSummary | null {
  const option = PERIOD_OPTIONS.find((o) => o.key === key) ?? PERIOD_OPTIONS[0];
  // The as-of day is partial, so periods end on the last complete day before it.
  const endIndex = data.days.length - 2;
  if (endIndex < 0) return null;

  const wantedStart = endIndex - (option.days - 1);
  const startIndex = Math.max(0, wantedStart);
  const days = data.days.slice(startIndex, endIndex + 1);

  let flows: DayFlows | null = null;
  let started = 0;
  let completed = 0;
  let removed = 0;
  let placedNew = 0;
  for (const day of days) {
    const slice = slices.get(day);
    if (!slice) continue;
    if (slice.flows) flows = addFlows(flows, slice.flows);
    started += slice.started;
    completed += slice.completed;
    removed += slice.removed;
    placedNew += slice.queued;
  }

  const first = slices.get(days[0]);
  const last = slices.get(days[days.length - 1]);
  const carry: DayCarry | null =
    first?.carry && last?.carry
      ? {
          placedIn: first.carry.placedIn,
          activeIn: first.carry.activeIn,
          placedOut: last.carry.placedOut,
          activeOut: last.carry.activeOut,
          placedNew,
        }
      : null;

  const single = days.length === 1;
  return {
    key,
    label: option.label,
    days,
    flows,
    carry,
    started,
    completed,
    removed,
    distinctChanged: single ? (slices.get(days[0])?.changed ?? 0) : null,
    transitions: started + completed + removed,
    placedNew,
    truncated: wantedStart < 0,
  };
}

/** True when the day carries nothing at all -- no cohort and no transitions. */
export function isEmptySlice(slice: DaySlice | undefined): boolean {
  if (!slice) return true;
  return slice.queued === 0 && slice.changed === 0;
}

/** "Tue, Jul 21" */
export function formatDayShort(day: string): string {
  return parseDayKey(day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Tuesday, July 21" */
export function formatDayLong(day: string): string {
  return parseDayKey(day).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Compact counts for tiles: 1.5M, 272k, 940. */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
