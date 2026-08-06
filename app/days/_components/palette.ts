// Job-state colors and glyphs for the waffle grid and Sankey.
//
// Validated with the dataviz skill's checker at --pairs all (a 2D waffle and a
// Sankey both let any two states touch, so adjacent-only validation is too weak):
//
//   #eda100,#3b5bdb,#2a9d8f,#ae2012
//     lightness band PASS · chroma floor PASS
//     CVD all-pairs PASS  - worst teal<->amber dE 15.2 (protan), tritan 11.2
//     normal-vision PASS  - worst teal<->indigo dE 23.9
//     contrast WARN       - amber is 2.11 on the light surface, under 3:1, which
//                           obligates relief: every state is also printed as a
//                           labelled number, and each box carries a glyph.
//
// The completed/removed pair was the point of this revision. The previous aqua
// (#1baf7a) against red (#d03b3b) measured dE 9.9 under deuteranopia -- above the
// skill's floor of 8 but uncomfortably close for the one distinction that matters
// most here. Teal against dark red measures 17.0, and moving Running from #2a78d6
// to indigo keeps it clear of the new teal (normal-vision dE 17.3 -> 23.9).
//
// Color is never the only channel: STATE_GLYPH gives each state a distinct shape,
// which is what makes this readable in grayscale, in print, and under any CVD.

import type { JobState } from "../types";

export interface StateStyle {
  key: JobState;
  /** User-facing name. "Placed"/"Active" rather than HTCondor's queued/running. */
  label: string;
  color: string;
  /**
   * Stroke color for the glyph drawn on top of `color`. Amber is light enough to
   * need dark ink; the rest take white.
   */
  glyphInk: string;
  /** Longer phrasing for the per-cohort readout. */
  description: string;
  /** Past-tense phrasing for "what changed today" lines. */
  transitionVerb: string;
}

/**
 * Glyph path in a 10x10 viewBox, stroked (never filled) so one render path covers
 * all four. Shapes are chosen to stay distinguishable at ~14px: a dash for waiting,
 * a chevron for in-flight, a check for done, a cross for gone.
 */
export const STATE_GLYPH: Record<JobState, string> = {
  queued: "M3.4 5h3.2",
  running: "M4.2 3.3L6.3 5 4.2 6.7",
  completed: "M3.2 5.1l1.4 1.4 2.4-2.9",
  removed: "M3.6 3.6l2.8 2.8M6.4 3.6l-2.8 2.8",
};

export const STATE_STYLES: Record<JobState, StateStyle> = {
  queued: {
    key: "queued",
    label: "Placed",
    color: "#eda100",
    glyphInk: "rgba(0,0,0,0.62)",
    description: "waiting in the queue",
    transitionVerb: "were placed",
  },
  running: {
    key: "running",
    label: "Active",
    color: "#3b5bdb",
    glyphInk: "rgba(255,255,255,0.95)",
    description: "executing on a machine",
    transitionVerb: "became active",
  },
  completed: {
    key: "completed",
    label: "Completed",
    color: "#2a9d8f",
    glyphInk: "rgba(255,255,255,0.95)",
    description: "finished on their own",
    transitionVerb: "completed",
  },
  removed: {
    key: "removed",
    label: "Removed",
    color: "#ae2012",
    glyphInk: "rgba(255,255,255,0.95)",
    description: "left the queue without finishing",
    transitionVerb: "were removed",
  },
};

/** Index into StateCounts. Must match the build script's STATE_* constants. */
export const STATE_ORDER: readonly JobState[] = ["queued", "running", "completed", "removed"];

/**
 * Order the waffle paints its boxes in, reading top-left to bottom-right.
 * Completed leads so that a mostly-finished cohort reads as a filled gauge, and
 * removed trails so failures collect in one corner instead of speckling the grid.
 */
export const FILL_ORDER: readonly JobState[] = ["completed", "running", "queued", "removed"];
