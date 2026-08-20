"use client";

import { Box, Stack, Typography } from "@mui/material";

import type { ScaleKind } from "./binModel";

/**
 * Which way a readout opens, by the scale the bar it describes belongs to.
 *
 * A readout is wide enough to cover an axis, and the axis it must not cover is the
 * one lighting up as the reader hovers -- being able to read the bar against its
 * own scale is the whole point of the highlight. So each opens away from its own
 * axis: activity readouts extend right, clear of the activity scale down the left,
 * and queue readouts extend left, clear of the queue scale down the right.
 *
 * Both stay above the pointer, so neither buries the row of bars being scanned.
 */
export const READOUT_PLACEMENT: Record<ScaleKind, "top-start" | "top-end"> = {
  activity: "top-start",
  queue: "top-end",
};

/**
 * Tooltip styling shared by every hover readout on the calendar.
 *
 * MUI's default tooltip is deliberately translucent -- grey 700 at 92% -- which
 * is fine for a few words of help text and wrong for this: a readout is a small
 * table of numbers, and it is always over a bar, so whatever is behind it bleeds
 * through the digits. Solid and darker, so the numbers are legible wherever the
 * pointer happens to be.
 */
export const READOUT_SLOT_PROPS = {
  tooltip: {
    sx: {
      backgroundColor: "grey.900",
      maxWidth: 320,
      px: 1.25,
      py: 0.75,
      boxShadow: 3,
    },
  },
  arrow: { sx: { color: "grey.900" } },
} as const;

/** One coloured line in a hover readout. */
export interface ReadoutRow {
  label: string;
  color: string;
  value: number;
  /** Percent of the bin, when the bin has a meaningful denominator. */
  share?: number | null;
  /**
   * Which figure leads the line. Counts lead by default, because for a bar that
   * measures work done the count IS the reading. A bar that measures a share of a
   * whole -- the 100%-stacked journey bars -- wants the percentage in front, with
   * the count as the supporting detail.
   */
  lead?: "value" | "share";
}

function formatShare(share: number): string {
  if (share <= 0) return "0%";
  if (share < 0.1) return "<0.1%";
  return `${share.toFixed(share < 10 ? 1 : 0)}%`;
}

/**
 * The hover readout for one bar in the calendar.
 *
 * The calendar's bars are deliberately tiny and unlabelled -- a month of them is
 * a shape you scan, not a chart you read -- so hovering is where the actual
 * numbers live. Everything the bar encodes and cannot say out loud goes here:
 * which 4-hour window it is, the count behind each segment, and the total.
 */
export default function BinReadout({
  title,
  subtitle,
  rows,
  footer,
}: {
  /** The bin, e.g. "Tue, Aug 4 · 08–12 h". */
  title: string;
  subtitle?: string;
  rows: ReadoutRow[];
  /** A list renders one line each, for a readout with more than one caveat. */
  footer?: string | string[];
}) {
  return (
    <Box sx={{ py: 0.25, minWidth: 168 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: "block", lineHeight: 1.5 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="caption" sx={{ display: "block", lineHeight: 1.5, opacity: 0.8 }}>
          {subtitle}
        </Typography>
      )}
      <Stack spacing={0.15} sx={{ mt: 0.5 }}>
        {rows.map((row) => {
          const leadsWithShare = row.lead === "share" && row.share != null;
          return (
            <Stack key={row.label} direction="row" spacing={0.75} alignItems="baseline">
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "2px",
                  backgroundColor: row.color,
                  flexShrink: 0,
                  transform: "translateY(1px)",
                }}
              />
              <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1.5 }}>
                {leadsWithShare ? formatShare(row.share as number) : row.value.toLocaleString()}
              </Typography>
              <Typography variant="caption" sx={{ lineHeight: 1.5, opacity: 0.85 }}>
                {row.label}
                {leadsWithShare
                  ? ` · ${row.value.toLocaleString()}`
                  : row.share != null && ` · ${formatShare(row.share)}`}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
      {(Array.isArray(footer) ? footer : footer ? [footer] : []).map((line) => (
        <Typography
          key={line}
          variant="caption"
          sx={{ display: "block", mt: 0.5, lineHeight: 1.5, opacity: 0.8, fontStyle: "italic" }}
        >
          {line}
        </Typography>
      ))}
    </Box>
  );
}
