// Colors for the three-state model this page paints throughout: the Sankey at the
// top and the 4-hour bars below it share one vocabulary.
//
// Deliberately the same hex values as app/sankey/_components/palette.ts and
// app/stacked-bar/_components/palette.ts (which the dataviz checker validated as
// a set) so a cluster reads identically across all three pages -- but copied
// rather than imported: this route is self-contained.
//
// Active takes the Sankey's running indigo. There is no Placed state here: a job
// is Active from the moment it is placed, so the old Placed amber has nothing to
// represent and is gone from the page entirely.

import type { BarState } from "../types";

/**
 * The charts draw one more distinction than the three baked states carry: the
 * Active share splits into work that arrived in this very bin ("Became Active")
 * and work carried in from earlier ("Active"). Display-only -- the waffle and the
 * cohort rows stay three-state.
 */
export type SegmentState = BarState | "becameActive";

export interface BarStateStyle {
  key: SegmentState;
  label: string;
  color: string;
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
 * The three-state styles the bars, rows, and labels use. Here "Active" means every
 * active job -- queued or running -- so it keeps the strong indigo.
 */
export const BAR_STATE_STYLES: Record<BarState, BarStateStyle> = {
  active: {
    key: "active",
    label: "Active",
    color: "#3b5bdb",
    description: "placed and not yet finished",
  },
  completed: {
    key: "completed",
    label: "Completed",
    color: "#2a9d8f",
    description: "finished successfully",
  },
  removed: {
    key: "removed",
    label: "Removed",
    color: "#ae2012",
    description: "removed from the queue",
  },
};

/**
 * Carried-active light indigo: work that was already in play before the bin (or
 * the period) opened.
 *
 * Validated in the Sankey page's palette against the other five at --pairs all:
 * all gates PASS, worst CVD 11.6. Darkening the indigo instead was tried first
 * and failed -- #5a6ba8 measures only 10.2 against #3b5bdb for normal vision,
 * and #7d84c4 collides with the teal. Lightening had the room in it.
 */
export const CARRIED_ACTIVE_COLOR = "#8ea3e8";

/**
 * The chart-segment styles. New placements are the signal ("work arrived = strong
 * blue"), so Became Active keeps the saturated indigo and the carried base takes
 * the lighter one.
 */
export const SEGMENT_STYLES: Record<SegmentState, BarStateStyle> = {
  ...BAR_STATE_STYLES,
  active: {
    ...BAR_STATE_STYLES.active,
    color: CARRIED_ACTIVE_COLOR,
    description: "active since an earlier bin",
  },
  becameActive: {
    key: "becameActive",
    label: "Became Active",
    color: "#3b5bdb",
    description: "placed in this 4-hour bin",
  },
};

/**
 * Texture for the queue markers, and only for them.
 *
 * It does two jobs. It separates the queue markers from the day bars they sit
 * beside without relying on colour, which is a single channel and the first thing
 * to go under a colour-vision difference or a bad monitor. And it points: the lines
 * fall from left to right, because a queue draining is the healthy direction of
 * travel, and a run of markers that stops falling is the thing worth noticing.
 *
 * The day bars are deliberately left plain. Texturing both was tried and made the
 * calendar read as pattern rather than as data -- with thirty tiles of six bars
 * each, a texture on the bars is thirty times as much ink as a texture on the
 * markers, and it drowned the very thing it was meant to distinguish.
 *
 * Applied as an overlay on top of the segments rather than as each segment's own
 * background: a per-segment background restarts the pattern at every colour
 * boundary, so a two-tone marker would show two misaligned textures instead of one
 * continuous one.
 */
export const QUEUE_TEXTURE = {
  // 45deg, not -45deg. The angle names the gradient axis, and the stripes run
  // perpendicular to it: an axis to the top-right gives lines falling from
  // top-left to bottom-right, which is the way down. -45deg aims the axis at the
  // top-left and produces exactly the opposite hatch.
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(255,255,255,0.42) 0 1px, rgba(255,255,255,0) 1px 4px)",
} as const;

/**
 * The magnitude chart's segments: state CHANGES per bin, so "placed" here is the
 * event (a job entered Active), not a standing state.
 */
export type ActivityState = "placed" | "completed" | "removed";

export const ACTIVITY_ORDER: ActivityState[] = ["placed", "completed", "removed"];

export const ACTIVITY_STYLES: Record<ActivityState, { label: string; color: string }> = {
  placed: { label: "Placed", color: BAR_STATE_STYLES.active.color },
  completed: { label: "Completed", color: BAR_STATE_STYLES.completed.color },
  removed: { label: "Removed", color: BAR_STATE_STYLES.removed.color },
};
