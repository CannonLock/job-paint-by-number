// URL-linkable view state for the stacked-bar page. Same contract as the Sankey
// page's helper (replaceState, default clears the param) but deliberately its own
// copy: this route does not reach into the Sankey page's files.

import { ALL_CLUSTERS } from "./binModel";

export const CLUSTER_PARAM = "clusterId";

export function writeClusterParam(next: string): void {
  const url = new URL(window.location.href);
  if (next === ALL_CLUSTERS) url.searchParams.delete(CLUSTER_PARAM);
  else url.searchParams.set(CLUSTER_PARAM, next);
  window.history.replaceState(null, "", url);
}
