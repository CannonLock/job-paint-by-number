// The one piece of view state that lives in the URL: the selected cluster.
//
// Written with replaceState rather than pushState on purpose -- the filter is
// view state, and a back button that steps through every dropdown change would
// be noise. "All clusters" is the default, so it clears the param instead of
// pinning it. view.tsx reads the param back once on mount.

import { ALL_CLUSTERS } from "./dayModel";

export const CLUSTER_PARAM = "clusterId";

export function writeClusterParam(next: string): void {
  const url = new URL(window.location.href);
  if (next === ALL_CLUSTERS) url.searchParams.delete(CLUSTER_PARAM);
  else url.searchParams.set(CLUSTER_PARAM, next);
  window.history.replaceState(null, "", url);
}
