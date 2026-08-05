// Shape of public/data/clusters/<label>.json, produced by scripts/build-cluster-data.ts.
//
// Mirrors the `ClusterAnalysis` return type of lib/es/clusterAnalysis.ts, with two
// differences: `cluster` is the anonymous published label rather than the real
// ClusterId, and `meta` records which attribute the hold numbers were keyed on.
//
// Relative imports rather than the @/ alias so tsx can load this from a build
// script without depending on tsconfig path resolution.

import type {
  AnalyticsData,
  DashboardData,
  HistogramData,
  HoldData,
  ScatterData,
} from "../../../lib/types";

/**
 * public/data/clusters/index.json -- what the last bake managed, so the page can
 * explain a missing file instead of just reporting its absence.
 */
export interface ClusterIndexFile {
  generatedAt: string;
  /** Job-count ceiling the bake applied; 0 means it attempted everything. */
  maxClusterJobs: number;
  clusters: number[];
  skipped: { cluster: number; jobs: number; reason: string }[];
  failed: { cluster: number; reason: string }[];
}

export interface ClusterAnalysisFile {
  /** Anonymous cluster label, matching ClusterInfo.id in day-cards.json. */
  cluster: number;
  generatedAt: string;
  dashboard: DashboardData;
  histogram: HistogramData | null;
  scatter: ScatterData | null;
  holds: HoldData;
  analytics: AnalyticsData;
  /** Truncation / fidelity notices from the aggregations, surfaced in the UI. */
  warnings: string[];
  meta: {
    requests: number;
    tookMs: number;
    /** Always 0 here: the bake is aggregations-only. */
    documentsFetched: number;
    /**
     * Which attribute held jobs were found by. "LastJobStatus" for history
     * records, where JobStatus only ever holds the terminal state.
     */
    holdsKeyedOn: string;
  };
}
