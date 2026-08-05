// Job-state colors for the waffle grid.
//
// Validated with the dataviz skill's checker at --pairs all (a 2D waffle lets any
// two states touch, so adjacent-only validation would be too weak):
//
//   light  #eda100,#2a78d6,#1baf7a,#d03b3b
//     lightness band PASS · chroma floor PASS · CVD all-pairs PASS (worst
//     aqua<->amber dE 9.1 protan) · normal-vision PASS (worst 22.9)
//     contrast WARN: amber 2.11 and aqua 2.74 are under 3:1 on the light surface,
//     which obligates relief -- every state is also printed as a labelled number
//     beside its swatch on each card, so color never carries meaning alone.
//
// The CHTC MUI theme is light-only, so only the light steps ship. When it gains a
// dark mode, these dark steps are already validated against surface #1a1a19 and
// pass every gate including all-pairs CVD:
//   queued #c98500 · running #3987e5 · completed #1baf7a · removed #d03b3b
//
// Note the deliberate avoidance of green-for-completed next to red-for-removed:
// #0ca30c vs #d03b3b measures dE 4.1 under deuteranopia, a hard fail. Aqua clears it.

import type { JobState } from "../types";

export interface StateStyle {
  key: JobState;
  label: string;
  color: string;
  /** Longer phrasing for the per-cohort readout. */
  description: string;
}

export const STATE_STYLES: Record<JobState, StateStyle> = {
  queued: {
    key: "queued",
    label: "Queued",
    color: "#eda100",
    description: "still waiting in the queue",
  },
  running: {
    key: "running",
    label: "Running",
    color: "#2a78d6",
    description: "executing on a machine",
  },
  completed: {
    key: "completed",
    label: "Completed",
    color: "#1baf7a",
    description: "finished on their own",
  },
  removed: {
    key: "removed",
    label: "Removed",
    color: "#d03b3b",
    description: "left the queue without finishing",
  },
};

/** Index into StateCounts. Must match the build script's STATE_* constants. */
export const STATE_ORDER: readonly JobState[] = ["queued", "running", "completed", "removed"];

/**
 * Order the waffle paints its boxes in, reading top-left to bottom-right.
 * Completed leads so that advancing the date sweeps the grid with "done" like a
 * fill gauge, pushing still-queued work toward the bottom-right; removed trails
 * so failures collect in one corner instead of speckling the grid.
 */
export const FILL_ORDER: readonly JobState[] = ["completed", "running", "queued", "removed"];

/** Unfilled cell: present so the grid keeps its 10x10 shape at any cohort size. */
export const EMPTY_BOX_COLOR = "#e6e5e1";
