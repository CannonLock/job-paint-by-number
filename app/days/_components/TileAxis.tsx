"use client";

import { Box, Typography } from "@mui/material";

import type { ScaleTick } from "./binModel";
import { compactNumber } from "./dayCards";
import QueueGlyph from "./QueueGlyph";

/**
 * Room an axis needs beside the calendar. "181k" at this size is about 26px; the
 * rest is the tick dash and breathing space.
 */
export const AXIS_WIDTH = 44;

/** Clearance the right-hand axis leaves for the queue marker's overhanging half. */
export const QUEUE_OVERHANG = 8;

interface TileAxisProps {
  ticks: ScaleTick[];
  /** Bar-slot height the ticks are positioned within. */
  height: number;
  /**
   * Distance from the tile's bottom edge to the floor of the bar slot. Passed in
   * rather than assumed: the caption sits below the bars, so the slot is not at
   * the tile's bottom and the axis has to be told where it is.
   */
  bottom: number;
  /** Which edge of the grid this axis hangs off. */
  side: "left" | "right";
  /** Percent mode labels a share of the cohort; count mode labels jobs. */
  unit: "count" | "percent";
  /**
   * True while a bar governed by this scale is hovered. The point of two axes is
   * that a bar answers to exactly one of them, so hovering a bar says which.
   */
  highlighted?: boolean;
  /** Marks the axis as the queue scale, matching the glyph under the queue bars. */
  glyph?: boolean;
}

/**
 * A height axis for a row of calendar tiles.
 *
 * The bars are scaled against a peak, which makes them comparable to each other
 * but says nothing about what any one height *is*. These labels supply that, once
 * per row rather than once per tile, hanging off the edge of the grid so the tiles
 * keep their full width and their bars stay centred.
 *
 * There are two, because the calendar draws two kinds of bar against two different
 * quantities: activity (changes per 4-hour window) down the left, the queue
 * (standing jobs at midnight) down the right. They cannot share a scale, so
 * pairing a bar with its own axis on hover is how the reader is told which is
 * which.
 *
 * Rendered into every tile and revealed by CSS only on the row's first or last
 * (see JobCalendar). Living inside the tile is what keeps it aligned: a column
 * beside the calendar would have to guess at row heights and at the vertical
 * offset of the bar slot within a tile, and would drift the moment either changed.
 */
export default function TileAxis({
  ticks,
  height,
  bottom,
  side,
  unit,
  highlighted = false,
  glyph = false,
}: TileAxisProps) {
  if (ticks.length === 0) return null;

  return (
    <Box
      aria-hidden
      className={side === "left" ? "day-axis" : "day-axis-right"}
      sx={{
        position: "absolute",
        // Reaches out past the tile's own edge, into the room the calendar wrapper
        // reserves for it. On the right it also has to clear the queue marker's
        // overhanging half.
        ...(side === "left"
          ? { right: "calc(100% + 6px)" }
          : { left: `calc(100% + ${QUEUE_OVERHANG + 4}px)` }),
        bottom,
        width: AXIS_WIDTH - 10,
        height,
        pointerEvents: "none",
      }}
    >
      {ticks.map((tick) => (
        <AxisTick
          key={tick.value}
          label={unit === "percent" ? `${tick.value}%` : compactNumber(tick.value)}
          fraction={tick.fraction}
          side={side}
          highlighted={highlighted}
        />
      ))}

      {glyph && (
        <Box
          sx={{
            position: "absolute",
            // Level with the row of glyphs under the queue markers themselves.
            top: "100%",
            left: 0,
            mt: "3px",
          }}
        >
          <QueueGlyph active={highlighted} />
        </Box>
      )}
    </Box>
  );
}

function AxisTick({
  label,
  fraction,
  side,
  highlighted,
}: {
  label: string;
  fraction: number;
  side: "left" | "right";
  highlighted: boolean;
}) {
  // The dash always points back at the grid, so it sits on the inner side.
  const dash = (
    <Box
      sx={{
        width: 3,
        height: "1px",
        backgroundColor: highlighted ? "primary.main" : "divider",
        flexShrink: 0,
        transition: "background-color 120ms",
      }}
    />
  );

  return (
    <Box
      sx={{
        position: "absolute",
        ...(side === "left" ? { right: 0 } : { left: 0 }),
        // Centred on its own gridline rather than sitting above it.
        bottom: `${fraction * 100}%`,
        transform: "translateY(50%)",
        display: "flex",
        alignItems: "center",
        gap: "3px",
      }}
    >
      {side === "right" && dash}
      <Typography
        component="span"
        sx={{
          fontSize: "0.56rem",
          lineHeight: 1,
          fontWeight: highlighted ? 700 : 400,
          color: highlighted ? "primary.main" : "text.secondary",
          whiteSpace: "nowrap",
          transition: "color 120ms",
        }}
      >
        {label}
      </Typography>
      {side === "left" && dash}
    </Box>
  );
}
