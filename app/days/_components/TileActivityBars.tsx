"use client";

import { useState } from "react";
import { Box, Tooltip } from "@mui/material";

import type { BarScale } from "../types";
import { barFraction, type BinActivity, type ScaleKind } from "./binModel";
import BinReadout, { READOUT_PLACEMENT, READOUT_SLOT_PROPS, type ReadoutRow } from "./BinReadout";
import { ACTIVITY_ORDER, ACTIVITY_STYLES } from "./palette";

interface TileActivityBarsProps {
  bins: BinActivity[];
  /**
   * The tallest bin count on the visible month. Every tile scales against the
   * same peak, so bar heights compare across days on one shared scale.
   */
  peakBinTotal: number;
  scale: BarScale;
  height: number;
  /** The day the bars belong to, for the hover readout's title. */
  dayLabel: string;
  /** Accessible description; the graphic is one image. */
  label: string;
  /**
   * Reports which of the calendar's two scales the pointer is over, so the axis
   * that governs these bars can light up while they are hovered.
   */
  onHoverScale?: (kind: ScaleKind | null) => void;
}

/**
 * The calendar-tile variant of the magnitude chart: six count-scaled columns,
 * colour only. Same plain-div construction as TileBars; here the column heights
 * carry the signal instead of the composition, under whichever scale the page is
 * set to (see barFraction, and ScaleInfo.tsx for what each one costs).
 *
 * Each column gets a full-height hit area so an idle 4-hour window is still
 * hoverable and can say so.
 */
export default function TileActivityBars({
  bins,
  peakBinTotal,
  scale,
  height,
  dayLabel,
  label,
  onHoverScale,
}: TileActivityBarsProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const bin = hovered === null ? null : bins[hovered];
  const peak = Math.max(peakBinTotal, 1);

  const enter = (index: number) => {
    setHovered(index);
    onHoverScale?.("activity");
  };
  const leave = () => {
    setHovered(null);
    onHoverScale?.(null);
  };

  const rows: ReadoutRow[] = bin
    ? ACTIVITY_ORDER.filter((state) => bin[state] > 0).map((state) => ({
        label: `jobs ${state}`,
        color: ACTIVITY_STYLES[state].color,
        value: bin[state],
        share: bin.total > 0 ? (bin[state] / bin.total) * 100 : null,
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
              bin.total > 0
                ? `${bin.total.toLocaleString()} state ${bin.total === 1 ? "change" : "changes"}`
                : undefined
            }
            rows={rows}
            footer={bin.total === 0 ? "Nothing changed state in this window." : undefined}
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
        sx={{ display: "flex", gap: "2px", width: "100%", height, alignItems: "flex-end" }}
      >
        {bins.map((entry, i) => (
          <Box
            key={i}
            onMouseEnter={() => enter(i)}
            // Full-height hit area; the bar itself sits at the bottom of it.
            sx={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              opacity: hovered === null || hovered === i ? 1 : 0.55,
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: "column-reverse",
                // Rounded to three decimals on purpose. Math.log10 is only
                // implementation-approximated, so Node and the browser can
                // disagree in the last bits of a float -- enough to emit two
                // different style strings for the same bar and trip a hydration
                // mismatch. Three decimals is far finer than a pixel.
                height: `${(barFraction(entry.total, peak, scale) * 100).toFixed(3)}%`,
                // A bin with any activity at all stays visible even when it
                // rounds to under a pixel against the month's peak.
                minHeight: entry.total > 0 ? 2 : 0,
                borderRadius: "1px",
                overflow: "hidden",
              }}
            >
              {entry.total > 0 &&
                ACTIVITY_ORDER.map((state) => (
                  <Box
                    key={state}
                    sx={{
                      flexGrow: entry[state],
                      flexBasis: 0,
                      backgroundColor: ACTIVITY_STYLES[state].color,
                    }}
                  />
                ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Tooltip>
  );
}
