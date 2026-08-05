/**
 * Server-side (Elasticsearch) replacement for the CSV pipeline in `lib/`.
 *
 * The current analyzer downloads every job document for a cluster and reduces it
 * in the browser (see lib/csv.ts, lib/analytics.ts, lib/histogram.ts, …). This
 * module produces the *same* view models — DashboardData, HistogramData,
 * ScatterData, HoldData, AnalyticsData — from aggregations, so the wire payload
 * is a few kilobytes of pre-reduced numbers instead of N job records.
 *
 * Cost model: 2 requests (3 if you want a real scatter point cloud).
 *
 *   1. buildOverviewRequest()  — size:0, one pass, every aggregation that does
 *                                not depend on a previously computed value.
 *   2. buildRefineRequest()    — size:0, the aggregations that need phase-1
 *                                outputs as inputs: runtime percentile bin
 *                                edges, ProcId histogram interval, and the
 *                                data-range-dependent usage distribution edges.
 *   3. buildScatterSampleRequest() — the only request that returns documents:
 *                                a bounded random sample (default 2 000) of
 *                                (ProcId, RemoteWallClockTime) pairs, used
 *                                purely for the visual density of the scatter.
 *                                Every *statistic* on that chart (median, p95,
 *                                Pearson r, outlier count) comes from phase 1
 *                                and is exact over the full cluster. Set
 *                                scatterMode:"binned" to drop this request.
 *
 * Field names are declared once in FIELDS and every script guards with
 * doc.containsKey(), because ClassAd casing and the presence of `_RAW` variants
 * differ between indices. Run describeFields() once against your cluster to see
 * what actually exists and how it is mapped before trusting the defaults.
 *
 * Known, deliberate divergences from the CSV implementation are marked FIDELITY.
 */

import { formatDuration, formatTimedelta } from "../format";
import { HOLD_REASON_CODES } from "../holds";
import { sequenceMatcherRatio } from "../stats";
import {
  JOB_STATES,
  type AnalyticsData,
  type DashboardData,
  type HistogramBin,
  type HistogramData,
  type HoldBucket,
  type HoldData,
  type JobState,
  type NumberSummary,
  type ResourceRequestRow,
  type SavingsRec,
  type ScatterData,
  type UsageDistributionBin,
} from "../types";

// ---------------------------------------------------------------------------
// 1. Connection + field configuration
// ---------------------------------------------------------------------------

export interface EsConfig {
  host: string;
  index: string;
  /** Optional HTTP basic auth. Prefer proxying through a route handler instead. */
  username?: string;
  password?: string;
  /** Injectable for tests / non-browser runtimes. */
  fetchImpl?: typeof fetch;
}

export const DEFAULT_ES: EsConfig = {
  host: "http://localhost:9200",
  index: "chtc-schedd-*",
};

/**
 * Logical name -> candidate ClassAd attribute names, most preferred first. The
 * first name that exists on a document wins; see coalesce() below.
 *
 * The `_RAW` variants are what lib/csv.ts reads. HTCondor's non-`_RAW`
 * ResidentSetSize / DiskUsage carry the same units (KiB) but are rounded up to
 * a slot granularity, so falling back to them changes usage numbers slightly.
 */
export const FIELDS = {
  clusterId: "ClusterId",
  procId: "ProcId",
  globalJobId: "GlobalJobId",
  projectName: "ProjectName",
  owner: "Owner",
  jobStatus: "JobStatus",
  qDate: "QDate",
  completionDate: "CompletionDate",
  wallClock: "RemoteWallClockTime",
  userCpu: "RemoteUserCpu",
  sysCpu: "RemoteSysCpu",
  requestMemory: "RequestMemory",
  requestDisk: "RequestDisk",
  requestCpus: "RequestCpus",
  requestGpus: "RequestGpus",
  residentSetSize: ["ResidentSetSize_RAW", "ResidentSetSize"],
  diskUsage: ["DiskUsage_RAW", "DiskUsage"],
  holdReasonCode: "HoldReasonCode",
  holdReasonSubCode: "HoldReasonSubCode",
  /** Aggregatable form of HoldReason. Change to "HoldReason" if it is mapped as a bare keyword. */
  holdReasonKeyword: "HoldReason.keyword",
  enteredCurrentStatus: "EnteredCurrentStatus",
} as const;

/** Keyword subfield used for string terms/filters on analyzed text fields. */
const KEYWORD_SUFFIX = ".keyword";

export interface AnalysisOptions {
  /** Number of runtime percentile bins. Matches computeHistogram's `percentiles`. */
  histogramBins?: number;
  /** tdigest compression for percentile aggs. Higher = more accurate, more memory. */
  tdigestCompression?: number;
  /** Max distinct values returned per requested-resource table. */
  requestTermsSize?: number;
  /** Max distinct HoldReason strings fetched per hold code. */
  holdReasonTermsSize?: number;
  /** Fuzzy-match threshold for grouping hold reasons. Matches computeHolds. */
  holdReasonThreshold?: number;
  /** "sample" fetches a bounded point cloud; "binned" derives the scatter from aggs only. */
  scatterMode?: "sample" | "binned";
  /** Documents fetched for the scatter point cloud when scatterMode === "sample". */
  scatterSampleSize?: number;
  /** Buckets used for the ProcId histogram backing the binned scatter. */
  scatterBuckets?: number;
  /** Injectable clock — hold durations are relative to "now", like computeHolds. */
  now?: Date;
  /** Deterministic seed for the scatter sample. */
  randomSeed?: number;
}

const DEFAULTS: Required<Omit<AnalysisOptions, "now">> = {
  histogramBins: 10,
  tdigestCompression: 400,
  requestTermsSize: 200,
  holdReasonTermsSize: 200,
  holdReasonThreshold: 0.7,
  scatterMode: "sample",
  scatterSampleSize: 2000,
  scatterBuckets: 200,
  randomSeed: 1,
};

function withDefaults(opts: AnalysisOptions = {}) {
  return { ...DEFAULTS, ...opts, now: opts.now ?? new Date() };
}

const FAST_JOB_THRESHOLD = 600; // seconds; mirrors lib/histogram.ts

// ---------------------------------------------------------------------------
// 2. Scope — which jobs are "this cluster"
// ---------------------------------------------------------------------------

/**
 * ClusterId is only unique *per schedd*, so a bare ClusterId term can merge two
 * unrelated clusters when the index pattern spans multiple submit hosts. Pass
 * `scheddName` (matched against the host part of GlobalJobId) or restrict
 * `index` to a single schedd to disambiguate.
 */
export interface ClusterScope {
  clusterId: string | number;
  scheddName?: string;
  projectName?: string;
  owner?: string;
  /** Inclusive epoch-second bounds on QDate. */
  submittedAfter?: number;
  submittedBefore?: number;
}

type EsQuery = Record<string, unknown>;

export function buildScopeQuery(scope: ClusterScope): EsQuery {
  const filter: EsQuery[] = [];

  const raw = String(scope.clusterId).trim();
  // ClusterId is numeric in every index we have seen, but tolerate a keyword mapping.
  filter.push(
    /^\d+$/.test(raw)
      ? { term: { [FIELDS.clusterId]: Number(raw) } }
      : { term: { [`${FIELDS.clusterId}${KEYWORD_SUFFIX}`]: raw } },
  );

  if (scope.scheddName) {
    // GlobalJobId looks like "submit.host#cluster.proc#timestamp".
    filter.push({ prefix: { [`${FIELDS.globalJobId}${KEYWORD_SUFFIX}`]: `${scope.scheddName}#` } });
  }
  if (scope.projectName) {
    filter.push({ term: { [`${FIELDS.projectName}${KEYWORD_SUFFIX}`]: scope.projectName } });
  }
  if (scope.owner) {
    filter.push({ term: { [`${FIELDS.owner}${KEYWORD_SUFFIX}`]: scope.owner } });
  }
  if (scope.submittedAfter !== undefined || scope.submittedBefore !== undefined) {
    const range: Record<string, number> = {};
    if (scope.submittedAfter !== undefined) range.gte = scope.submittedAfter;
    if (scope.submittedBefore !== undefined) range.lte = scope.submittedBefore;
    filter.push({ range: { [FIELDS.qDate]: range } });
  }

  return { bool: { filter } };
}

// ---------------------------------------------------------------------------
// 3. Runtime fields — the per-job derived values the CSV code computed in JS
// ---------------------------------------------------------------------------

/**
 * Emit a painless prelude that reads the first present field from `names` into
 * `varName`, with a `<varName>_ok` flag. A field that exists but holds 0 stops
 * the search, which matches lib/csv.ts reading one fixed column and lib/
 * analytics.ts discarding falsy values.
 */
function coalesce(varName: string, names: readonly string[] | string): string {
  const list = typeof names === "string" ? [names] : names;
  const lines = [`double ${varName} = 0; boolean ${varName}_ok = false;`];
  for (const n of list) {
    lines.push(
      `if (!${varName}_ok && doc.containsKey('${n}') && doc['${n}'].size() > 0) ` +
        `{ ${varName} = (double) doc['${n}'].value; ${varName}_ok = true; }`,
    );
  }
  return lines.join("\n");
}

const KIB_PER_GIB = 1048576;
const MIB_PER_GIB = 1024;

/** round2() from lib/analytics.ts, in painless — kept so request tables key identically. */
const ROUND2 = (expr: string) => `Math.round((${expr}) * 100.0) / 100.0`;

type RuntimeMappings = Record<string, { type: string; script: { source: string } }>;

/**
 * Per-document derived fields. These exist only for the duration of the search
 * request — nothing is indexed and no mapping is modified.
 */
export const RUNTIME_MAPPINGS: RuntimeMappings = {
  // ResidentSetSize_RAW is KiB -> GiB.
  mem_used_gib: {
    type: "double",
    script: {
      source: `${coalesce("mu", FIELDS.residentSetSize)}
if (mu_ok && mu > 0) { emit(mu / ${KIB_PER_GIB}.0); }`,
    },
  },
  // DiskUsage_RAW is KiB -> GiB.
  disk_used_gib: {
    type: "double",
    script: {
      source: `${coalesce("du", FIELDS.diskUsage)}
if (du_ok && du > 0) { emit(du / ${KIB_PER_GIB}.0); }`,
    },
  },
  // RequestMemory is MiB -> GiB.
  mem_req_gib: {
    type: "double",
    script: {
      source: `${coalesce("mr", FIELDS.requestMemory)}
if (mr_ok && mr > 0) { emit(${ROUND2(`mr / ${MIB_PER_GIB}.0`)}); }`,
    },
  },
  // RequestDisk is KiB -> GiB.
  disk_req_gib: {
    type: "double",
    script: {
      source: `${coalesce("dr", FIELDS.requestDisk)}
if (dr_ok && dr > 0) { emit(${ROUND2(`dr / ${KIB_PER_GIB}.0`)}); }`,
    },
  },
  /**
   * FIDELITY: lib/analytics.ts zips two independently filtered arrays
   * (memUsed[i] vs memRequested[i]), so its per-job efficiency is misaligned
   * whenever a job has one value but not the other. This computes it per
   * document, which is what the chart is meant to show; on sparse data the
   * median efficiency will differ from the CSV UI.
   */
  mem_eff_pct: {
    type: "double",
    script: {
      source: `${coalesce("mu", FIELDS.residentSetSize)}
${coalesce("mr", FIELDS.requestMemory)}
if (mu_ok && mu > 0 && mr_ok && mr > 0) {
  double reqGib = ${ROUND2(`mr / ${MIB_PER_GIB}.0`)};
  if (reqGib > 0) { emit(((mu / ${KIB_PER_GIB}.0) / reqGib) * 100.0); }
}`,
    },
  },
  disk_eff_pct: {
    type: "double",
    script: {
      source: `${coalesce("du", FIELDS.diskUsage)}
${coalesce("dr", FIELDS.requestDisk)}
if (du_ok && du > 0 && dr_ok && dr > 0) {
  double reqGib = ${ROUND2(`dr / ${KIB_PER_GIB}.0`)};
  if (reqGib > 0) { emit(((du / ${KIB_PER_GIB}.0) / reqGib) * 100.0); }
}`,
    },
  },
  /**
   * FIDELITY: this reproduces lib/analytics.ts exactly, including its use of
   * RemoteSysCpu alone (RemoteUserCpu only gates whether the job counts). That
   * is almost certainly a bug there — real CPU efficiency is
   * (user + sys) / cpus / wall — but changing it here would make these numbers
   * disagree with the CSV UI. Swap `sys` for `(usr + sys)` when you are ready
   * to fix both.
   */
  cpu_eff_pct: {
    type: "double",
    script: {
      source: `${coalesce("sys", FIELDS.sysCpu)}
${coalesce("usr", FIELDS.userCpu)}
${coalesce("cpus", FIELDS.requestCpus)}
${coalesce("wall", FIELDS.wallClock)}
if (wall > 0 && cpus > 0 && (sys != 0 || usr != 0)) {
  emit(((sys / cpus) / wall) * 100.0);
}`,
    },
  },
};

// ---------------------------------------------------------------------------
// 4. Phase 1 — everything that needs no precomputed input
// ---------------------------------------------------------------------------

/** Percentile boundaries for the runtime histogram, plus p95 for the scatter cap. */
function histogramPercents(bins: number): number[] {
  const pcts = new Set<number>();
  for (let i = 0; i <= bins; i++) pcts.add((100 * i) / bins);
  pcts.add(50);
  pcts.add(95);
  return [...pcts].sort((a, b) => a - b);
}

export function buildOverviewRequest(scope: ClusterScope, options: AnalysisOptions = {}): EsQuery {
  const o = withDefaults(options);
  const tdigest = { compression: o.tdigestCompression };

  return {
    size: 0,
    track_total_hits: true,
    query: buildScopeQuery(scope),
    runtime_mappings: RUNTIME_MAPPINGS,
    aggs: {
      // --- Tab 1: Status Dashboard -------------------------------------------
      // JobStatus is 1-indexed into JOB_STATES; size covers the whole enum.
      job_status: { terms: { field: FIELDS.jobStatus, size: 16 } },

      // --- Tab 2: Runtime histogram + scatter --------------------------------
      // Scoped to jobs that have a runtime at all. Note lib/histogram.ts keeps
      // runtime === 0, so this is `exists`, not `range > 0`.
      runtime: {
        filter: { exists: { field: FIELDS.wallClock } },
        aggs: {
          // Percentile cut points become the histogram bin edges in phase 2.
          edges: {
            percentiles: {
              field: FIELDS.wallClock,
              percents: histogramPercents(o.histogramBins),
              tdigest,
            },
          },
          first_submitted: { min: { field: FIELDS.qDate } },
          last_completed: { max: { field: FIELDS.completionDate } },
          max_proc: { max: { field: FIELDS.procId } },
          // Exact Pearson r over the full cluster, no documents transferred.
          // FIDELITY: x is ProcId; the CSV version used CSV row order.
          xy: { matrix_stats: { fields: [FIELDS.procId, FIELDS.wallClock] } },
        },
      },

      // --- Tab 3: Hold classifier -------------------------------------------
      holds: {
        filter: {
          bool: {
            filter: [
              { term: { [FIELDS.jobStatus]: 5 } },
              { exists: { field: FIELDS.holdReasonCode } },
            ],
          },
        },
        aggs: {
          first_held: { min: { field: FIELDS.enteredCurrentStatus } },
          last_held: { max: { field: FIELDS.enteredCurrentStatus } },
          avg_held: { avg: { field: FIELDS.enteredCurrentStatus } },
          by_code: {
            terms: { field: FIELDS.holdReasonCode, size: 64 },
            aggs: {
              // Distinct reason strings + counts. The fuzzy (difflib) grouping
              // then runs client-side over these few hundred strings instead of
              // over every held job — same result, no per-job transfer.
              by_reason: {
                terms: {
                  field: FIELDS.holdReasonKeyword,
                  size: o.holdReasonTermsSize,
                  order: { _count: "desc" },
                },
                aggs: {
                  sub_code: { terms: { field: FIELDS.holdReasonSubCode, size: 1 } },
                  avg_entered: { avg: { field: FIELDS.enteredCurrentStatus } },
                },
              },
              distinct_reasons: { cardinality: { field: FIELDS.holdReasonKeyword } },
            },
          },
        },
      },

      // --- Tab 4: Resource report -------------------------------------------
      // Requested-resource tables. Ordered by count so a high-cardinality field
      // (RequestDisk is often auto-sized per job) returns the values that
      // matter; the transform re-sorts ascending by value. `*_distinct` lets the
      // UI tell whether the table is complete.
      req_memory: {
        terms: { field: FIELDS.requestMemory, size: o.requestTermsSize, order: { _count: "desc" } },
      },
      req_memory_distinct: { cardinality: { field: FIELDS.requestMemory } },
      req_disk: {
        terms: { field: FIELDS.requestDisk, size: o.requestTermsSize, order: { _count: "desc" } },
      },
      req_disk_distinct: { cardinality: { field: FIELDS.requestDisk } },
      req_cpus: { terms: { field: FIELDS.requestCpus, size: 64, order: { _count: "desc" } } },
      req_gpus: { terms: { field: FIELDS.requestGpus, size: 64, order: { _count: "desc" } } },

      // Usage summary table: min/max/stddev from extended_stats, quartiles from
      // percentiles. p95 additionally feeds the savings recommendations.
      mem_used_stats: { extended_stats: { field: "mem_used_gib" } },
      mem_used_pcts: { percentiles: { field: "mem_used_gib", percents: [25, 50, 75, 95], tdigest } },
      disk_used_stats: { extended_stats: { field: "disk_used_gib" } },
      disk_used_pcts: {
        percentiles: { field: "disk_used_gib", percents: [25, 50, 75, 95], tdigest },
      },
      cpu_eff_stats: { extended_stats: { field: "cpu_eff_pct" } },
      cpu_eff_pcts: { percentiles: { field: "cpu_eff_pct", percents: [25, 50, 75], tdigest } },

      // Median per-job efficiency drives the utilization bars.
      mem_eff_median: { percentiles: { field: "mem_eff_pct", percents: [50], tdigest } },
      disk_eff_median: { percentiles: { field: "disk_eff_pct", percents: [50], tdigest } },

      // Median *requested* values for the savings math.
      mem_req_median: { percentiles: { field: "mem_req_gib", percents: [50], tdigest } },
      disk_req_median: { percentiles: { field: "disk_req_gib", percents: [50], tdigest } },
      cpu_req: {
        filter: { range: { [FIELDS.requestCpus]: { gt: 0 } } },
        aggs: { median: { percentiles: { field: FIELDS.requestCpus, percents: [50], tdigest } } },
      },

      runtime_avg: { avg: { field: FIELDS.wallClock } },
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Phase 2 — aggregations parameterised by phase-1 results
// ---------------------------------------------------------------------------

/** Bin edges from print_usage_distribution in lib/analytics.ts. Infinity = open-ended. */
export function distributionEdges(maxVal: number): { edges: number[]; labels: string[] } {
  if (maxVal <= 10) return { edges: [0, 2, 5, 10, Infinity], labels: ["0-2", "2-5", "5-10", "10+"] };
  if (maxVal <= 50) {
    return { edges: [0, 5, 10, 20, 50, Infinity], labels: ["0-5", "5-10", "10-20", "20-50", "50+"] };
  }
  return {
    edges: [0, 10, 25, 50, 100, Infinity],
    labels: ["0-10", "10-25", "25-50", "50-100", "100+"],
  };
}

/** Build keyed range-agg buckets, omitting `to` on an open-ended final edge. */
function rangesFrom(edges: number[], labels: string[]): EsQuery[] {
  return labels.map((key, i) => {
    const from = edges[i];
    const to = edges[i + 1];
    return Number.isFinite(to) ? { key, from, to } : { key, from };
  });
}

export interface Phase1Derived {
  /** Histogram bin edges, ascending and clamped monotonic. */
  runtimeEdges: number[];
  runtimeP95: number;
  maxProcId: number;
  memUsedMax: number;
  diskUsedMax: number;
}

export function buildRefineRequest(
  scope: ClusterScope,
  derived: Phase1Derived,
  options: AnalysisOptions = {},
): EsQuery {
  const o = withDefaults(options);
  const tdigest = { compression: o.tdigestCompression };

  // Runtime bins. ES ranges are [from, to); the last bucket is left open so it
  // includes the maximum, matching the `r >= left && r <= right` special case
  // for the final bin in lib/histogram.ts.
  const runtimeRanges: EsQuery[] = [];
  for (let i = 0; i < derived.runtimeEdges.length - 1; i++) {
    const from = derived.runtimeEdges[i];
    const to = derived.runtimeEdges[i + 1];
    const isLast = i === derived.runtimeEdges.length - 2;
    runtimeRanges.push(isLast ? { key: String(i), from } : { key: String(i), from, to });
  }

  const procInterval = Math.max(
    1,
    Math.ceil((derived.maxProcId + 1) / Math.max(1, o.scatterBuckets)),
  );

  const mem = distributionEdges(derived.memUsedMax);
  const disk = distributionEdges(derived.diskUsedMax);

  return {
    size: 0,
    track_total_hits: false,
    query: buildScopeQuery(scope),
    runtime_mappings: RUNTIME_MAPPINGS,
    aggs: {
      runtime: {
        filter: { exists: { field: FIELDS.wallClock } },
        aggs: {
          // Count + median per percentile bin -> bar heights and the "fast bin" flag.
          bins: {
            range: { field: FIELDS.wallClock, ranges: runtimeRanges, keyed: true },
            aggs: { median: { percentiles: { field: FIELDS.wallClock, percents: [50], tdigest } } },
          },
          // Jobs above p95 are the ones the scatter caps to the top of the chart.
          outliers: { filter: { range: { [FIELDS.wallClock]: { gt: derived.runtimeP95 } } } },
          // Runtime-vs-position without transferring points: a median band over
          // ProcId. Used directly when scatterMode === "binned".
          by_proc: {
            histogram: { field: FIELDS.procId, interval: procInterval, min_doc_count: 1 },
            aggs: {
              spread: { percentiles: { field: FIELDS.wallClock, percents: [25, 50, 75], tdigest } },
            },
          },
        },
      },
      mem_distribution: {
        range: { field: "mem_used_gib", ranges: rangesFrom(mem.edges, mem.labels), keyed: true },
      },
      disk_distribution: {
        range: { field: "disk_used_gib", ranges: rangesFrom(disk.edges, disk.labels), keyed: true },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Optional scatter point cloud — the only request that returns documents
// ---------------------------------------------------------------------------

/**
 * A bounded random sample of (ProcId, RemoteWallClockTime). docvalue_fields with
 * _source:false keeps each hit to two numbers, so 2 000 points is ~50 KB rather
 * than the multi-hundred-MB full-document pull the CSV flow needs.
 */
export function buildScatterSampleRequest(
  scope: ClusterScope,
  options: AnalysisOptions = {},
): EsQuery {
  const o = withDefaults(options);
  return {
    size: o.scatterSampleSize,
    track_total_hits: false,
    _source: false,
    docvalue_fields: [FIELDS.procId, FIELDS.wallClock],
    query: {
      function_score: {
        query: {
          bool: {
            filter: [buildScopeQuery(scope), { exists: { field: FIELDS.wallClock } }],
          },
        },
        // Seeded so repeated loads render the same cloud. `_seq_no` is the
        // recommended random_score field; drop it if the index predates it.
        random_score: { seed: o.randomSeed, field: "_seq_no" },
        boost_mode: "replace",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Response readers
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** Read one percentile out of a keyed `percentiles` response, tolerating "95" vs "95.0". */
function pct(agg: any, p: number): number {
  const values = agg?.values ?? {};
  const candidates = [p.toFixed(1), String(p), `${p}.0`];
  for (const k of candidates) {
    if (values[k] !== undefined && values[k] !== null) return num(values[k]);
  }
  return 0;
}

/**
 * HTCondor epochs are seconds, but some pipelines map these attributes as
 * `date`, in which case min/max/avg come back in milliseconds.
 */
function toEpochSeconds(v: unknown): number | null {
  const n = num(v, NaN);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n / 1000 : n;
}

/** extended_stats reports population stddev; lib/stats.ts uses the sample one. */
function sampleStdDev(popStdDev: number, count: number): number {
  if (count < 2) return 0;
  return popStdDev * Math.sqrt(count / (count - 1));
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Sum counts for values that collide after conversion/truncation. */
function mergeRows(rows: ResourceRequestRow[]): ResourceRequestRow[] {
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.value, (m.get(r.value) ?? 0) + r.count);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count }));
}

function requestRows(agg: any, convert: (key: number) => number): ResourceRequestRow[] {
  const buckets: any[] = agg?.buckets ?? [];
  return mergeRows(
    buckets
      .map((b) => ({ raw: num(b.key), count: num(b.doc_count) }))
      // lib/analytics.ts discards falsy requests before counting.
      .filter((b) => b.raw > 0)
      .map((b) => ({ value: convert(b.raw), count: b.count })),
  );
}

function summaryFrom(
  label: string,
  stats: any,
  pcts: any,
  percentage = false,
): NumberSummary {
  const count = num(stats?.count);
  if (count < 2) {
    return { label, min: 0, q1: 0, median: 0, q3: 0, max: 0, stdDev: 0, hasData: false, percentage };
  }
  return {
    label,
    min: num(stats.min),
    // FIDELITY: statistics.quantiles(..., method="exclusive") in the CSV code vs
    // tdigest linear interpolation here. The gap is <1% at cluster scale.
    q1: pct(pcts, 25),
    median: pct(pcts, 50),
    q3: pct(pcts, 75),
    max: num(stats.max),
    stdDev: sampleStdDev(num(stats.std_deviation), count),
    hasData: true,
    percentage,
  };
}

// ---------------------------------------------------------------------------
// 8. Transforms: ES responses -> the view models the components already consume
// ---------------------------------------------------------------------------

export function toDashboardData(overview: any): DashboardData {
  const counts = Object.fromEntries(JOB_STATES.map((s) => [s, 0])) as Record<JobState, number>;
  for (const b of overview?.aggregations?.job_status?.buckets ?? []) {
    const status = num(b.key, -1);
    if (Number.isInteger(status) && status >= 1 && status <= JOB_STATES.length) {
      counts[JOB_STATES[status - 1]] += num(b.doc_count);
    }
  }
  const totalJobs = Object.values(counts).reduce((a, b) => a + b, 0);
  return { totalJobs, counts };
}

/** Pull the phase-1 values that phase 2 needs as inputs. */
export function derivePhase1(overview: any, options: AnalysisOptions = {}): Phase1Derived {
  const o = withDefaults(options);
  const runtime = overview?.aggregations?.runtime;
  const edgesAgg = runtime?.edges;

  const raw: number[] = [];
  for (let i = 0; i <= o.histogramBins; i++) raw.push(pct(edgesAgg, (100 * i) / o.histogramBins));

  // tdigest is approximate; clamp to non-decreasing so range aggs stay valid.
  const runtimeEdges: number[] = [];
  let prev = -Infinity;
  for (const e of raw) {
    const v = Math.max(e, prev);
    runtimeEdges.push(v);
    prev = v;
  }

  return {
    runtimeEdges,
    runtimeP95: pct(edgesAgg, 95),
    maxProcId: Math.max(0, Math.trunc(num(runtime?.max_proc?.value))),
    memUsedMax: num(overview?.aggregations?.mem_used_stats?.max),
    diskUsedMax: num(overview?.aggregations?.disk_used_stats?.max),
  };
}

export function toHistogramData(
  overview: any,
  refine: any,
  scope: ClusterScope,
  options: AnalysisOptions = {},
): HistogramData | null {
  const o = withDefaults(options);
  const runtime = overview?.aggregations?.runtime;
  const totalRuntimeJobs = num(runtime?.doc_count);
  if (totalRuntimeJobs === 0) return null;

  const edges = derivePhase1(overview, options).runtimeEdges;
  const binAggs = refine?.aggregations?.runtime?.bins?.buckets ?? {};

  const bins: HistogramBin[] = [];
  let fastJobCount = 0;

  for (let i = 0; i < o.histogramBins; i++) {
    const bucket = binAggs[String(i)] ?? {};
    const count = num(bucket.doc_count);
    const med = count > 0 ? pct(bucket.median, 50) : 0;
    const isFast = med < FAST_JOB_THRESHOLD;
    if (isFast) fastJobCount += count;
    bins.push({
      pctStart: Math.trunc((100 * i) / o.histogramBins),
      pctEnd: Math.trunc((100 * (i + 1)) / o.histogramBins),
      left: edges[i],
      right: edges[i + 1],
      count,
      median: med,
      isFast,
    });
  }

  return {
    clusterId: String(scope.clusterId ?? ""),
    totalRuntimeJobs,
    bins,
    fastJobCount,
    firstSubmitted: toEpochSeconds(runtime?.first_submitted?.value),
    lastCompleted: toEpochSeconds(runtime?.last_completed?.value),
  };
}

export function toScatterData(
  overview: any,
  refine: any,
  sample: any | null,
  options: AnalysisOptions = {},
): ScatterData | null {
  const o = withDefaults(options);
  const runtime = overview?.aggregations?.runtime;
  const totalJobs = num(runtime?.doc_count);
  if (totalJobs === 0) return null;

  const maxRuntime = pct(runtime?.edges, 95);
  const median = pct(runtime?.edges, 50);
  const maxIndex = Math.max(0, Math.trunc(num(runtime?.max_proc?.value)));

  // matrix_stats gives the exact Pearson r over every job in scope.
  const xField = (runtime?.xy?.fields ?? []).find((f: any) => f.name === FIELDS.procId);
  const correlation = num(xField?.correlation?.[FIELDS.wallClock]);

  let points: { x: number; y: number }[] = [];
  if (o.scatterMode === "sample" && sample) {
    points = (sample.hits?.hits ?? []).map((h: any) => ({
      x: num(h.fields?.[FIELDS.procId]?.[0]),
      y: Math.min(num(h.fields?.[FIELDS.wallClock]?.[0]), maxRuntime),
    }));
    points.sort((a, b) => a.x - b.x);
  } else {
    // Binned fallback: one point per ProcId bucket at that bucket's median.
    points = (refine?.aggregations?.runtime?.by_proc?.buckets ?? []).map((b: any) => ({
      x: num(b.key),
      y: Math.min(pct(b.spread, 50), maxRuntime),
    }));
  }

  let trend: ScatterData["trend"] = "consistent";
  if (correlation > 0.4) trend = "longer";
  else if (correlation < -0.4) trend = "faster";

  return {
    points,
    maxIndex,
    maxRuntime,
    median,
    correlation,
    trend,
    outliers: num(refine?.aggregations?.runtime?.outliers?.doc_count),
    totalJobs,
  };
}

/** normalizeReason() from lib/holds.ts, applied to the distinct strings ES returned. */
function normalizeReason(raw: string): string {
  let reason = raw.split(". ")[0];
  if (reason.includes("Error from") && reason.includes(": ")) {
    reason = reason.slice(reason.indexOf(": ") + 2);
  }
  return reason;
}

interface ReasonTerm {
  reason: string;
  count: number;
  subCode: number;
  /** Mean EnteredCurrentStatus for the jobs behind this string. */
  avgEntered: number | null;
}

/**
 * Fuzzy-group distinct reason strings, weighting by their document counts. Same
 * difflib ratio and greedy first-match ordering as bucketReasons() in
 * lib/holds.ts — it just runs over ~10² strings instead of ~10⁶ jobs.
 */
function bucketReasonTerms(terms: ReasonTerm[], threshold: number): ReasonTerm[][] {
  const buckets: ReasonTerm[][] = [];
  for (const item of terms) {
    let placed = false;
    for (const bucket of buckets) {
      if (sequenceMatcherRatio(item.reason, bucket[0].reason) >= threshold) {
        bucket.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) buckets.push([item]);
  }
  return buckets;
}

export function toHoldData(
  overview: any,
  options: AnalysisOptions = {},
): { holds: HoldData; warnings: string[] } {
  const o = withDefaults(options);
  const warnings: string[] = [];
  const holdsAgg = overview?.aggregations?.holds;
  const heldCount = num(holdsAgg?.doc_count);

  if (heldCount === 0) {
    return { holds: { heldCount: 0, buckets: [], legend: [], timeStats: null }, warnings };
  }

  const nowSec = o.now.getTime() / 1000;
  const buckets: HoldBucket[] = [];
  const seenCodes = new Set<number>();

  for (const codeBucket of holdsAgg?.by_code?.buckets ?? []) {
    const code = num(codeBucket.key);
    seenCodes.add(code);
    const label = HOLD_REASON_CODES[code]?.label ?? `Code ${code}`;

    const dropped = num(codeBucket.by_reason?.sum_other_doc_count);
    if (dropped > 0) {
      warnings.push(
        `Hold code ${code}: ${dropped} job(s) fall outside the top ${o.holdReasonTermsSize} ` +
          `distinct HoldReason strings (${num(codeBucket.distinct_reasons?.value)} distinct total). ` +
          `Raise holdReasonTermsSize for a complete breakdown.`,
      );
    }

    const terms: ReasonTerm[] = (codeBucket.by_reason?.buckets ?? []).map((rb: any) => ({
      reason: normalizeReason(String(rb.key ?? "")),
      count: num(rb.doc_count),
      subCode: num(rb.sub_code?.buckets?.[0]?.key),
      avgEntered: toEpochSeconds(rb.avg_entered?.value),
    }));

    for (const group of bucketReasonTerms(terms, o.holdReasonThreshold)) {
      const count = group.reduce((a, t) => a + t.count, 0);
      // Weighted mean of the per-string means == mean over the underlying jobs.
      let weight = 0;
      let weighted = 0;
      for (const t of group) {
        if (t.avgEntered !== null) {
          weighted += t.avgEntered * t.count;
          weight += t.count;
        }
      }
      const avgEntered = weight > 0 ? weighted / weight : null;
      const avgHoldSeconds = avgEntered === null ? null : nowSec - avgEntered;

      buckets.push({
        code,
        label,
        subCode: group[0].subCode,
        count,
        percent: (count / heldCount) * 100,
        exampleReason: group[0].reason,
        avgHoldSeconds,
        avgHoldLabel: avgHoldSeconds === null ? "N/A" : formatDuration(avgHoldSeconds),
        // Per-job ProcIds are exactly the data we are avoiding fetching. Nothing
        // in the UI renders them; query them on demand if you add a drill-down.
        procIds: [],
      });
    }
  }

  buckets.sort((a, b) => b.count - a.count);

  const legend = [...seenCodes]
    .sort((a, b) => a - b)
    .map((code) => ({
      code,
      label: HOLD_REASON_CODES[code]?.label ?? "Unknown",
      reason: HOLD_REASON_CODES[code]?.reason ?? "No description available.",
    }));

  const firstHeld = toEpochSeconds(holdsAgg?.first_held?.value);
  const lastHeld = toEpochSeconds(holdsAgg?.last_held?.value);
  const avgHeld = toEpochSeconds(holdsAgg?.avg_held?.value);

  const timeStats =
    firstHeld !== null && lastHeld !== null && avgHeld !== null
      ? {
          firstHeld,
          lastHeld,
          durationHours: (lastHeld - firstHeld) / 3600,
          avgHoldDuration: nowSec - avgHeld,
        }
      : null;

  return { holds: { heldCount, buckets, legend, timeStats }, warnings };
}

function distributionBins(agg: any): { bins: UsageDistributionBin[]; unit: string } {
  const keyed = agg?.buckets ?? {};
  const entries = Object.entries(keyed) as [string, any][];
  const total = entries.reduce((a, [, b]) => a + num(b.doc_count), 0);
  const bins = entries.map(([label, b]) => {
    const count = num(b.doc_count);
    return { label, count, pct: total ? (count / total) * 100 : 0 };
  });
  return { bins, unit: "GiB" };
}

export function toAnalyticsData(
  overview: any,
  refine: any,
  scope: ClusterScope,
  options: AnalysisOptions = {},
): { analytics: AnalyticsData; warnings: string[] } {
  const o = withDefaults(options);
  const a = overview?.aggregations ?? {};
  const warnings: string[] = [];

  const totalJobs = num(overview?.hits?.total?.value ?? overview?.hits?.total);
  const avgRuntime = num(a.runtime_avg?.value);
  const avgRuntimeHours = avgRuntime ? avgRuntime / 3600 : 1.0;

  for (const [name, agg, distinct] of [
    ["Memory", a.req_memory, a.req_memory_distinct],
    ["Disk", a.req_disk, a.req_disk_distinct],
  ] as const) {
    const dropped = num(agg?.sum_other_doc_count);
    if (dropped > 0) {
      warnings.push(
        `${name} request table: showing the ${o.requestTermsSize} most common of ` +
          `${num(distinct?.value)} distinct values (${dropped} job(s) not shown).`,
      );
    }
  }

  const memUsedCount = num(a.mem_used_stats?.count);
  const diskUsedCount = num(a.disk_used_stats?.count);
  const cpuEffCount = num(a.cpu_eff_stats?.count);

  const memEfficiency = pct(a.mem_eff_median, 50);
  const diskEfficiency = pct(a.disk_eff_median, 50);
  const cpuEfficiency = pct(a.cpu_eff_pcts, 50);

  // Savings recommendations — same thresholds and formulas as lib/analytics.ts.
  const savings: SavingsRec[] = [];

  const memReqMedian = pct(a.mem_req_median, 50);
  if (memReqMedian > 0 && memUsedCount > 0) {
    const recommended = pct(a.mem_used_pcts, 95) * 1.1;
    if (recommended < memReqMedian * 0.8) {
      savings.push({
        resource: "memory",
        current: memReqMedian,
        recommended,
        savingsGibHours: (memReqMedian - recommended) * memUsedCount * avgRuntimeHours,
        reductionPct: ((memReqMedian - recommended) / memReqMedian) * 100,
        jobsAffected: memUsedCount,
      });
    }
  }

  const diskReqMedian = pct(a.disk_req_median, 50);
  if (diskReqMedian > 0 && diskUsedCount > 0) {
    const recommended = pct(a.disk_used_pcts, 95) * 1.2;
    if (recommended < diskReqMedian * 0.8) {
      savings.push({
        resource: "disk",
        current: diskReqMedian,
        recommended,
        savingsGibHours: (diskReqMedian - recommended) * diskUsedCount * avgRuntimeHours,
        reductionPct: ((diskReqMedian - recommended) / diskReqMedian) * 100,
        jobsAffected: diskUsedCount,
      });
    }
  }

  const cpuReqMedian = pct(a.cpu_req?.median, 50);
  if (cpuReqMedian > 0 && cpuEffCount > 0 && cpuEfficiency < 50) {
    savings.push({
      resource: "cpu",
      current: cpuReqMedian,
      recommended: Math.max(1, Math.trunc(cpuReqMedian * (cpuEfficiency / 100) * 1.2)),
      currentEfficiency: cpuEfficiency,
      jobsAffected: cpuEffCount,
    });
  }

  const mem = distributionBins(refine?.aggregations?.mem_distribution);
  const disk = distributionBins(refine?.aggregations?.disk_distribution);

  return {
    analytics: {
      clusterId: String(scope.clusterId ?? ""),
      totalJobs,
      avgRuntime,
      avgRuntimeLabel: avgRuntime ? formatTimedelta(avgRuntime) : "N/A",
      memRequested: requestRows(a.req_memory, (k) => round2(k / MIB_PER_GIB)),
      diskRequested: requestRows(a.req_disk, (k) => round2(k / KIB_PER_GIB)),
      cpuRequested: requestRows(a.req_cpus, Math.trunc),
      gpuRequested: requestRows(a.req_gpus, Math.trunc),
      memEfficiency,
      diskEfficiency,
      cpuEfficiency,
      summaries: [
        summaryFrom("Memory Used (GiB)", a.mem_used_stats, a.mem_used_pcts),
        summaryFrom("Disk Used (GiB)", a.disk_used_stats, a.disk_used_pcts),
        summaryFrom("CPU Usage (%)", a.cpu_eff_stats, a.cpu_eff_pcts, true),
      ],
      memDistribution: mem.bins,
      memDistributionUnit: mem.unit,
      diskDistribution: disk.bins,
      diskDistributionUnit: disk.unit,
      savings,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 9. Transport + orchestration
// ---------------------------------------------------------------------------

async function esSearch(cfg: EsConfig, body: EsQuery): Promise<any> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.username !== undefined) {
    headers.Authorization = `Basic ${btoa(`${cfg.username}:${cfg.password ?? ""}`)}`;
  }
  const res = await doFetch(`${cfg.host}/${cfg.index}/_search`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Elasticsearch search failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface ClusterAnalysis {
  dashboard: DashboardData;
  histogram: HistogramData | null;
  scatter: ScatterData | null;
  holds: HoldData;
  analytics: AnalyticsData;
  /** Truncation / fidelity notices worth surfacing in the UI. */
  warnings: string[];
  meta: {
    requests: number;
    tookMs: number;
    /** Documents transferred — 0 unless scatterMode is "sample". */
    documentsFetched: number;
  };
}

/**
 * Drop-in replacement for the `analysis` memo in ClusterAnalyzer.tsx:
 *
 *   const analysis = await fetchClusterAnalysis({ clusterId }, ES);
 *   <StatusDashboard data={analysis.dashboard} />
 *   <RuntimeHistogram histogram={analysis.histogram} scatter={analysis.scatter} />
 *   <HoldClassifier data={analysis.holds} />
 *   <ResourceReport data={analysis.analytics} />
 */
export async function fetchClusterAnalysis(
  scope: ClusterScope,
  cfg: EsConfig = DEFAULT_ES,
  options: AnalysisOptions = {},
): Promise<ClusterAnalysis> {
  const o = withDefaults(options);

  const overview = await esSearch(cfg, buildOverviewRequest(scope, options));
  const derived = derivePhase1(overview, options);

  // Phase 2 and the scatter sample are independent; issue them together.
  const [refine, sample] = await Promise.all([
    esSearch(cfg, buildRefineRequest(scope, derived, options)),
    o.scatterMode === "sample"
      ? esSearch(cfg, buildScatterSampleRequest(scope, options))
      : Promise.resolve(null),
  ]);

  const holdResult = toHoldData(overview, options);
  const analyticsResult = toAnalyticsData(overview, refine, scope, options);

  return {
    dashboard: toDashboardData(overview),
    histogram: toHistogramData(overview, refine, scope, options),
    scatter: toScatterData(overview, refine, sample, options),
    holds: holdResult.holds,
    analytics: analyticsResult.analytics,
    warnings: [...holdResult.warnings, ...analyticsResult.warnings],
    meta: {
      requests: sample ? 3 : 2,
      tookMs: num(overview?.took) + num(refine?.took) + num(sample?.took),
      documentsFetched: sample?.hits?.hits?.length ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 10. Mapping discovery — run this first
// ---------------------------------------------------------------------------

/**
 * Report which of the attributes above exist in the index pattern and how they
 * are mapped. Two things to check before trusting the defaults:
 *   - the numeric attributes are `long`/`double`, not `keyword` (the painless
 *     scripts read doc values as numbers and will throw on keyword mappings);
 *   - HoldReason has an aggregatable form — either a `.keyword` subfield or a
 *     bare `keyword` mapping. Adjust FIELDS.holdReasonKeyword accordingly.
 */
export async function describeFields(
  cfg: EsConfig = DEFAULT_ES,
): Promise<Record<string, { types: string[]; aggregatable: boolean } | null>> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const names = [
    ...new Set(
      Object.values(FIELDS)
        .flatMap((v) => (Array.isArray(v) ? [...v] : [v]))
        .flatMap((n) => [n, n.endsWith(KEYWORD_SUFFIX) ? n.slice(0, -KEYWORD_SUFFIX.length) : n]),
    ),
  ];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.username !== undefined) {
    headers.Authorization = `Basic ${btoa(`${cfg.username}:${cfg.password ?? ""}`)}`;
  }
  const res = await doFetch(`${cfg.host}/${cfg.index}/_field_caps?fields=${names.join(",")}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    throw new Error(`Elasticsearch _field_caps failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();

  const out: Record<string, { types: string[]; aggregatable: boolean } | null> = {};
  for (const name of names) {
    const caps = body?.fields?.[name];
    out[name] = caps
      ? {
          types: Object.keys(caps),
          aggregatable: Object.values(caps).some((c: any) => c?.aggregatable),
        }
      : null;
  }
  return out;
}
