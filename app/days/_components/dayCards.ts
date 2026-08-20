// The slice of public/data/day-cards.json this page needs, plus the derivation
// from four baked states down to the three this page paints.
//
// Two bakes feed this route. stacked-bars.json (see ../types.ts) carries the
// 4-hour transition series the calendar draws; day-cards.json carries the
// per-day cohort censuses, the Sankey flow edges, and the end-of-day carry-over
// census. Types and model are copied (and trimmed) from app/sankey and
// app/stacked-bar rather than imported: this route is self-contained.
//
// The one substantive difference from the Sankey page: Placed and Running are
// merged into a single Active state everywhere, so a job is Active from the
// moment it is placed and leaves only by completing or being removed. That is
// the same grouping the 4-hour bars use, so the diagram at the top of the page
// and the calendar below it speak about the same three states.

/** Counts in the day bake's order: [queued, running, completed, removed]. */
export type StateCounts = readonly [number, number, number, number];

import { inFilter, type BatchInfo, type ClusterFilter } from "./grouping";

/**
 * Sankey edge weights for one day, as the day bake writes them. The four-state
 * vocabulary is the bake's; this page collapses it (see mergedFlows) so the
 * placed -> running transitions, which are internal to Active here, drop out.
 */
export interface DayFlows {
  placedTodayToActive: number;
  placedBeforeToActive: number;
  activeToCompleted: number;
  activeToRemoved: number;
  placedTodayToRemoved: number;
  placedBeforeToRemoved: number;
  placedTodayToCompleted: number;
  placedBeforeToCompleted: number;
}

/** Non-terminal jobs held at the end of one day, for one cluster. */
export interface CarryRow {
  cluster: number;
  day: string;
  /** Still waiting in the queue at midnight. */
  placed: number;
  /** Still executing at midnight. */
  active: number;
}

/**
 * The carry-over context the Sankey needs to conserve flow: what the day (or
 * period) inherited and what it hands on. Still split placed/active because that
 * is how the bake measured it; this page sums the two into one Active figure.
 */
export interface DayCarry {
  placedIn: number;
  activeIn: number;
  placedOut: number;
  activeOut: number;
  /** Jobs placed during the day or period. */
  placedNew: number;
}

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
  /** Optional: absent on data baked before the Sankey fields existed. */
  flows?: DayFlows;
}

export interface ClusterInfo {
  id: number;
  total: number;
  firstQueued: string | null;
  /** Batch this cluster belongs to. Absent on data baked before batches existed. */
  batch?: string;
}

export interface DayData {
  owner: string;
  anonymized?: boolean;
  generatedAt: string;
  timezone: string;
  days: string[];
  clusters: ClusterInfo[];
  /** Batch groups. Absent on data baked before batch grouping existed. */
  batches?: BatchInfo[];
  cohorts: Cohort[];
  activity: ActivityRow[];
  /** Optional: absent on data baked before the carry-over census existed. */
  carry?: CarryRow[];
  sources: {
    adstash: { host: string; index: string; terminalRecords: number };
    condorQ: { pool: string; schedd: string; liveAds: number; stillQueued: number };
  };
  counted: number;
}

/**
 * The queue at the instant one day ends and the next begins.
 *
 * A stock, not a flow -- the one thing the rest of the calendar cannot show.
 * Every other bar counts transitions inside a window; this counts jobs standing
 * in the queue when the window closed, so a day on which nothing at all moved can
 * still be holding a million jobs.
 *
 * Both halves are measured, from two different censuses that agree: the total is
 * the end-of-day carry census (waiting plus running), and `fromToday` is the
 * day's own cohort read at the end of that same day. Nothing here is inferred
 * from transitions, which could not separate the two -- a job placed and finished
 * inside the day is invisible to both.
 */
export interface DayQueue {
  /** Jobs still in flight when the day closed: waiting plus running. */
  total: number;
  /** Of those, the ones placed during this very day. */
  fromToday: number;
  /** The rest: already in flight when the day opened. */
  carried: number;
}

/** One day's worth, after cluster filtering and cross-cluster summing. */
export interface DaySlice {
  day: string;
  /** Jobs placed on this day. */
  queued: number;
  /** Transitions on this day (all jobs, whenever they were placed). */
  completed: number;
  removed: number;
  /** Distinct jobs that moved this day. Not the sum of the lines above. */
  changed: number;
  /** Null when the baked data predates the Sankey fields. */
  flows: DayFlows | null;
  /** Null when the baked data predates the carry-over census. */
  carry: DayCarry | null;
  /** The queue at this day's close. Null when the bake carries no census. */
  queue: DayQueue | null;
}

/**
 * Sentinel day key the bake uses for the census taken as the window opens, so
 * the first real day has a measured carry-in rather than a guess. Must match
 * WINDOW_START_DAY in scripts/build-day-data.mjs.
 */
export const WINDOW_START_DAY = "window-start";

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

/**
 * The three-state edge weights, summed out of the bake's four-state vocabulary.
 *
 * Placed -> Running disappears: with the two states merged it is not a state
 * change at all. Everything that ends Completed is one edge, everything that
 * ends Removed is another, whether or not the job ever ran.
 */
export function mergedFlows(flows: DayFlows): { completed: number; removed: number } {
  return {
    completed:
      flows.activeToCompleted + flows.placedTodayToCompleted + flows.placedBeforeToCompleted,
    removed: flows.activeToRemoved + flows.placedTodayToRemoved + flows.placedBeforeToRemoved,
  };
}

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

/**
 * The day the whole page is viewed as of: the last day in the baked window,
 * taken from the data rather than the wall clock -- the demo data is a snapshot,
 * and a page that asked the browser for today's date would start showing empty
 * days the morning after it was baked.
 */
export function asOfDay(data: DayData): string {
  return data.days[data.days.length - 1];
}

/** One slice per day for the chosen cluster, keyed by day. */
export function buildSliceMap(data: DayData, filter: ClusterFilter): Map<string, DaySlice> {
  const slices = new Map<string, DaySlice>();
  for (const day of data.days) {
    slices.set(day, {
      day,
      queued: 0,
      completed: 0,
      removed: 0,
      changed: 0,
      flows: null,
      carry: null,
      queue: null,
    });
  }

  for (const cohort of data.cohorts) {
    if (!inFilter(filter, cohort.cluster)) continue;
    const slice = slices.get(cohort.day);
    if (!slice) continue;
    slice.queued += cohort.queued;
  }

  for (const row of data.activity) {
    if (!inFilter(filter, row.cluster)) continue;
    const slice = slices.get(row.day);
    if (!slice) continue;
    slice.completed += row.completed;
    slice.removed += row.removed;
    // Summing distinct-job counts across clusters stays a distinct-job count: a
    // job belongs to exactly one cluster.
    slice.changed += row.changed;
    if (row.flows) slice.flows = addFlows(slice.flows, row.flows);
  }

  // End-of-day census, summed over the selected clusters.
  const endOfDay = new Map<string, { placed: number; active: number }>();
  for (const row of data.carry ?? []) {
    if (!inFilter(filter, row.cluster)) continue;
    const entry = endOfDay.get(row.day) ?? { placed: 0, active: 0 };
    entry.placed += row.placed;
    entry.active += row.active;
    endOfDay.set(row.day, entry);
  }

  // Jobs placed on a day that were still in flight when that same day closed.
  // Read from the cohort's own end-of-day census, which is the only source that
  // can attribute standing work to the day it arrived: transitions cannot, since
  // a job placed and finished inside one day leaves no trace in either.
  const placedStillActive = new Map<string, number>();
  for (const cohort of data.cohorts) {
    if (!inFilter(filter, cohort.cluster)) continue;
    const sameDay = cohort.asOf[cohort.day];
    // Queued plus running: both are Active in this page's three-state model.
    if (sameDay) {
      placedStillActive.set(
        cohort.day,
        (placedStillActive.get(cohort.day) ?? 0) + sameDay[0] + sameDay[1],
      );
    }
  }

  // Turn the census into per-day carry-in/carry-out. Day 0 reads its carry-in
  // from the window-start census -- the state measured at the instant the window
  // opened. Inferring it from the day's own flows instead understated the
  // opening backlog badly, which then propagated into every period starting on
  // day 0.
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

      // The queue at midnight, split into what arrived today and what was
      // already here. Clamped to the total: the two censuses are measured
      // separately, so counting noise must not be allowed to produce a negative
      // carried figure.
      const total = today.placed + today.active;
      const fromToday = Math.min(placedStillActive.get(day) ?? 0, total);
      slice.queue = { total, fromToday, carried: total - fromToday };
    });
  }

  return slices;
}

/**
 * Largest end-of-day queue anywhere in the baked window.
 *
 * Deliberately window-wide, where the activity bars' peak is per month. The two
 * are different kinds of quantity and want different treatment:
 *
 *  - Activity is a flow, and what a reader wants from it is contrast within the
 *    month they are looking at -- which day was busy, which was quiet.
 *  - A queue is a level, and it means the same thing in every month. Scaling it
 *    per month would be actively misleading here: this queue sits near 1.5M for
 *    weeks and then drains to a few thousand, so a per-month peak pins every bar
 *    in July to full height AND every bar in August to full height, and the
 *    drain -- the only story the series has -- disappears.
 */
export function queuePeak(slices: Map<string, DaySlice>): number {
  let peak = 0;
  for (const slice of slices.values()) {
    if (slice.queue && slice.queue.total > peak) peak = slice.queue.total;
  }
  return peak;
}

/** True when the day carries nothing at all -- no cohort and no transitions. */
export function isEmptySlice(slice: DaySlice | undefined): boolean {
  if (!slice) return true;
  return slice.queued === 0 && slice.changed === 0;
}

// --- Trailing periods (the "What happened Yesterday / Last Week / Last Month"
// card at the top of the page).

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
  /** Jobs placed during the period; in the merged model, jobs that became active. */
  placed: number;
  completed: number;
  removed: number;
  /**
   * Distinct jobs that moved. Only meaningful for a single day: per-day distinct
   * counts cannot be summed without double-counting a job that moved on two
   * days, so multi-day periods leave this null and report transitions instead.
   */
  distinctChanged: number | null;
  /** Total transitions in the period; a job may contribute more than one. */
  transitions: number;
  /** True when the requested length ran off the front of the baked window. */
  truncated: boolean;
}

/**
 * Roll a trailing period up into one summary, ending at the last complete day
 * (the day before the as-of day, which is still in progress and would understate
 * every count).
 *
 * Transitions are additive across days, so they sum directly. Carry-over is not:
 * it is read from the census at the period's two edges, giving what the period
 * inherited and what it hands on, rather than summing intermediate days that
 * cancel out internally.
 *
 * Merging Placed into Active is what lets one edge builder serve both a single
 * day and a month. The four-state diagram needed a separate period model,
 * because a job placed inside the period but started on a later day is
 * "placed before" on the day it moved -- an attribution that cannot be summed.
 * With the two states merged that split does not exist, and in + out balance
 * exactly at every period length.
 */
export function buildPeriodSummary(
  data: DayData,
  slices: Map<string, DaySlice>,
  key: PeriodKey,
): PeriodSummary | null {
  const option = PERIOD_OPTIONS.find((o) => o.key === key) ?? PERIOD_OPTIONS[0];
  const endIndex = data.days.length - 2;
  if (endIndex < 0) return null;

  const wantedStart = endIndex - (option.days - 1);
  const startIndex = Math.max(0, wantedStart);
  const days = data.days.slice(startIndex, endIndex + 1);

  let flows: DayFlows | null = null;
  let completed = 0;
  let removed = 0;
  let placed = 0;
  for (const day of days) {
    const slice = slices.get(day);
    if (!slice) continue;
    if (slice.flows) flows = addFlows(flows, slice.flows);
    completed += slice.completed;
    removed += slice.removed;
    placed += slice.queued;
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
          placedNew: placed,
        }
      : null;

  return {
    key,
    label: option.label,
    days,
    flows,
    carry,
    placed,
    completed,
    removed,
    distinctChanged: days.length === 1 ? (slices.get(days[0])?.changed ?? 0) : null,
    transitions: placed + completed + removed,
    truncated: wantedStart < 0,
  };
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
