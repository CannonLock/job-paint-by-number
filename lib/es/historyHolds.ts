/**
 * Hold analysis for Adstash *history* records.
 *
 * `buildOverviewRequest` in ./clusterAnalysis.ts finds held jobs with
 * `JobStatus == 5 && exists(HoldReasonCode)`. That is right for a live queue,
 * where JobStatus is the job's current state, but wrong for the history index,
 * where JobStatus is the state the job *finished* in. Measured on this dataset:
 * one owner's 15-day window holds 1,513,627 docs at JobStatus 4 (Completed) and
 * 9,032 at 3 (Removed), and exactly zero at 5 -- so their filter yields an empty
 * Hold Classifier no matter how many jobs actually got held.
 *
 * A job that passed through hold and then finished is recorded with
 * `LastJobStatus == 5`, which is what this keys on instead. Same window, same
 * owner: 75 jobs.
 *
 * This lives beside clusterAnalysis.ts rather than editing it, so the vendored copy
 * stays byte-identical to upstream and can be re-synced.
 *
 * Free-text reason strings are deliberately NOT read. HoldReason routinely embeds
 * absolute paths like /home/<user>/..., which would re-identify the owner that the
 * rest of the pipeline anonymizes; only codes and counts come back.
 */

import { HOLD_REASON_CODES } from "../holds";
import type { HoldBucket, HoldData } from "../types";
import { buildScopeQuery, type ClusterScope } from "./clusterAnalysis";

/** Held-state marker in both JobStatus and LastJobStatus. */
const HELD = 5;

type EsQuery = Record<string, unknown>;

/**
 * One `size:0` request: how many jobs in scope ever went on hold, split by reason
 * code, with the timing needed for the "how long were they held" stat.
 */
export function buildHistoryHoldsRequest(scope: ClusterScope): EsQuery {
  return {
    size: 0,
    track_total_hits: true,
    query: {
      bool: {
        filter: [buildScopeQuery(scope), { term: { LastJobStatus: HELD } }],
      },
    },
    aggs: {
      first_held: { min: { field: "EnteredCurrentStatus" } },
      last_held: { max: { field: "EnteredCurrentStatus" } },
      avg_held: { avg: { field: "EnteredCurrentStatus" } },
      // HoldReasonCode survives on the terminal record for most held-then-resumed
      // jobs; those missing it collect in the -1 bucket rather than vanishing.
      by_code: {
        terms: { field: "HoldReasonCode", size: 64, missing: -1 },
        aggs: {
          sub_code: { terms: { field: "HoldReasonSubCode", size: 1 } },
          avg_entered: { avg: { field: "EnteredCurrentStatus" } },
        },
      },
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** HTCondor epochs are seconds; tolerate a `date`-mapped index returning millis. */
function toEpochSeconds(v: unknown): number | null {
  const n = num(v, NaN);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n / 1000 : n;
}

function formatHoldDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "N/A";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Shape the holds response into the same `HoldData` the HoldClassifier component
 * already consumes, so no component change is needed.
 *
 * `exampleReason` carries the code's canonical description from HOLD_REASON_CODES,
 * never a string out of the index. `procIds` stays empty, as it does upstream.
 */
export function toHistoryHoldData(response: any, now: Date = new Date()): HoldData {
  const total = num(response?.hits?.total?.value ?? response?.hits?.total);
  const codeBuckets: any[] = response?.aggregations?.by_code?.buckets ?? [];
  const heldCount = total || codeBuckets.reduce((sum, b) => sum + num(b.doc_count), 0);

  if (heldCount === 0) {
    return { heldCount: 0, buckets: [], legend: [], timeStats: null };
  }

  const nowSec = now.getTime() / 1000;
  const buckets: HoldBucket[] = [];
  const seenCodes = new Set<number>();

  for (const codeBucket of codeBuckets) {
    const code = num(codeBucket.key, -1);
    const count = num(codeBucket.doc_count);
    if (count === 0) continue;
    seenCodes.add(code);

    const known = HOLD_REASON_CODES[code];
    const avgEntered = toEpochSeconds(codeBucket.avg_entered?.value);
    const avgHoldSeconds = avgEntered === null ? null : nowSec - avgEntered;

    buckets.push({
      code,
      label: known?.label ?? (code === -1 ? "No hold code recorded" : `Code ${code}`),
      subCode: num(codeBucket.sub_code?.buckets?.[0]?.key),
      count,
      percent: (count / heldCount) * 100,
      // Canonical description, not indexed free text -- see the file header.
      exampleReason: known?.reason ?? "No description available.",
      avgHoldSeconds,
      avgHoldLabel: avgHoldSeconds === null ? "N/A" : formatHoldDuration(avgHoldSeconds),
      procIds: [],
    });
  }

  buckets.sort((a, b) => b.count - a.count);

  const legend = [...seenCodes]
    .sort((a, b) => a - b)
    .map((code) => ({
      code,
      label: HOLD_REASON_CODES[code]?.label ?? "Unknown",
      reason: HOLD_REASON_CODES[code]?.reason ?? "No description available.",
    }));

  const firstHeld = toEpochSeconds(response?.aggregations?.first_held?.value);
  const lastHeld = toEpochSeconds(response?.aggregations?.last_held?.value);
  const avgHeld = toEpochSeconds(response?.aggregations?.avg_held?.value);

  return {
    heldCount,
    buckets,
    legend,
    timeStats:
      firstHeld !== null && lastHeld !== null && avgHeld !== null
        ? {
            firstHeld,
            lastHeld,
            durationHours: (lastHeld - firstHeld) / 3600,
            avgHoldDuration: nowSec - avgHeld,
          }
        : null,
  };
}
