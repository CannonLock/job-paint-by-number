// Shape of public/data/day-cards.json, produced by scripts/build-day-data.mjs.
//
// Everything is pre-aggregated at build time from both HTCondor sources (Adstash
// for terminal records, condor_q for the live queue), so nothing here is per-job.

/** Job states the viewer paints. Hold is absent: the history records carry none. */
export type JobState = "queued" | "running" | "completed" | "removed";

/** Counts in JobState order: [queued, running, completed, removed]. */
export type StateCounts = readonly [number, number, number, number];

/** The set of jobs one cluster queued on one day. */
export interface Cohort {
  cluster: number;
  /** Day the cohort was submitted, "YYYY-MM-DD". */
  day: string;
  /** Jobs in the cohort. Every asOf entry sums to this. */
  queued: number;
  /** Four-state breakdown as of the end of each day from `day` onward. */
  asOf: Record<string, StateCounts>;
}

/**
 * Transitions that happened on one day, whatever day the jobs were queued.
 *
 * started/completed/removed count transitions, so a job that ran and finished the
 * same day appears in two of them. `changed` counts distinct jobs that moved at
 * all. They are deliberately not reconcilable: the calendar shows `changed` so a
 * day's headline is a job count, and the day detail shows the transitions.
 */
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
  /**
   * Anonymized cluster label (1, 2, 3, ...), not the real HTCondor ClusterId --
   * a real one is a re-identification handle. See ANONYMIZE in
   * scripts/build-day-data.mjs.
   */
  id: number;
  /** Jobs queued inside the window; 0 for a cluster that only has transitions. */
  total: number;
  firstQueued: string | null;
}

export interface DayData {
  /** Display label, not the real username when `anonymized` is true. */
  owner: string;
  /** True when cluster IDs were renumbered and the owner replaced at build time. */
  anonymized?: boolean;
  generatedAt: string;
  timezone: string;
  /** Every day in the window, ascending, "YYYY-MM-DD". */
  days: string[];
  states: JobState[];
  clusters: ClusterInfo[];
  cohorts: Cohort[];
  activity: ActivityRow[];
  sources: {
    adstash: { host: string; index: string; terminalRecords: number };
    condorQ: { pool: string; schedd: string; liveAds: number; stillQueued: number };
  };
  counted: number;
  skippedOutsideWindow?: number;
}

/** One card's worth of data, after cluster filtering and cross-cluster summing. */
export interface DaySlice {
  day: string;
  /** Jobs queued on this day, and their state as of the selected day. */
  queued: number;
  stateAsOf: StateCounts | null;
  /** Transitions on this day (all jobs, any queue day); a job may be in several. */
  started: number;
  completed: number;
  removed: number;
  /** Distinct jobs that moved this day. Not the sum of the three above. */
  changed: number;
}
