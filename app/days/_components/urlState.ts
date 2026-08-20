// URL-linkable view state for this page: which cluster, and which bar scale.
//
// replaceState rather than a router push -- the site is a static export and the
// selection is a view preference, not navigation, so it should not stack history
// entries the back button has to walk through. Defaults clear their param so a
// shared link carries only what was actually changed.

import type { BarScale } from "../types";
import { ALL_GROUPS, type GroupBy } from "./grouping";

/** Which grouping is in force, and which group within it is selected. */
export const GROUP_BY_PARAM = "groupBy";
export const GROUP_PARAM = "group";
export const SCALE_PARAM = "scale";

export const DEFAULT_GROUP_BY: GroupBy = "cluster";

/**
 * Linear is the default because it is the honest one: heights are proportional,
 * so a reader who never touches the toggle is not being shown a distorted
 * picture. When linear turns out to flatten the month into slivers the page says
 * so and points at the Log button (see buildScaleAdvice) rather than quietly
 * switching scales on the reader's behalf.
 */
export const DEFAULT_SCALE: BarScale = "linear";

function write(param: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(param);
  else url.searchParams.set(param, value);
  window.history.replaceState(null, "", url);
}

/**
 * Both grouping params move together: the selected id only means anything
 * alongside the grouping it belongs to, so writing one without the other would
 * produce links that resolve to the wrong group.
 */
export function writeGroupParams(groupBy: GroupBy, selection: string): void {
  const url = new URL(window.location.href);
  if (groupBy === DEFAULT_GROUP_BY) url.searchParams.delete(GROUP_BY_PARAM);
  else url.searchParams.set(GROUP_BY_PARAM, groupBy);
  if (selection === ALL_GROUPS) url.searchParams.delete(GROUP_PARAM);
  else url.searchParams.set(GROUP_PARAM, selection);
  window.history.replaceState(null, "", url);
}

/** What a URL asks for, before the data has had a chance to reject it. */
export function readGroupParams(search: string): { groupBy: GroupBy; selection: string } {
  const params = new URLSearchParams(search);
  const groupBy = params.get(GROUP_BY_PARAM);
  return {
    groupBy: groupBy === "batch" ? "batch" : DEFAULT_GROUP_BY,
    selection: params.get(GROUP_PARAM) ?? ALL_GROUPS,
  };
}

export function writeScaleParam(next: BarScale): void {
  write(SCALE_PARAM, next === DEFAULT_SCALE ? null : next);
}

/** The scale a URL asks for, or null when it says nothing usable. */
export function readScaleParam(search: string): BarScale | null {
  const value = new URLSearchParams(search).get(SCALE_PARAM);
  return value === "linear" || value === "log" ? value : null;
}

/**
 * localStorage key recording that the reader has seen the cell guide and asked
 * not to see it again. Read in an effect rather than during render -- the page is
 * statically exported, so touching storage while rendering would not match the
 * server's HTML.
 */
export const CELL_GUIDE_KEY = "days.cellGuideDismissed";

export function readGuideDismissed(): boolean {
  try {
    return window.localStorage.getItem(CELL_GUIDE_KEY) === "1";
  } catch {
    // Private-browsing modes throw on access; showing the guide again is the
    // harmless failure.
    return false;
  }
}

export function writeGuideDismissed(dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(CELL_GUIDE_KEY, "1");
    else window.localStorage.removeItem(CELL_GUIDE_KEY);
  } catch {
    // Nothing to do: the guide simply reappears next time.
  }
}
