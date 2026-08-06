"use client";

import { Box } from "@mui/material";

import type { StateCounts } from "../types";
import { STATE_GLYPH, STATE_STYLES } from "./palette";
import { BOX_COUNT, GRID_DIM, buildCells } from "./waffle";

interface JobGridProps {
  /** State breakdown of the cohort as of today, or null to render empty. */
  counts: StateCounts | null;
  /** Accessible summary; the grid is one image, not 100 focusable cells. */
  label?: string;
  /** Largest the grid will draw. Tiles pass something small; the dialog does not. */
  maxWidth?: number;
  /** Surface gap between boxes. 2px reads clearly; tiles need 1px to stay legible. */
  gap?: number;
  /**
   * Draw the per-state glyph inside each box. Only legible at roughly 12px and up,
   * so calendar tiles leave it off and rely on the labelled version in the dialog.
   */
  showGlyphs?: boolean;
}

/**
 * The 10x10 waffle. A cohort of any size maps onto the same grid, so days stay
 * visually comparable regardless of how many jobs each one holds.
 *
 * Cells the cohort does not reach render as nothing at all. They used to be filled
 * grey, which read as a fifth job state.
 */
export default function JobGrid({
  counts,
  label,
  maxWidth = 176,
  gap = 2,
  showGlyphs = false,
}: JobGridProps) {
  const cells = buildCells(counts);

  return (
    <Box
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${GRID_DIM}, 1fr)`,
        // Surface between fills keeps adjacent states separable, which the
        // palette's sub-3:1 amber depends on.
        gap: `${gap}px`,
        width: "100%",
        maxWidth,
        aspectRatio: "1 / 1",
      }}
    >
      {Array.from({ length: BOX_COUNT }, (_, i) => {
        const state = cells[i];
        // Unreached cells hold the grid's shape without drawing anything.
        if (!state) return <Box key={i} />;

        const style = STATE_STYLES[state];
        return (
          <Box
            key={i}
            sx={{
              borderRadius: gap > 1 ? "2px" : "1px",
              backgroundColor: style.color,
              display: showGlyphs ? "flex" : "block",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {showGlyphs && (
              <Box
                component="svg"
                viewBox="0 0 10 10"
                aria-hidden
                sx={{ width: "100%", height: "100%", display: "block" }}
              >
                <path
                  d={STATE_GLYPH[state]}
                  fill="none"
                  stroke={style.glyphInk}
                  strokeWidth={1.3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
