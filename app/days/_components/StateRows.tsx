"use client";

import { Box, Stack, Typography } from "@mui/material";

import type { BarState } from "../types";
import { BAR_STATE_STYLES } from "./palette";

/** Swatch + count + label. The number is the relief for tiny shares. */
export function StateRow({
  state,
  value,
  total,
  verb,
}: {
  state: BarState;
  value: number;
  total?: number;
  /** Overrides the state name, for the "changed state" phrasing. */
  verb?: string;
}) {
  const style = BAR_STATE_STYLES[state];
  const share = total && total > 0 ? (value / total) * 100 : null;
  const pct =
    share === null || value === 0
      ? ""
      : share < 0.1
        ? "<0.1%"
        : `${share.toFixed(share < 10 ? 1 : 0)}%`;

  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: "2px",
          backgroundColor: style.color,
          flexShrink: 0,
          transform: "translateY(1px)",
        }}
      />
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {value.toLocaleString()}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {verb ?? style.label.toLowerCase()}
        {pct && ` · ${pct}`}
      </Typography>
    </Stack>
  );
}

/**
 * What changed state over a day or a period. In the merged three-state model a
 * job becomes Active by being placed, so "placed" is the entry line -- there is
 * no separate started transition to report, because Placed -> Running is not a
 * state change here.
 */
export function ActivityRows({
  placed,
  completed,
  removed,
}: {
  placed: number;
  completed: number;
  removed: number;
}) {
  return (
    <Stack spacing={0.25}>
      <StateRow state="active" value={placed} verb="jobs placed (became active)" />
      <StateRow state="completed" value={completed} verb="jobs completed" />
      <StateRow state="removed" value={removed} verb="jobs got removed" />
    </Stack>
  );
}
