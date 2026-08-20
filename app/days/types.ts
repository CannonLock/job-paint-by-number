// Shape of public/data/stacked-bars.json, produced by scripts/build-stacked-bar-data.mjs.
//
// Three-state model: a job is Active from the moment it is placed (there is no
// separate Placed state on this page) and leaves only by completing or being
// removed. Everything is pre-binned at 4-hour resolution; the client only does
// cumulative sums and percentages.
//
// Copied from app/stacked-bar/types.ts rather than imported: this route is
// self-contained, and the two pages are allowed to evolve separately.

import type { BatchInfo } from "./_components/grouping";

/** The three states this viewer paints. */
export type BarState = "active" | "completed" | "removed";

/** Sparse bin counts: [binIndex, count][], bin indices ascending over the window. */
export type SparseBins = [number, number][];

/** One cluster's window-long series at 4-hour resolution. */
export interface ClusterSeries {
  /** Anonymized cluster label (matches the labels on the other pages). */
  cluster: number;
  /**
   * Batch this cluster belongs to, as a published batch id. Absent on data baked
   * before batch grouping existed.
   */
  batch?: string;
  /** openingActive + jobs placed inside the window; for the select's labels. */
  total: number;
  /** Jobs already in play when the window opened. */
  openingActive: number;
  placed: SparseBins;
  completed: SparseBins;
  removed: SparseBins;
}

export interface StackedBarData {
  owner: string;
  anonymized?: boolean;
  generatedAt: string;
  timezone: string;
  /** Every day in the window, ascending, "YYYY-MM-DD". */
  days: string[];
  binHours: number;
  binsPerDay: number;
  series: ClusterSeries[];
  /**
   * Batch groups: one batch usually spans several clusters. Absent on data baked
   * before batch grouping existed. Names are pseudonyms unless the bake ran with
   * ANONYMIZE=0 -- a real JobBatchName is free text and identifies its submitter
   * more readily than a cluster number does.
   */
  batches?: BatchInfo[];
  sources: {
    adstash: { host: string; index: string };
    condorQ: { pool: string; schedd: string; liveAds: number };
  };
}

/**
 * How bar heights map to counts in the calendar's magnitude view. Linear is
 * proportional but hides quiet days next to a heavy one; log keeps them visible
 * at the cost of proportionality. See ScaleInfo.tsx for the wording the page
 * shows the reader.
 */
export type BarScale = "linear" | "log";
