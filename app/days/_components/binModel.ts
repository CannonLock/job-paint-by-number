// Deriving one day's 4-hour census from the baked window-long series.
//
// The bake ships sparse per-cluster counts (placed / completed / removed per
// bin). Everything drawn is arithmetic over those: a running balance gives
// "active when the day opened", then cumulative sums inside the day give each
// bar's census.
//
// Copied from app/stacked-bar/_components/binModel.ts and extended: bins are now
// marked drawn or not, so a day stops drawing once the work it holds has all
// finished (see truncation notes on buildDayCensus). The period helpers are gone
// -- the summary at the top of this page is a Sankey, not per-day bars.

import type { BarScale, StackedBarData } from "../types";
import { inFilter, type ClusterFilter } from "./grouping";

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

export function expandSeries(data: StackedBarData, filter: ClusterFilter): DenseSeries {
  const totalBins = data.days.length * data.binsPerDay;
  const out: DenseSeries = {
    openingActive: 0,
    placed: new Array(totalBins).fill(0),
    completed: new Array(totalBins).fill(0),
    removed: new Array(totalBins).fill(0),
  };
  for (const series of data.series) {
    if (!inFilter(filter, series.cluster)) continue;
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
  /** Everything in play by the end of this bin: active at day start + placed so far. */
  inPlay: number;
  /**
   * Still active and carried from an earlier bin. Together with `becameActive`
   * this is inPlay minus the terminations so far.
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
  /** Completed, cumulative up to this bin. */
  completed: number;
  /** Removed, cumulative up to this bin. */
  removed: number;
  /** Placed today, cumulative up to this bin. */
  placedSoFar: number;
  /**
   * Clock time the census was taken: the instant the window closes. The bars are
   * a reading at that moment, not a summary of the window, so the readout names
   * the moment rather than the span.
   */
  snapshotAt: string;
  /** True when everything in play has reached a final state by this bin's end. */
  terminal: boolean;
  /**
   * False for the bins past the point where the day's work is finished for good.
   * Charts skip them entirely rather than repeating an all-terminal bar to
   * midnight. See buildDayCensus.
   */
  drawn: boolean;
}

export interface DayCensus {
  bins: BinCensus[];
  /** Jobs already active when the day opened (carried in from earlier days). */
  activeAtDayStart: number;
  /** Placed at any point during the day. */
  placedToday: number;
  /**
   * Index of the bin in which the last job reached a final state, when that
   * happened before the day was out; null when work was still active at
   * midnight. This is the one all-terminal bar the day draws.
   */
  finishedAt: number | null;
  /** True when the day has anything worth drawing. */
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
 *
 * Bins past the end of the work are marked `drawn: false`. Once every job in play
 * is completed or removed, repeating that same all-terminal bar for the rest of
 * the day says nothing: the reader has already been told the answer, and five
 * more identical bars imply five more bins of activity. So the day draws through
 * the bin in which the last job finished -- that bar is worth seeing, it is where
 * the cluster crossed the line -- and stops. Placement is what revives a day: if
 * fresh work arrives in a later bin the count restarts from the last bin that
 * still held active work, so a day that empties out and then fills again is drawn
 * in full.
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
      label: binLabel(b, data.binHours),
      inPlay,
      active: activeTotal - becameActive,
      becameActive,
      completed,
      removed,
      placedSoFar: placedCum,
      snapshotAt: snapshotLabel(b, data.binHours),
      terminal: inPlay > 0 && activeTotal === 0,
      // Filled in below, once the whole day is known.
      drawn: true,
    });
  }

  // The last bin that still held active work; everything after it plus one is
  // the tail this day should not draw.
  const lastActive = bins.reduce(
    (last, bin, index) => (bin.active + bin.becameActive > 0 ? index : last),
    -1,
  );
  const drawnThrough = Math.min(lastActive + 1, bins.length - 1);
  bins.forEach((bin, index) => {
    bin.drawn = index <= drawnThrough && bin.inPlay > 0;
  });
  // The one all-terminal bar, when there is one: the bin the day was drawn
  // through, if by its end nothing was left active.
  const finishedAt = bins[drawnThrough].terminal ? drawnThrough : null;

  return {
    bins,
    activeAtDayStart,
    placedToday: placedCum,
    finishedAt,
    // Journey mode: a day counts only while the cluster is alive -- something was
    // active when it opened, placed during it, or finished during it. Without
    // this, a cluster that wrapped up weeks ago would keep drawing its static
    // all-terminal bar every day to the end of the window. Day mode keeps the
    // in-play test.
    hasData:
      mode === "journey"
        ? activeAtDayStart > 0 || placedCum > 0 || completedCum > 0 || removedCum > 0
        : bins.some((bin) => bin.drawn),
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
 *
 * No truncation needed here: a bin with nothing in it already draws nothing, so
 * a day whose work all finished at 04:00 has five empty bins of its own accord.
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
    bins.push({ label: binLabel(b, data.binHours), placed, completed, removed, total: binTotal });
  }

  return { bins, total, hasData: total > 0 };
}

/** "04:00" -- the clock time bin 0 of a 4-hour bake closes at. */
function snapshotLabel(bin: number, binHours: number): string {
  const hour = (bin + 1) * binHours;
  // The last window closes at the end of the day, which nobody calls 24:00.
  return hour >= 24 ? "midnight" : `${String(hour).padStart(2, "0")}:00`;
}

/** "00–04" for bin 0 of a 4-hour bake. */
function binLabel(bin: number, binHours: number): string {
  const from = String(bin * binHours).padStart(2, "0");
  const to = String((bin + 1) * binHours).padStart(2, "0");
  return `${from}–${to}`;
}

/**
 * Height of a calendar tile's bar slot, in pixels. Lives here rather than in the
 * calendar because the scale advice below has to reason in pixels: whether a bar
 * is still saying anything depends on how tall the slot is.
 */
export const TILE_BARS_HEIGHT = 88;

/**
 * Floor TileActivityBars applies so a bin with any activity stays visible. A bar
 * this short is no longer encoding its value -- it is the floor, and every bar
 * sitting on it looks identical whatever its count.
 */
export const MIN_BAR_PIXELS = 2;

/**
 * What the linear scale is doing to the month on screen.
 *
 * A month holding both a 181,000-change bin and a 600-change one has a dynamic
 * range no proportional axis survives: the small bars collapse onto the 2-pixel
 * floor and a fortnight of real work reads as empty tiles. That is a property of
 * the data, not a mistake, so the page measures it and offers the log scale
 * instead of choosing for the reader.
 */
export interface ScaleAdvice {
  /** Tallest 4-hour bin on the month; what every bar is scaled against. */
  peak: number;
  /** Days with activity at all. */
  activeDays: number;
  /** Days whose tallest bar is held up by the floor rather than by its value. */
  squashedDays: number;
  /** The busiest of those days -- the largest thing linear is hiding. */
  exampleDay: string | null;
  /** That day's busiest bin. */
  exampleBin: number;
}

/**
 * Measure one month's activity: the shared peak every tile scales against, and
 * how much of the month linear scaling flattens onto the floor.
 *
 * Takes the month's entries already filtered, so this stays pure arithmetic over
 * the bins and needs no notion of calendars or date keys.
 */
export function buildScaleAdvice(entries: [string, DayActivity][]): ScaleAdvice {
  let peak = 0;
  for (const [, activity] of entries) {
    for (const bin of activity.bins) if (bin.total > peak) peak = bin.total;
  }

  // Counts below this draw shorter than the floor, so they all render the same
  // height no matter how far apart they are.
  const floor = (MIN_BAR_PIXELS / TILE_BARS_HEIGHT) * peak;

  let activeDays = 0;
  let squashedDays = 0;
  let exampleDay: string | null = null;
  let exampleBin = 0;
  for (const [day, activity] of entries) {
    if (!activity.hasData) continue;
    activeDays++;
    const tallest = activity.bins.reduce((max, bin) => Math.max(max, bin.total), 0);
    if (tallest > 0 && tallest < floor) {
      squashedDays++;
      if (tallest > exampleBin) {
        exampleBin = tallest;
        exampleDay = day;
      }
    }
  }

  return { peak, activeDays, squashedDays, exampleDay, exampleBin };
}

/**
 * Which of the calendar's two height scales a bar is drawn against.
 *
 * The activity bars and the queue markers share a slot but measure different
 * things -- changes per window against standing jobs -- so they cannot share a
 * scale. Each gets its own axis, and hovering a bar lights up the one that
 * governs it.
 */
export type ScaleKind = "activity" | "queue";

/**
 * Fraction of the slot a queue marker may fill at its own maximum.
 *
 * Held below the top on purpose: a queue bar whose top lined up with the activity
 * axis's highest tick would invite reading it against the wrong scale. Ratios
 * between queue bars are unaffected, since every one is scaled by the same factor,
 * and the queue axis is built with the same cap so its labels stay true.
 */
export const QUEUE_HEIGHT_CAP = 0.8;

/** One labelled gridline on a tile's height axis. */
export interface ScaleTick {
  /** The count (or percentage) the line stands for. */
  value: number;
  /** Where it sits in the bar slot, 0 at the floor and 1 at the top. */
  fraction: number;
}

/**
 * Smallest gap between two ticks, as a fraction of the slot. An 88-pixel slot
 * leaves room for about four labels before they collide.
 */
const MIN_TICK_GAP = 0.22;

/**
 * Labelled heights for the calendar's magnitude bars, so a bar's height can
 * actually be read rather than only compared.
 *
 * The ticks suit the scale they annotate. Linear gets the peak and its half,
 * which is all a proportional axis needs. Log gets the powers of ten it spans --
 * and their uneven spacing is the point: a reader who sees 100, 10k and 181k
 * climbing at even intervals up the slot can see for themselves that the heights
 * are not proportional.
 *
 * The floor is always labelled, since it is what every short bar is sitting on,
 * and it takes part in the thinning like any other tick -- on a log scale the
 * bottom decade lands a few pixels above zero and would otherwise print on top
 * of it.
 */
export function buildScaleTicks(peak: number, scale: BarScale, cap = 1): ScaleTick[] {
  if (peak <= 0) return [];

  const at = (value: number) => ({ value, fraction: barFraction(value, peak, scale) * cap });

  const floor: ScaleTick = { value: 0, fraction: 0 };
  const top: ScaleTick = { value: peak, fraction: cap };

  // Everything between the peak and the floor, descending. Capped alongside the
  // bars, so the labels sit exactly where the values they name are drawn, and the
  // thinning below measures the gaps the reader will actually see.
  const middle: ScaleTick[] = [];
  if (scale === "linear") {
    const half = Math.round(peak / 2);
    if (half > 0) middle.push(at(half));
  } else {
    for (let exponent = Math.floor(Math.log10(peak)); exponent >= 0; exponent--) {
      middle.push(at(10 ** exponent));
    }
  }

  // Keep a tick only if it clears both the one above it and the floor below.
  const kept: ScaleTick[] = [top];
  for (const tick of middle) {
    const above = kept[kept.length - 1];
    if (above.fraction - tick.fraction >= MIN_TICK_GAP && tick.fraction >= MIN_TICK_GAP) {
      kept.push(tick);
    }
  }
  kept.push(floor);
  return kept;
}

/**
 * Bar height as a fraction of the tallest bin on screen, under either scale.
 *
 * Linear is the honest one -- twice as tall is twice as much work -- but with a
 * 900,000-change peak on the page a 66-change bin is a fraction of a pixel and
 * a whole quiet week reads as "nothing happened". Log keeps those bins visible
 * and preserves their order, at the cost of proportionality: heights become
 * ordinal, and the numbers live in the hover readout and the day detail instead.
 *
 * Either way the segments inside a column stay linear, so the composition of a
 * single bar never lies.
 */
export function barFraction(total: number, peak: number, scale: BarScale): number {
  if (total <= 0) return 0;
  const top = Math.max(peak, total, 1);
  if (scale === "linear") return Math.min(total / top, 1);
  const denom = Math.log10(top + 1);
  if (denom <= 0) return 1;
  return Math.min(Math.log10(total + 1) / denom, 1);
}
