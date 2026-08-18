// Turning job counts into 10x10 grid boxes -- the three-state version of the
// Sankey page's waffle math (copied, not imported: this route is self-contained).

import type { BarState } from "../types";
import { BAR_COUNT_ORDER, type BarCounts } from "./dayCards";
import { BAR_FILL_ORDER } from "./palette";

export const GRID_DIM = 10;
export const BOX_COUNT = GRID_DIM * GRID_DIM;

/**
 * Jobs represented by one box: one job per box until the cohort outgrows the grid,
 * then the smallest exact scale that fits 100 boxes, so the grid always fills
 * proportionally.
 */
export function jobsPerBox(total: number): number {
  if (total <= BOX_COUNT) return 1;
  return Math.ceil(total / BOX_COUNT);
}

/**
 * Apportion boxes across the three states by largest remainder, summing exactly to
 * the boxes the cohort fills. A genuinely tiny share rounds to zero boxes rather
 * than being promoted to a whole one; the labelled numbers are the relief.
 */
export function allocateBoxes(counts: BarCounts): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return BAR_COUNT_ORDER.map(() => 0);

  const boxes = Math.min(BOX_COUNT, Math.ceil(total / jobsPerBox(total)));
  const exact = counts.map((c) => (c / total) * boxes);
  const allocated = exact.map(Math.floor);

  let remaining = boxes - allocated.reduce((a, b) => a + b, 0);
  const byFraction = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remaining > 0 && k < byFraction.length; k++, remaining--) {
    allocated[byFraction[k].i]++;
  }
  return allocated;
}

/** The 100 cells in paint order: a BarState where filled, null where unreached. */
export function buildCells(counts: BarCounts | null): (BarState | null)[] {
  const cells: (BarState | null)[] = new Array(BOX_COUNT).fill(null);
  if (!counts) return cells;

  const allocated = allocateBoxes(counts);
  let cursor = 0;
  for (const state of BAR_FILL_ORDER) {
    const n = allocated[BAR_COUNT_ORDER.indexOf(state)];
    for (let k = 0; k < n && cursor < BOX_COUNT; k++) cells[cursor++] = state;
  }
  return cells;
}

/** "1 box = 1 job" / "1 box = 15,061 jobs" */
export function boxScaleLabel(total: number): string {
  if (total === 0) return "No jobs placed";
  const per = jobsPerBox(total);
  return per === 1 ? "1 box = 1 job" : `1 box = ${per.toLocaleString()} jobs`;
}
