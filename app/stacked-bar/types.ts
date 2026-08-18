// Shape of public/data/stacked-bars.json, produced by scripts/build-stacked-bar-data.mjs.
//
// Three-state model: a job is Active from the moment it is placed (there is no
// separate Placed state on this page) and leaves only by completing or being
// removed. Everything is pre-binned at 4-hour resolution; the client only does
// cumulative sums and percentages.

/** The three states this viewer paints. */
export type BarState = "active" | "completed" | "removed";

/** Sparse bin counts: [binIndex, count][], bin indices ascending over the window. */
export type SparseBins = [number, number][];

/** One cluster's window-long series at 4-hour resolution. */
export interface ClusterSeries {
  /** Anonymized cluster label (matches the labels on the Sankey pages). */
  cluster: number;
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
  sources: {
    adstash: { host: string; index: string };
    condorQ: { pool: string; schedd: string; liveAds: number };
  };
}
