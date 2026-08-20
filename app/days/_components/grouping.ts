// How the page divides this owner's jobs up.
//
// Two groupings, and they are not alternatives to each other so much as different
// questions. A cluster is one submission -- what did this run do. A batch name is
// whatever the submitter chose to call a set of runs, so it usually spans several
// clusters -- what did this piece of work do, across all the runs it took.
//
// Everything downstream filters on cluster labels, because that is the grain the
// bake aggregates at: one batch is exactly the sum of its clusters. A job belongs
// to exactly one cluster, so summing per-cluster figures into a batch stays exact,
// distinct-job counts included -- nothing here is apportioned or estimated. The
// bake verifies the assumption behind that (see resolveClusterBatches in
// scripts/batch-labels.mjs) and reports any cluster whose own jobs disagree about
// their batch name.

export type GroupBy = "cluster" | "batch";

/** Selection value meaning "do not filter at all". */
export const ALL_GROUPS = "all";

/** A batch group as the bake publishes it. */
export interface BatchInfo {
  /** Stable key; a label under anonymization, the raw name when disabled. */
  id: string;
  /** What the reader sees. */
  name: string;
  /** Jobs across every cluster in the batch. */
  total: number;
  /** Cluster labels making up this batch. */
  clusters: number[];
}

/** The minimum a grouping needs to know about a cluster. */
export interface ClusterLike {
  cluster: number;
  total: number;
  /** Batch this cluster belongs to. Absent on data baked before batches existed. */
  batch?: string;
}

/** One entry in the group picker. */
export interface GroupOption {
  id: string;
  label: string;
  total: number;
}

/**
 * Cluster labels a selection covers, as strings to match the baked rows. Null
 * means "everything", which is cheaper than materialising every label and lets
 * callers skip filtering altogether.
 */
export type ClusterFilter = Set<string> | null;

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  cluster: "Cluster",
  batch: "Batch name",
};

/**
 * True when the baked data can actually group by batch. Data baked before batch
 * support carries no `batches`, and there is nothing to offer if every job landed
 * in a single batch either -- a picker with one option is just noise.
 */
export function canGroupByBatch(batches: BatchInfo[] | undefined): batches is BatchInfo[] {
  return !!batches && batches.length > 1;
}

/** The picker's options for one grouping, largest group first. */
export function groupOptions(
  clusters: ClusterLike[],
  batches: BatchInfo[] | undefined,
  groupBy: GroupBy,
): GroupOption[] {
  if (groupBy === "batch") {
    return (batches ?? []).map((batch) => ({
      id: batch.id,
      label: batch.name,
      total: batch.total,
    }));
  }
  return clusters.map((entry) => ({
    id: String(entry.cluster),
    label: `Cluster ${entry.cluster}`,
    total: entry.total,
  }));
}

/**
 * Resolve a selection to the cluster labels it covers.
 *
 * An unknown id -- a stale deep link, a batch that dropped out of the rolling
 * window -- resolves to null rather than to an empty set, so the page falls back
 * to showing everything instead of going silently blank.
 */
export function clusterFilterFor(
  clusters: ClusterLike[],
  batches: BatchInfo[] | undefined,
  groupBy: GroupBy,
  selection: string,
): ClusterFilter {
  if (selection === ALL_GROUPS) return null;
  if (groupBy === "batch") {
    const batch = (batches ?? []).find((b) => b.id === selection);
    return batch ? new Set(batch.clusters.map(String)) : null;
  }
  return clusters.some((c) => String(c.cluster) === selection) ? new Set([selection]) : null;
}

/** True when a baked row belongs to the selection. */
export function inFilter(filter: ClusterFilter, cluster: number | string): boolean {
  return !filter || filter.has(String(cluster));
}

/** How the page describes the current selection in prose. */
export function selectionLabel(
  options: GroupOption[],
  groupBy: GroupBy,
  selection: string,
): string {
  if (selection === ALL_GROUPS) return groupBy === "batch" ? "all batches" : "all clusters";
  const found = options.find((o) => o.id === selection);
  return found ? found.label.toLowerCase() : "all clusters";
}
