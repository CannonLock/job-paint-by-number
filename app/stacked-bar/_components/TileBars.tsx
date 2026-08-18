"use client";

import { Box } from "@mui/material";

import type { BinCensus } from "./binModel";
import { BAR_SEGMENT_ORDER, SEGMENT_STYLES } from "./palette";

interface TileBarsProps {
  bins: BinCensus[];
  height: number;
  /** Accessible description; the graphic is one image. */
  label: string;
}

/**
 * The calendar-tile variant of the day chart: six 100%-stacked columns, colour
 * only -- no axes, no text, no interaction. Plain divs rather than a Chart.js
 * canvas: a month renders ~30 of these and flexbox needs no per-tile chart
 * lifecycle. Bins with nothing in play yet stay empty instead of drawing a 0/0
 * column.
 */
export default function TileBars({ bins, height, label }: TileBarsProps) {
  return (
    <Box
      role="img"
      aria-label={label}
      sx={{ display: "flex", gap: "2px", width: "100%", height, alignItems: "stretch" }}
    >
      {bins.map((bin, i) => (
        <Box
          key={i}
          sx={{
            flex: 1,
            display: "flex",
            // Stacked bottom-up like the full chart: active at the base,
            // completed above it, removed on top. Column-reverse keeps the
            // dataset order identical to BAR_STATE_ORDER.
            flexDirection: "column-reverse",
            borderRadius: "1px",
            overflow: "hidden",
          }}
        >
          {bin.inPlay > 0 &&
            BAR_SEGMENT_ORDER.map((state) => (
              <Box
                key={state}
                sx={{
                  flexGrow: bin[state],
                  flexBasis: 0,
                  backgroundColor: SEGMENT_STYLES[state].color,
                }}
              />
            ))}
        </Box>
      ))}
    </Box>
  );
}
