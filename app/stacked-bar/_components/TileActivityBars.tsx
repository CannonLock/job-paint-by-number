"use client";

import { Box } from "@mui/material";

import type { BinActivity } from "./binModel";
import { ACTIVITY_ORDER, ACTIVITY_STYLES } from "./palette";

interface TileActivityBarsProps {
  bins: BinActivity[];
  /**
   * The tallest bin count on the visible month. Every tile scales against the
   * same peak, so bar heights compare across days on one shared scale.
   */
  peakBinTotal: number;
  height: number;
  /** Accessible description; the graphic is one image. */
  label: string;
}

/**
 * Log-scaled column height against the month's peak bin. Linear scaling made any
 * month with one heavy day read as "nothing happened anywhere else" -- a 66-change
 * bin against a 900k-change peak rounds to zero pixels. The log keeps quiet days
 * visible while the peak still clearly towers; the trade-off is that heights are
 * no longer proportional, so magnitude comparisons are ordinal, not ratio. The
 * segments inside a column stay linear, and the full-size chart keeps its linear
 * count axis with exact totals on hover.
 */
function logFraction(total: number, peak: number): number {
  if (total <= 0) return 0;
  const denom = Math.log10(peak + 1);
  if (denom <= 0) return 1;
  return Math.min(Math.log10(total + 1) / denom, 1);
}

/**
 * The calendar-tile variant of the magnitude chart: six count-scaled columns,
 * colour only. Same plain-div construction as TileBars; here the column heights
 * carry the signal instead of the composition.
 */
export default function TileActivityBars({
  bins,
  peakBinTotal,
  height,
  label,
}: TileActivityBarsProps) {
  const peak = Math.max(peakBinTotal, 1);
  return (
    <Box
      role="img"
      aria-label={label}
      sx={{ display: "flex", gap: "2px", width: "100%", height, alignItems: "flex-end" }}
    >
      {bins.map((bin, i) => (
        <Box
          key={i}
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column-reverse",
            height: `${logFraction(bin.total, peak) * 100}%`,
            // A bin with any activity at all stays visible even when it rounds
            // to under a pixel against the month's peak.
            minHeight: bin.total > 0 ? 2 : 0,
            borderRadius: "1px",
            overflow: "hidden",
          }}
        >
          {bin.total > 0 &&
            ACTIVITY_ORDER.map((state) => (
              <Box
                key={state}
                sx={{
                  flexGrow: bin[state],
                  flexBasis: 0,
                  backgroundColor: ACTIVITY_STYLES[state].color,
                }}
              />
            ))}
        </Box>
      ))}
    </Box>
  );
}
