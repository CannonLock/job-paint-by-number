// Colors for the three-state stacked bars.
//
// Deliberately the same hex values as app/sankey/_components/palette.ts (which the
// dataviz checker validated as a set) so a cluster reads identically across both
// pages -- but copied rather than imported: this route must not reach into the
// Sankey page's files, and the two palettes are allowed to evolve separately.
// Active takes the Sankey's running indigo: on this page a job is Active from the
// moment it is placed, so the old Placed amber has no state to represent.

import type { BarState } from "../types";

/**
 * The chart draws one more distinction than the baked three states carry: the
 * Active share of a bin splits into jobs placed in that very bin ("Became
 * Active") and jobs carried in from earlier bins ("Active"). Display-only -- the
 * waffle and the cohort rows stay three-state.
 */
export type SegmentState = BarState | "becameActive";

export interface BarStateStyle {
  key: SegmentState;
  label: string;
  color: string;
  /**
   * Stroke color for the glyph drawn on top of `color` in the waffle. All are
   * dark enough to take white ink (the amber that needed dark ink is gone).
   */
  glyphInk: string;
  /** Phrasing for tooltips and captions. */
  description: string;
}

export const BAR_STATE_ORDER: BarState[] = ["active", "completed", "removed"];

/**
 * Bottom-up stacking order for the bar segments: the carried base first, new
 * arrivals directly on top of it, then the terminations.
 */
export const BAR_SEGMENT_ORDER: SegmentState[] = [
  "active",
  "becameActive",
  "completed",
  "removed",
];

/**
 * Glyph path in a 10x10 viewBox, stroked. Same shapes as the Sankey page's waffle
 * where the state survives: a chevron for in-flight, a check for done, a cross for
 * gone. The dash (waiting) has no state to mark any more.
 */
export const BAR_STATE_GLYPH: Record<BarState, string> = {
  active: "M4.2 3.3L6.3 5 4.2 6.7",
  completed: "M3.2 5.1l1.4 1.4 2.4-2.9",
  removed: "M3.6 3.6l2.8 2.8M6.4 3.6l-2.8 2.8",
};

/**
 * The three-state styles the waffle, cohort rows, and labels use. Here "Active"
 * means every active job, so it keeps the strong indigo.
 */
export const BAR_STATE_STYLES: Record<BarState, BarStateStyle> = {
  active: {
    key: "active",
    label: "Active",
    color: "#3b5bdb",
    glyphInk: "rgba(255,255,255,0.95)",
    description: "placed and not yet finished",
  },
  completed: {
    key: "completed",
    label: "Completed",
    color: "#2a9d8f",
    glyphInk: "rgba(255,255,255,0.95)",
    description: "finished successfully today",
  },
  removed: {
    key: "removed",
    label: "Removed",
    color: "#ae2012",
    glyphInk: "rgba(255,255,255,0.95)",
    description: "removed from the queue today",
  },
};

/**
 * The chart-segment styles. New placements are the signal ("placed = blue bar"),
 * so Became Active keeps the saturated indigo and the carried base takes the
 * Sankey page's carried-active light indigo -- a pairing that palette already
 * validated against the teal and red.
 */
export const SEGMENT_STYLES: Record<SegmentState, BarStateStyle> = {
  ...BAR_STATE_STYLES,
  active: {
    ...BAR_STATE_STYLES.active,
    color: "#8ea3e8",
    description: "active since an earlier bin",
  },
  becameActive: {
    key: "becameActive",
    label: "Became Active",
    color: "#3b5bdb",
    glyphInk: "rgba(255,255,255,0.95)",
    description: "placed in this 4-hour bin",
  },
};

/**
 * Order the waffle paints its boxes in, top-left to bottom-right. Completed leads
 * so a mostly-finished cohort reads as a filled gauge; removed trails so failures
 * collect in one corner (same reasoning as the Sankey page's waffle).
 */
export const BAR_FILL_ORDER: readonly BarState[] = ["completed", "active", "removed"];

/**
 * The magnitude chart's segments: state CHANGES per bin, so "placed" here is the
 * event (a job entered Active), not a standing state. Colours match the
 * transition each event lands the job in.
 */
export type ActivityState = "placed" | "completed" | "removed";

export const ACTIVITY_ORDER: ActivityState[] = ["placed", "completed", "removed"];

export const ACTIVITY_STYLES: Record<ActivityState, { label: string; color: string }> = {
  placed: { label: "Placed", color: "#3b5bdb" },
  completed: { label: "Completed", color: BAR_STATE_STYLES.completed.color },
  removed: { label: "Removed", color: BAR_STATE_STYLES.removed.color },
};
