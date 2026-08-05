// Deriving day and month views out of the baked aggregate.
//
// The page always reads "as of today", so there is a single as-of day: the last
// day in the baked window. That is taken from the data rather than the wall clock
// on purpose -- the demo data is a snapshot, and a page that asked the browser for
// today's date would start showing empty days the morning after it was baked.

import type { DayData, DaySlice, StateCounts } from "../types";

export const ALL_CLUSTERS = "all";

const ZERO: StateCounts = [0, 0, 0, 0];

export function addCounts(a: StateCounts, b: StateCounts): StateCounts {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
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
