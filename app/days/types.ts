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
 * Sankey edge weights for one day: how many jobs moved along each path.
 *
 * Three ranks - (Placed Today, Placed Before) -> Active -> (Completed, Removed) -
 * with the Placed nodes also reaching the terminal states directly, for jobs that
 * left the queue without ever running.
 *
 * "Placed Today" is relative to the day being drawn, so one job can be Placed-Today
 * in its own day's diagram and Placed-Before in the next day's.
 */
export interface DayFlows {
  placedTodayToActive: number;
  placedBeforeToActive: number;
  activeToCompleted: number;
  activeToRemoved: number;
  placedTodayToRemoved: number;
  placedBeforeToRemoved: number;
  /** Rare: a terminal completion with no recorded start. */
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
 * The carry-over context a day's Sankey needs to conserve flow: what it inherited
 * from yesterday and what it hands to tomorrow.
 *
 * Without this the diagram only draws transitions, so a job that was already
 * running and stays running contributes nothing and appears to vanish between
 * consecutive days.
 */
export interface DayCarry {
  /** Waiting at the end of the previous day. */
  placedIn: number;
  /** Executing at the end of the previous day. */
  activeIn: number;
  /** Waiting at the end of this day. */
  placedOut: number;
  /** Executing at the end of this day. */
  activeOut: number;
  /** Jobs placed on this day. */
  placedNew: number;
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
  /**
   * Optional: added after the first baked files shipped. The viewer renders an
   * explicit "rebuild needed" state rather than a blank chart when it is absent.
   */
  flows?: DayFlows;
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
  /** Optional: added alongside the Sankey carry-over. */
  carry?: CarryRow[];
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
  /** Null when the baked data predates the Sankey fields. */
  flows: DayFlows | null;
  /** Null when the baked data predates the carry-over census. */
  carry: DayCarry | null;
}
