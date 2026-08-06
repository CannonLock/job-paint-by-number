"use client";

import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";

import type { DaySlice } from "../types";
import { ActivityRows } from "./StateRows";
import StateFlowSankey from "./StateFlowSankey";
import { formatDayLong, hasFlow } from "./dayModel";

interface YesterdayCardProps {
  slice: DaySlice | null;
  onOpenDetail: () => void;
}

/**
 * The landing summary: what moved on the most recent full day. This is the first
 * thing a user wants on opening the page -- "did anything happen overnight" --
 * before they go hunting through the month.
 */
export default function YesterdayCard({ slice, onOpenDetail }: YesterdayCardProps) {
  // Distinct jobs that moved, matching the calendar rather than the sum of the
  // transition lines below it.
  const changed = slice?.changed ?? 0;

  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 2, sm: 2.5 }, borderColor: "primary.main", borderWidth: 2 }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            What happened Yesterday
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {slice ? formatDayLong(slice.day) : "no earlier day in this window"}
          </Typography>

          <Box sx={{ mt: 1.5 }}>
            {!slice || changed === 0 ? (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                No jobs changed state.
              </Typography>
            ) : (
              <>
                <Typography variant="body2" sx={{ mb: 0.75 }}>
                  <Box component="span" sx={{ fontWeight: 700 }}>
                    {changed.toLocaleString()}
                  </Box>{" "}
                  <Box component="span" sx={{ color: "text.secondary" }}>
                    {changed === 1 ? "job" : "jobs"} changed state, broken down as:
                  </Box>
                </Typography>
                <ActivityRows
                  started={slice.started}
                  completed={slice.completed}
                  removed={slice.removed}
                />
                {/* Same caveat as the day dialog: these are transitions, not jobs. */}
                <Typography
                  variant="caption"
                  component="p"
                  sx={{ color: "text.secondary", mt: 1, fontStyle: "italic" }}
                >
                  A job that did more than one thing appears on more than one line, so
                  these add up to more than {changed.toLocaleString()}.
                </Typography>
              </>
            )}
          </Box>
        </Box>

        {/* Full variant: nodes labelled, counts on hover. This is the one place the
            flow gets enough room to be read rather than just glanced at. */}
        {slice && changed > 0 && (
          <Box sx={{ flex: 1, minWidth: { xs: "100%", sm: 320 }, width: "100%" }}>
            {hasFlow(slice.flows) ? (
              <StateFlowSankey
                flows={slice.flows}
                carry={slice.carry}
                variant="full"
                height={170}
                label={`State changes on ${formatDayLong(slice.day)}`}
              />
            ) : (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Flow data needs a rebuild — run <code>node scripts/build-day-data.mjs</code>.
              </Alert>
            )}
          </Box>
        )}

        {slice && (
          <Button variant="outlined" size="small" onClick={onOpenDetail} sx={{ flexShrink: 0 }}>
            See the full day
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
