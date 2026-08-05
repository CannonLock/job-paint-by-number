import { formatDuration } from "./format";
import { arrayMax, arrayMin, sequenceMatcherRatio } from "./stats";
import type { HoldBucket, HoldData, JobRecord } from "./types";

/** Mapping of HoldReasonCode -> label/reason. Ported from hold_bucket.HOLD_REASON_CODES. */
export const HOLD_REASON_CODES: Record<number, { label: string; reason: string }> = {
  1: { label: "UserRequest", reason: "The user put the job on hold with condor_hold." },
  3: { label: "JobPolicy", reason: "The PERIODIC_HOLD expression evaluated to True. Or, ON_EXIT_HOLD was true." },
  4: { label: "CorruptedCredential", reason: "The credentials for the job are invalid." },
  5: { label: "JobPolicyUndefined", reason: "A job policy expression evaluated to Undefined." },
  6: { label: "FailedToCreateProcess", reason: "The condor_starter failed to start the executable." },
  7: { label: "UnableToOpenOutput", reason: "The standard output file for the job could not be opened." },
  8: { label: "UnableToOpenInput", reason: "The standard input file for the job could not be opened." },
  9: { label: "UnableToOpenOutputStream", reason: "The standard output stream for the job could not be opened." },
  10: { label: "UnableToOpenInputStream", reason: "The standard input stream for the job could not be opened." },
  11: { label: "InvalidTransferAck", reason: "An internal HTCondor protocol error was encountered when transferring files." },
  12: { label: "TransferOutputError", reason: "An error occurred while transferring job output files or self-checkpoint files." },
  13: { label: "TransferInputError", reason: "An error occurred while transferring job input files." },
  14: { label: "IwdError", reason: "The initial working directory of the job cannot be accessed." },
  15: { label: "SubmittedOnHold", reason: "The user requested the job be submitted on hold." },
  16: { label: "SpoolingInput", reason: "Input files are being spooled." },
  17: { label: "JobShadowMismatch", reason: "A standard universe job is not compatible with the condor_shadow version available on the submitting machine." },
  18: { label: "InvalidTransferGoAhead", reason: "An internal HTCondor protocol error was encountered when transferring files." },
  19: { label: "HookPrepareJobFailure", reason: "<Keyword>_HOOK_PREPARE_JOB was defined but could not be executed or returned failure." },
  20: { label: "MissedDeferredExecutionTime", reason: "The job missed its deferred execution time and therefore failed to run." },
  21: { label: "StartdHeldJob", reason: "The job was put on hold because WANT_HOLD in the machine policy was true." },
  22: { label: "UnableToInitUserLog", reason: "Unable to initialize job event log." },
  23: { label: "FailedToAccessUserAccount", reason: "Failed to access user account." },
  24: { label: "NoCompatibleShadow", reason: "No compatible shadow." },
  25: { label: "InvalidCronSettings", reason: "Invalid cron settings." },
  26: { label: "SystemPolicy", reason: "SYSTEM_PERIODIC_HOLD evaluated to true." },
  27: { label: "SystemPolicyUndefined", reason: "The system periodic job policy evaluated to undefined." },
  32: { label: "MaxTransferInputSizeExceeded", reason: "The maximum total input file transfer size was exceeded." },
  33: { label: "MaxTransferOutputSizeExceeded", reason: "The maximum total output file transfer size was exceeded." },
  34: { label: "JobOutOfResources", reason: "Memory usage exceeds a memory limit." },
  35: { label: "InvalidDockerImage", reason: "Specified Docker image was invalid." },
  36: { label: "FailedToCheckpoint", reason: "Job failed when sent the checkpoint signal it requested." },
  43: { label: "PreScriptFailed", reason: "Pre script failed." },
  44: { label: "PostScriptFailed", reason: "Post script failed." },
  45: { label: "SingularityTestFailed", reason: "Test of singularity runtime failed before launching a job" },
  46: { label: "JobDurationExceeded", reason: "The job's allowed duration was exceeded." },
  47: { label: "JobExecuteExceeded", reason: "The job's allowed execution time was exceeded." },
  48: { label: "HookShadowPrepareJobFailure", reason: "Prepare job shadow hook failed when it was executed; status code indicated job should be held." },
};

type ReasonTuple = { reason: string; subCode: number; procId: number; holdTime: number };

/** Port of hold_bucket.bucket_reasons_with_data using difflib-style fuzzy matching. */
function bucketReasons(reasonData: ReasonTuple[], threshold: number): ReasonTuple[][] {
  const buckets: ReasonTuple[][] = [];
  for (const item of reasonData) {
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

/** Normalize a HoldReason string the same way group_by_code does. */
function normalizeReason(raw: string): string {
  let reason = raw.split(". ")[0];
  if (reason.includes("Error from") && reason.includes(": ")) {
    const idx = reason.indexOf(": ");
    reason = reason.slice(idx + 2);
  }
  return reason;
}

/**
 * Port of hold_bucket. Reads held jobs (JobStatus == 5) from the CSV when hold
 * columns are present, groups them by HoldReasonCode and fuzzy reason matching.
 * `now` injectable for deterministic hold-duration math.
 */
export function computeHolds(
  jobs: JobRecord[],
  threshold = 0.7,
  now: Date = new Date(),
): HoldData {
  const reasonsByCode = new Map<number, ReasonTuple[]>();

  for (const job of jobs) {
    if (job["JobStatus"] !== "5") continue;
    const code = parseInt(job["HoldReasonCode"] ?? "", 10);
    if (!Number.isInteger(code)) continue;
    const subCode = parseInt(job["HoldReasonSubCode"] ?? "0", 10) || 0;
    const procId = parseInt(job["ProcId"] ?? "0", 10) || 0;
    const holdTime = parseInt(job["EnteredCurrentStatus"] ?? "0", 10) || 0;
    const reason = normalizeReason(job["HoldReason"] ?? "");
    if (!reasonsByCode.has(code)) reasonsByCode.set(code, []);
    reasonsByCode.get(code)!.push({ reason, subCode, procId, holdTime });
  }

  const heldCount = [...reasonsByCode.values()].reduce((a, v) => a + v.length, 0);

  if (heldCount === 0) {
    return { heldCount: 0, buckets: [], legend: [], timeStats: null };
  }

  const nowSec = now.getTime() / 1000;
  const buckets: HoldBucket[] = [];
  const seenCodes = new Set<number>();

  for (const [code, pairs] of reasonsByCode) {
    seenCodes.add(code);
    const label = HOLD_REASON_CODES[code]?.label ?? `Code ${code}`;
    for (const bucket of bucketReasons(pairs, threshold)) {
      const first = bucket[0];
      const percent = (bucket.length / heldCount) * 100;
      const durations = bucket.filter((b) => b.holdTime > 0).map((b) => nowSec - b.holdTime);
      const avgHoldSeconds = durations.length
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;
      buckets.push({
        code,
        label,
        subCode: first.subCode,
        count: bucket.length,
        percent,
        exampleReason: first.reason,
        avgHoldSeconds,
        avgHoldLabel: avgHoldSeconds === null ? "N/A" : formatDuration(avgHoldSeconds),
        procIds: bucket.map((b) => b.procId),
      });
    }
  }

  buckets.sort((a, b) => b.count - a.count); // default --sort-by count

  const legend = [...seenCodes]
    .sort((a, b) => a - b)
    .map((code) => ({
      code,
      label: HOLD_REASON_CODES[code]?.label ?? "Unknown",
      reason: HOLD_REASON_CODES[code]?.reason ?? "No description available.",
    }));

  // Time analysis
  const allTimes: number[] = [];
  for (const pairs of reasonsByCode.values()) {
    for (const p of pairs) if (p.holdTime > 0) allTimes.push(p.holdTime);
  }
  let timeStats: HoldData["timeStats"] = null;
  if (allTimes.length) {
    const earliest = arrayMin(allTimes);
    const latest = arrayMax(allTimes);
    const avg = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;
    timeStats = {
      firstHeld: earliest,
      lastHeld: latest,
      durationHours: (latest - earliest) / 3600,
      avgHoldDuration: nowSec - avg,
    };
  }

  return { heldCount, buckets, legend, timeStats };
}
