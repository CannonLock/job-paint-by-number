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
 * The calendar-tile variant of the day chart: six 100%-stacked columns, colour
 * only -- no axes, no text. Plain divs rather than a Chart.js canvas: a month
 * renders ~30 of these and flexbox needs no per-tile chart lifecycle.
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

  // A suppressed bin lists no counts. Its census still holds the finished
  // cohort, but printing "1,935 completed" beside "nothing left in play" reads
  // as a contradiction -- the footer is the whole story for those bins.
  const rows: ReadoutRow[] = bin?.drawn
    ? BAR_SEGMENT_ORDER.filter((state) => bin[state] > 0).map((state) => ({
        label: SEGMENT_STYLES[state].label.toLowerCase(),
        color: SEGMENT_STYLES[state].color,
        value: bin[state],
        share: bin.inPlay > 0 ? (bin[state] / bin.inPlay) * 100 : null,
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
            title={`${dayLabel} · ${bin.label} h`}
            subtitle={
              bin.drawn
                ? `${bin.inPlay.toLocaleString()} jobs in play by the end of this window`
                : undefined
            }
            rows={rows}
            footer={
              !bin.drawn
                ? finishedAt !== null
                  ? `Nothing left in play — the cluster finished in the ${bins[finishedAt].label} window, so later bars are not drawn.`
                  : "Nothing in play in this window."
                : bin.terminal
                  ? "Every job is in a final state: this is where the cluster finished."
                  : undefined
            }
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
        sx={{ display: "flex", gap: "2px", width: "100%", height, alignItems: "stretch" }}
      >
        {bins.map((entry, i) => (
          <Box
            key={i}
            onMouseEnter={() => enter(i)}
            sx={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              // Stacked bottom-up like the full chart: active at the base,
              // completed above it, removed on top. Column-reverse keeps the
              // segment order identical to BAR_SEGMENT_ORDER.
              flexDirection: "column-reverse",
              borderRadius: "1px",
              overflow: "hidden",
              // The hovered column lifts out of the row without moving anything.
              opacity: hovered === null || hovered === i ? 1 : 0.55,
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
          </Box>
        ))}
      </Box>
    </Tooltip>
  );
}
