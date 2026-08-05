// Shared types for the HTCondor cluster analyzer.

/** A single job record parsed from the history CSV. Values are raw strings. */
export type JobRecord = Record<string, string>;

export interface ParsedCsv {
  jobs: JobRecord[];
  clusterId: string;
}

export const JOB_STATES = [
  "Idle",
  "Running",
  "Removing",
  "Completed",
  "Held",
  "Transferring Output",
  "Suspended",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export interface DashboardData {
  totalJobs: number;
  counts: Record<JobState, number>;
}

export interface HistogramBin {
  pctStart: number;
  pctEnd: number;
  left: number;
  right: number;
  count: number;
  median: number;
  isFast: boolean; // median < 600s
}

export interface HistogramData {
  clusterId: string;
  totalRuntimeJobs: number;
  bins: HistogramBin[];
  fastJobCount: number; // jobs in bins flagged fast
  firstSubmitted: number | null;
  lastCompleted: number | null;
}

export interface ScatterData {
  points: { x: number; y: number }[]; // job index vs runtime (capped at p95)
  maxIndex: number;
  maxRuntime: number; // p95
  median: number;
  correlation: number;
  trend: "longer" | "faster" | "consistent";
  outliers: number;
  totalJobs: number;
}

export interface HoldBucket {
  code: number;
  label: string;
  subCode: number;
  count: number;
  percent: number;
  exampleReason: string;
  avgHoldSeconds: number | null;
  avgHoldLabel: string;
  procIds: number[];
}

export interface HoldData {
  heldCount: number;
  buckets: HoldBucket[];
  legend: { code: number; label: string; reason: string }[];
  timeStats: {
    firstHeld: number;
    lastHeld: number;
    durationHours: number;
    avgHoldDuration: number;
  } | null;
}

export interface ResourceRequestRow {
  value: number;
  count: number;
}

export interface NumberSummary {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  stdDev: number;
  hasData: boolean;
  percentage: boolean;
}

export interface UsageDistributionBin {
  label: string;
  count: number;
  pct: number;
}

export interface SavingsRec {
  resource: "memory" | "disk" | "cpu";
  current: number;
  recommended: number;
  savingsGibHours?: number;
  reductionPct?: number;
  currentEfficiency?: number;
  jobsAffected: number;
}

export interface AnalyticsData {
  clusterId: string;
  totalJobs: number;
  avgRuntime: number; // seconds
  avgRuntimeLabel: string;
  memRequested: ResourceRequestRow[];
  diskRequested: ResourceRequestRow[];
  cpuRequested: ResourceRequestRow[];
  gpuRequested: ResourceRequestRow[];
  memEfficiency: number;
  diskEfficiency: number;
  cpuEfficiency: number;
  summaries: NumberSummary[];
  memDistribution: UsageDistributionBin[];
  memDistributionUnit: string;
  diskDistribution: UsageDistributionBin[];
  diskDistributionUnit: string;
  savings: SavingsRec[];
}
