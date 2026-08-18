// Turning the baked day data into a per-day emission schedule for the sand.
//
// Reuses the /days model rather than re-reading the JSON: buildSliceMap already
// handles cluster filtering, the carry-over census and the flow sums.

import type { DayData } from "../../sankey/types";
import { ALL_CLUSTERS, buildSliceMap } from "../../sankey/_components/dayModel";

export interface DayEmission {
  day: string;
  /** Jobs entering the system, poured into Placed. */
  placedNew: number;
  placedToActive: number;
  placedToRemoved: number;
  placedToCompleted: number;
  activeToCompleted: number;
  activeToRemoved: number;
  /** Every transition on the day, for pacing and the readout. */
  transitions: number;
}

export interface Timeline {
  days: DayEmission[];
  totals: {
    placed: number;
    completed: number;
    removed: number;
    peakBacklog: number;
  };
  /** Backlog measured at the instant the window opens; seeds the opening scene. */
  initial: {
    placed: number;
    active: number;
  };
}

/**
 * How long a simulated day should hold the screen, in seconds at 1x.
 *
 * Fixed wall-clock-per-day pacing gave every day the same slice, and this dataset
 * opens with twelve days in which nothing is placed and almost nothing moves --
 * nearly half a minute of blank scene before the first pour, which reads as "the
 * simulation is broken". Days are paced by the log of their job activity instead:
 * dead days flick past in a blink, the busiest days get the longest look.
 */
export function daySeconds(day: DayEmission): number {
  const activity = day.placedNew + day.transitions;
  if (activity <= 0) return 0.15;
  const magnitude = Math.log10(1 + activity) / 6.5; // ~3M jobs in a day -> 1.0
  return 0.6 + Math.min(magnitude, 1) * 3.9;
}

export function buildTimeline(data: DayData, cluster: string = ALL_CLUSTERS): Timeline {
  const slices = buildSliceMap(data, cluster);
  const days: DayEmission[] = [];
  let placed = 0;
  let completed = 0;
  let removed = 0;
  let peakBacklog = 0;

  for (const day of data.days) {
    const slice = slices.get(day);
    if (!slice) continue;
    const f = slice.flows;
    const emission: DayEmission = {
      day,
      placedNew: slice.queued,
      placedToActive: f ? f.placedTodayToActive + f.placedBeforeToActive : 0,
      placedToRemoved: f ? f.placedTodayToRemoved + f.placedBeforeToRemoved : 0,
      placedToCompleted: f ? f.placedTodayToCompleted + f.placedBeforeToCompleted : 0,
      activeToCompleted: f?.activeToCompleted ?? 0,
      activeToRemoved: f?.activeToRemoved ?? 0,
      transitions: slice.started + slice.completed + slice.removed,
    };
    days.push(emission);

    placed += emission.placedNew;
    completed += emission.activeToCompleted + emission.placedToCompleted;
    removed += emission.activeToRemoved + emission.placedToRemoved;
    if (slice.carry && slice.carry.placedOut > peakBacklog) peakBacklog = slice.carry.placedOut;
  }

  // Day 0's carry-in is the census taken as the window opened.
  const firstCarry = slices.get(data.days[0])?.carry;

  return {
    days,
    totals: { placed, completed, removed, peakBacklog },
    initial: { placed: firstCarry?.placedIn ?? 0, active: firstCarry?.activeIn ?? 0 },
  };
}

/**
 * Jobs represented by one grain.
 *
 * Sized per bucket rather than globally: Completed accumulates every job that ever
 * finished and Placed peaks at its largest backlog, and those two peak against
 * differently-sized containers. Taking the worst ratio means whichever bucket is
 * tightest ends near full and none of them overflow — a single global scale would
 * fit Completed comfortably while quietly overrunning Placed.
 */
export function jobsPerGrain(
  timeline: Timeline,
  capacityCells: { completed: number; placed: number; removed: number },
): number {
  const fill = 0.88;
  const need = Math.max(
    timeline.totals.completed / (capacityCells.completed * fill),
    timeline.totals.peakBacklog / (capacityCells.placed * fill),
    timeline.totals.removed / (capacityCells.removed * fill),
    1,
  );
  return Math.max(1, Math.ceil(need));
}

/**
 * Converts a fractional stream of jobs into whole grains without losing the
 * remainder. A day moving fewer jobs than one grain is worth still contributes, and
 * eventually tips a grain over the line, so quiet days are not silently dropped.
 */
export class GrainMeter {
  private carry = 0;

  constructor(private readonly jobsPerGrain: number) {}

  take(jobs: number): number {
    this.carry += jobs / this.jobsPerGrain;
    const whole = Math.floor(this.carry);
    if (whole <= 0) return 0;
    this.carry -= whole;
    return whole;
  }

  reset(): void {
    this.carry = 0;
  }
}
