"use client";

import { useState } from "react";
import { Box, Tooltip } from "@mui/material";

import type { BarScale } from "../types";
import { barFraction, type ScaleKind } from "./binModel";
import BinReadout, { READOUT_PLACEMENT, READOUT_SLOT_PROPS } from "./BinReadout";
import { formatDayShort, type DayQueue } from "./dayCards";
import QueueGlyph from "./QueueGlyph";
import { BAR_STATE_STYLES, CARRIED_ACTIVE_COLOR, QUEUE_TEXTURE } from "./palette";

/**
 * Width of the queue bar. Straddling the boundary, half of this sits in each
 * day, so it reads as belonging to neither -- which is the point: the queue is
 * the state the two days share.
 */
const BAR_WIDTH = 11;

/** Height of the glyph row beneath the bar. */
const GLYPH_ROW = 13;

interface TileQueueBarProps {
  queue: DayQueue;
  /** The day whose close this is. */
  day: string;
  /** The following day, for the readout's title. Null at the end of the window. */
  nextDay: string | null;
  /** Largest queue in the whole baked window; the queue bars' own scale. */
  peak: number;
  scale: BarScale;
  /** Bar-slot height, shared with the day's own bars. */
  height: number;
  /** Distance from the tile's bottom edge to the floor of the bar slot. */
  bottom: number;
  /**
   * Lights up the queue scale down the right of the calendar while this bar is
   * hovered -- the queue markers answer to that axis, not to the one on the left.
   */
  onHoverScale?: (kind: ScaleKind | null) => void;
}

/**
 * The queue at midnight, drawn astride the boundary between two days.
 *
 * Every other bar in the calendar is a flow -- how many jobs changed state inside
 * a window. This one is a stock: how many were simply sitting in the queue when
 * the day ended. The distinction matters because the two are almost independent.
 * A day can show six empty activity bars, meaning nothing moved, while a million
 * jobs stand waiting; nothing else on the calendar would tell you.
 *
 * Being a different quantity, it gets a different scale (the month's largest
 * queue) and cannot be read against the row axis, which counts changes. Two
 * things mark it out as not-a-day-bar: it belongs to no single tile, sitting half
 * in each of the days it separates, and it carries a glyph no other bar has.
 */
export default function TileQueueBar({
  queue,
  day,
  nextDay,
  peak,
  scale,
  height,
  bottom,
  onHoverScale,
}: TileQueueBarProps) {
  const [hovered, setHovered] = useState(false);
  // Fills the slot at its own maximum, exactly as the activity bars do: the
  // tallest queue in the window reaches the same height as the busiest 4-hour
  // window, each at the top of its own scale.
  const fraction = barFraction(queue.total, Math.max(peak, 1), scale);

  return (
    <Tooltip
      arrow
      followCursor
      disableInteractive
      placement={READOUT_PLACEMENT.queue}
      slotProps={READOUT_SLOT_PROPS}
      open={hovered}
      title={
        <BinReadout
          title={
            nextDay
              ? `Queue at midnight · ${formatDayShort(day)} → ${formatDayShort(nextDay)}`
              : `Queue at the end of ${formatDayShort(day)}`
          }
          subtitle={`${queue.total.toLocaleString()} ${
            queue.total === 1 ? "job" : "jobs"
          } still in the queue`}
          rows={[
            ...(queue.carried > 0
              ? [
                  {
                    label: "already in flight before this day",
                    color: CARRIED_ACTIVE_COLOR,
                    value: queue.carried,
                    share: queue.total > 0 ? (queue.carried / queue.total) * 100 : null,
                  },
                ]
              : []),
            ...(queue.fromToday > 0
              ? [
                  {
                    label: "placed this day, still in flight",
                    color: BAR_STATE_STYLES.active.color,
                    value: queue.fromToday,
                    share: queue.total > 0 ? (queue.fromToday / queue.total) * 100 : null,
                  },
                ]
              : []),
          ]}
          footer="Queue size, not state changes — read it against the queue scale down the right of the calendar, not the activity scale on the left."
        />
      }
    >
      <Box
        role="img"
        aria-label={`${queue.total.toLocaleString()} jobs in the queue at the end of ${formatDayShort(day)}`}
        onMouseEnter={() => {
          setHovered(true);
          onHoverScale?.("queue");
        }}
        onMouseLeave={() => {
          setHovered(false);
          onHoverScale?.(null);
        }}
        sx={{
          position: "absolute",
          right: 0,
          bottom,
          // Half in this day, half in the next.
          transform: "translateX(50%)",
          width: BAR_WIDTH,
          height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          // Lifts the overhanging half above the following tile, which paints
          // after this one and would otherwise cover it on hover.
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: `${(fraction * 100).toFixed(3)}%`,
            // A queue that exists at all stays visible.
            minHeight: queue.total > 0 ? 2 : 0,
            display: "flex",
            flexDirection: "column-reverse",
            borderRadius: "1px",
            overflow: "hidden",
            // Distinguishes it from the day bars at a glance, before the glyph
            // is even noticed. A shadow rather than a border so it costs the bar
            // no height -- the height is data.
            boxShadow: (theme) => `0 0 0 1px ${theme.palette.background.paper}`,
          }}
        >
          {/* Carried work at the base, this day's arrivals stacked on top of it --
              the same bottom-up order, and the same two blues, the 4-hour bars
              use for carried versus new. */}
          <Box sx={{ flexGrow: queue.carried, flexBasis: 0, backgroundColor: CARRIED_ACTIVE_COLOR }} />
          <Box
            sx={{
              flexGrow: queue.fromToday,
              flexBasis: 0,
              backgroundColor: BAR_STATE_STYLES.active.color,
            }}
          />
          {/* One continuous texture over both halves; see QUEUE_TEXTURE. */}
          <Box sx={{ position: "absolute", inset: 0, ...QUEUE_TEXTURE }} />
        </Box>

        {/* Below the slot floor, on the boundary itself, so the reader can tell
            at a glance which bars are queues and which are days. The same mark
            heads the queue scale down the right of the calendar. */}
        <Box
          sx={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            height: GLYPH_ROW,
            display: "flex",
            alignItems: "center",
          }}
        >
          <QueueGlyph active={hovered} />
        </Box>
      </Box>
    </Tooltip>
  );
}
