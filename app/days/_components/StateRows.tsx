"use client";

import { Box, Stack, Typography } from "@mui/material";

import type { JobState, StateCounts } from "../types";
import { STATE_ORDER, STATE_STYLES } from "./palette";

/** Swatch + count + label. The number is the relief for the palette's low-contrast steps. */
export function StateRow({
  state,
  value,
  total,
  verb,
}: {
  state: JobState;
  value: number;
  total?: number;
  /** Overrides the state name, for the "changed state" phrasing. */
  verb?: string;
}) {
  const style = STATE_STYLES[state];
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

/** The four-state breakdown of one cohort. */
export function CohortStateRows({
  counts,
  total,
}: {
  counts: StateCounts;
  total: number;
}) {
  return (
    <Stack spacing={0.25}>
      {STATE_ORDER.map((state, i) => (
        <StateRow key={state} state={state} value={counts[i]} total={total} />
      ))}
    </Stack>
  );
}

/** What changed state on a given day, across all jobs whenever they were queued. */
export function ActivityRows({
  started,
  completed,
  removed,
}: {
  started: number;
  completed: number;
  removed: number;
}) {
  return (
    <Stack spacing={0.25}>
      <StateRow state="running" value={started} verb="jobs started running" />
      <StateRow state="completed" value={completed} verb="jobs completed" />
      <StateRow state="removed" value={removed} verb="jobs got removed" />
    </Stack>
  );
}
