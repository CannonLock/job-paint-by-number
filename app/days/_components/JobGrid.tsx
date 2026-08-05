"use client";

import { Box } from "@mui/material";

import type { StateCounts } from "../types";
import { EMPTY_BOX_COLOR, STATE_STYLES } from "./palette";
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
  dimmed?: boolean;
}

/**
 * The 10x10 waffle. A cohort of any size maps onto the same grid, so days stay
 * visually comparable regardless of how many jobs each one holds.
 */
export default function JobGrid({
  counts,
  label,
  maxWidth = 176,
  gap = 2,
  dimmed = false,
}: JobGridProps) {
  const cells = buildCells(dimmed ? null : counts);

  return (
    <Box
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${GRID_DIM}, 1fr)`,
        // Surface between fills keeps adjacent states separable, which the
        // palette's sub-3:1 contrast warning depends on.
        gap: `${gap}px`,
        width: "100%",
        maxWidth,
        aspectRatio: "1 / 1",
        opacity: dimmed ? 0.4 : 1,
      }}
    >
      {Array.from({ length: BOX_COUNT }, (_, i) => {
        const state = cells[i];
        return (
          <Box
            key={i}
            sx={{
              borderRadius: gap > 1 ? "2px" : "1px",
              backgroundColor: state ? STATE_STYLES[state].color : EMPTY_BOX_COLOR,
            }}
          />
        );
      })}
    </Box>
  );
}
