"use client";

import { useState } from "react";
import { Box, Tooltip } from "@mui/material";

import type { BinCensus, ScaleKind } from "./binModel";
import BinReadout, { READOUT_PLACEMENT, READOUT_SLOT_PROPS, type ReadoutRow } from "./BinReadout";
import { BAR_SEGMENT_ORDER, SEGMENT_STYLES } from "./palette";

interface TileBarsProps {
  bins: BinCensus[];
  height: number;
  /** The day the bars belong to, for the hover readout's title. */
  dayLabel: string;
  /**
   * Bin the cluster's last job finished in, or null if work was still active at
   * midnight. The readout names it, so the one all-terminal bar reads as
   * "finished here" rather than as a bar that stopped for no reason.
   */
  finishedAt: number | null;
  /** Accessible description; the graphic is one image. */
  label: string;
  /** Lights up the axis these bars are read against. See TileAxis. */
  onHoverScale?: (kind: ScaleKind | null) => void;
}

/**
 * Share of each column given over to the end-of-window emphasis.
 *
 * Each bar is a census taken at the instant its 4-hour window closes, not a
 * summary of what happened across it -- a distinction the bars had no way of
 * showing. The right-hand slice keeps the full colour and the rest is veiled, so
 * the eye lands on the moment the reading was actually taken. With the columns
 * running edge to edge these also read as tick marks at every window boundary.
 */
const SNAPSHOT_SHARE = "15%";

/** How much the body of a column is lightened next to its snapshot edge. */
const VEIL = "rgba(255,255,255,0.3)";

/**
 * The calendar-tile variant of the day chart: six 100%-stacked columns, colour
 * only -- no axes, no text. Plain divs rather than a Chart.js canvas: a month
 * renders ~30 of these and flexbox needs no per-tile chart lifecycle.
 *
 * The columns are contiguous and span the tile edge to edge, so one day's census
 * runs straight into the next day's. These bars are cumulative -- a single series
 * carried across the whole window -- so gaps between days would break a line that
 * is genuinely continuous.
 *
 * Two kinds of column draw nothing. A bin with nothing in play yet is genuinely
 * empty; a bin past the end of the cluster's work is suppressed on purpose (see
 * buildDayCensus) so a finished cluster does not repeat an all-teal bar to
 * midnight. Both keep their full-height hit area, so the reader can hover any of
 * the six and be told which case they are looking at.
 */
export default function TileBars({
  bins,
  height,
  dayLabel,
  finishedAt,
  label,
  onHoverScale,
}: TileBarsProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const bin = hovered === null ? null : bins[hovered];

  const enter = (index: number) => {
    setHovered(index);
    onHoverScale?.("activity");
  };
  const leave = () => {
    setHovered(null);
    onHoverScale?.(null);
  };

  // Share first, count second: these bars are 100%-stacked, so the percentage is
  // the reading and the count is only the supporting detail.
  //
  // A suppressed bin lists nothing at all. Its census still holds the finished
  // cohort, but printing "1,935 completed" beside "nothing left in play" reads as
  // a contradiction -- the footer is the whole story for those bins.
  const rows: ReadoutRow[] = bin?.drawn
    ? BAR_SEGMENT_ORDER.filter((state) => bin[state] > 0).map((state) => ({
        label: SEGMENT_STYLES[state].label.toLowerCase(),
        color: SEGMENT_STYLES[state].color,
        value: bin[state],
        share: bin.inPlay > 0 ? (bin[state] / bin.inPlay) * 100 : null,
        lead: "share" as const,
      }))
    : [];

  return (
    <Tooltip
      arrow
      followCursor
      disableInteractive
      placement={READOUT_PLACEMENT.activity}
      slotProps={READOUT_SLOT_PROPS}
      open={bin !== null}
      title={
        bin ? (
          <BinReadout
            // The moment the census was taken, not the window that closed. That is
            // what the bar is: a reading at an instant.
            title={`${dayLabel} · ${bin.snapshotAt}`}
            rows={rows}
            // The denominator sits at the foot. In this view it barely moves from
            // one bar to the next -- it is the whole group's job count -- so
            // leading with it buried the figures that do change.
            footer={[
              ...(bin.drawn ? [`${bin.inPlay.toLocaleString()} jobs in play`] : []),
              ...(!bin.drawn
                ? [
                    finishedAt !== null
                      ? `Nothing left in play — finished at ${bins[finishedAt].snapshotAt}, so later bars are not drawn.`
                      : "Nothing in play at this point.",
                  ]
                : bin.terminal
                  ? ["Every job is in a final state: this is where the work finished."]
                  : []),
            ]}
          />
        ) : (
          ""
        )
      }
    >
      <Box
        role="img"
        aria-label={label}
        onMouseLeave={leave}
        sx={{ display: "flex", width: "100%", height, alignItems: "stretch" }}
      >
        {bins.map((entry, i) => (
          <Box
            key={i}
            onMouseEnter={() => enter(i)}
            sx={{
              position: "relative",
              flex: 1,
              minWidth: 0,
              display: "flex",
              // Stacked bottom-up like the full chart: active at the base,
              // completed above it, removed on top. Column-reverse keeps the
              // segment order identical to BAR_SEGMENT_ORDER.
              flexDirection: "column-reverse",
              overflow: "hidden",
              // The hovered column lifts out of the row without moving anything.
              opacity: hovered === null || hovered === i ? 1 : 0.3,
            }}
          >
            {entry.drawn &&
              BAR_SEGMENT_ORDER.map((state) => (
                <Box
                  key={state}
                  sx={{
                    flexGrow: entry[state],
                    flexBasis: 0,
                    backgroundColor: SEGMENT_STYLES[state].color,
                  }}
                />
              ))}
            {/* Veils everything but the window's closing edge; see
                SNAPSHOT_SHARE. */}
            {entry.drawn && (
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: SNAPSHOT_SHARE,
                  backgroundColor: VEIL,
                  pointerEvents: "none",
                }}
              />
            )}
          </Box>
        ))}
      </Box>
    </Tooltip>
  );
}
