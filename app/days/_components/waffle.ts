// Turning job counts into 10x10 grid boxes.

import type { JobState, StateCounts } from "../types";
import { FILL_ORDER, STATE_ORDER } from "./palette";

export const GRID_DIM = 10;
export const BOX_COUNT = GRID_DIM * GRID_DIM;

/**
 * Jobs represented by one box.
 *
 * One job per box until a cohort outgrows the grid, then the smallest scale that
 * still fits in 100 boxes. Kept exact rather than rounded to a tidy power of ten
 * so the grid always fills proportionally -- a cohort of 15,000 shown at 1,000
 * jobs/box would light only 15 of the 100 boxes and read as a nearly empty day.
 */
export function jobsPerBox(total: number): number {
  if (total <= BOX_COUNT) return 1;
  return Math.ceil(total / BOX_COUNT);
}

/**
 * Apportion boxes across the four states by largest remainder, so the box counts
 * sum exactly to the number of boxes the cohort fills.
 *
 * A state holding a genuinely tiny share rounds to zero boxes rather than being
 * promoted to a full box -- one removed job out of 1.5M would otherwise be drawn
 * as ~15,000. The card prints every state's real number beside its swatch, so a
 * zero-box state is still legible.
 */
export function allocateBoxes(counts: StateCounts): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return STATE_ORDER.map(() => 0);

  const boxes = Math.min(BOX_COUNT, Math.ceil(total / jobsPerBox(total)));
  const exact = counts.map((c) => (c / total) * boxes);
  const allocated = exact.map(Math.floor);

  // Each floor discards under one box, so the shortfall is always < 4.
  let remaining = boxes - allocated.reduce((a, b) => a + b, 0);
  const byFraction = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remaining > 0 && k < byFraction.length; k++, remaining--) {
    allocated[byFraction[k].i]++;
  }
  return allocated;
}

/**
 * The 100 cells in paint order: a JobState where a box is filled, null where the
 * cohort does not reach.
 */
export function buildCells(counts: StateCounts | null): (JobState | null)[] {
  const cells: (JobState | null)[] = new Array(BOX_COUNT).fill(null);
  if (!counts) return cells;

  const allocated = allocateBoxes(counts);
  let cursor = 0;
  for (const state of FILL_ORDER) {
    const n = allocated[STATE_ORDER.indexOf(state)];
    for (let k = 0; k < n && cursor < BOX_COUNT; k++) cells[cursor++] = state;
  }
  return cells;
}

/** "1 box = 1 job" / "1 box = 15,061 jobs" */
export function boxScaleLabel(total: number): string {
  if (total === 0) return "No jobs queued";
  const per = jobsPerBox(total);
  return per === 1 ? "1 box = 1 job" : `1 box = ${per.toLocaleString()} jobs`;
}
