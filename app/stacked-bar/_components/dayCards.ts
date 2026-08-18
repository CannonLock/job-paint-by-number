// The slice of public/data/day-cards.json this page needs, plus the derivation
// from four baked states down to this page's three.
//
// The calendar's waffles and the dialog's cohort breakdown are per-day cohort
// censuses, which only the day bake carries -- stacked-bars.json is transition
// series, not cohorts. So this page reads both files. Types and model are copied
// (trimmed) from app/sankey rather than imported: this route must not reach into
// the Sankey page's files. The Sankey-specific pieces (flows, carry) are omitted.

import type { BarState } from "../types";

/** Counts in the day bake's order: [queued, running, completed, removed]. */
export type StateCounts = readonly [number, number, number, number];

/** Counts in this page's order: [active, completed, removed]. */
export type BarCounts = readonly [number, number, number];

/**
 * Four baked states -> three shown states: a job is Active from the moment it is
 * placed, so queued and running merge.
 */
export function toBarCounts(counts: StateCounts): BarCounts {
  return [counts[0] + counts[1], counts[2], counts[3]];
}

export const BAR_COUNT_ORDER: readonly BarState[] = ["active", "completed", "removed"];

export interface Cohort {
  cluster: number;
  day: string;
  queued: number;
  asOf: Record<string, StateCounts>;
}

export interface ActivityRow {
  cluster: number;
  day: string;
  started: number;
  completed: number;
  removed: number;
  /** Distinct jobs with at least one transition this day. */
  changed: number;
}

export interface ClusterInfo {
  id: number;
  total: number;
  firstQueued: string | null;
}

export interface DayData {
  owner: string;
  anonymized?: boolean;
  generatedAt: string;
  timezone: string;
  days: string[];
  clusters: ClusterInfo[];
  cohorts: Cohort[];
  activity: ActivityRow[];
  counted: number;
}

/** One card's worth, after cluster filtering. Three-state, no Sankey fields. */
export interface DaySlice {
  day: string;
  /** Jobs placed on this day, and their state as of the as-of day. */
  queued: number;
  stateAsOf: BarCounts | null;
  /** Transitions on this day (all jobs, any queue day). */
  completed: number;
  removed: number;
  /** Distinct jobs that moved this day. */
  changed: number;
}

export const ALL_CLUSTERS = "all";

/** Local "YYYY-MM-DD" for a Date. Never toISOString -- it shifts to UTC. */
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

/** The day the whole page is viewed as of: the last day in the baked window. */
export function asOfDay(data: DayData): string {
  return data.days[data.days.length - 1];
}

const ZERO: StateCounts = [0, 0, 0, 0];

function addCounts(a: StateCounts, b: StateCounts): StateCounts {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}

/** One slice per day for the chosen cluster, keyed by day. */
export function buildSliceMap(data: DayData, cluster: string): Map<string, DaySlice> {
  const asOf = asOfDay(data);
  const slices = new Map<string, DaySlice>();
  const raw = new Map<string, StateCounts | null>();
  for (const day of data.days) {
    slices.set(day, { day, queued: 0, stateAsOf: null, completed: 0, removed: 0, changed: 0 });
    raw.set(day, null);
  }

  for (const cohort of data.cohorts) {
    if (cluster !== ALL_CLUSTERS && String(cohort.cluster) !== cluster) continue;
    const slice = slices.get(cohort.day);
    if (!slice) continue;
    slice.queued += cohort.queued;
    const row = cohort.asOf[asOf];
    if (row) raw.set(cohort.day, addCounts(raw.get(cohort.day) ?? ZERO, row));
  }
  for (const [day, counts] of raw) {
    const slice = slices.get(day);
    if (slice && counts) slice.stateAsOf = toBarCounts(counts);
  }

  for (const row of data.activity) {
    if (cluster !== ALL_CLUSTERS && String(row.cluster) !== cluster) continue;
    const slice = slices.get(row.day);
    if (!slice) continue;
    slice.completed += row.completed;
    slice.removed += row.removed;
    slice.changed += row.changed;
  }

  return slices;
}

/** True when the day carries nothing at all -- no cohort and no transitions. */
export function isEmptySlice(slice: DaySlice | undefined): boolean {
  if (!slice) return true;
  return slice.queued === 0 && slice.changed === 0;
}

/** Compact counts for tiles: 1.5M, 272k, 940. */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
