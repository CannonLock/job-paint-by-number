"use client";

import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import Close from "@mui/icons-material/Close";

import type { DaySlice } from "../types";
import { STATE_ORDER, STATE_STYLES } from "./palette";
import JobGrid from "./JobGrid";
import { ActivityRows, CohortStateRows } from "./StateRows";
import { formatDayLong, formatDayShort } from "./dayModel";
import { boxScaleLabel } from "./waffle";

interface DayDialogProps {
  slice: DaySlice | null;
  /** The day everything is read as of. */
  asOf: string;
  open: boolean;
  onClose: () => void;
}

function gridLabel(slice: DaySlice, asOf: string): string {
  const parts = STATE_ORDER.map(
    (state, i) =>
      `${(slice.stateAsOf?.[i] ?? 0).toLocaleString()} ${STATE_STYLES[state].label.toLowerCase()}`,
  );
  return (
    `${slice.queued.toLocaleString()} jobs queued on ${formatDayShort(slice.day)}; ` +
    `as of ${formatDayShort(asOf)}: ${parts.join(", ")}`
  );
}

/** Centred per-day breakdown: where that day's cohort stands, and what moved that day. */
export default function DayDialog({ slice, asOf, open, onClose }: DayDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="body">
      {slice && (
        <>
          <DialogTitle sx={{ pr: 6, pb: 1 }}>
            <Typography component="span" variant="h6" sx={{ fontWeight: 700, display: "block" }}>
              {formatDayLong(slice.day)}
            </Typography>
            <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
              status shown as of {formatDayShort(asOf)}
            </Typography>
            <IconButton
              onClick={onClose}
              aria-label="Close"
              size="small"
              sx={{ position: "absolute", right: 12, top: 12 }}
            >
              <Close />
            </IconButton>
          </DialogTitle>

          <DialogContent dividers>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={{ xs: 2.5, sm: 3 }}
              alignItems="flex-start"
            >
              {slice.queued > 0 && (
                <Box sx={{ flexShrink: 0, width: { xs: "100%", sm: 176 } }}>
                  <JobGrid counts={slice.stateAsOf} label={gridLabel(slice, asOf)} />
                  <Typography
                    variant="caption"
                    component="p"
                    sx={{ mt: 1, color: "text.secondary", lineHeight: 1.5 }}
                  >
                    {boxScaleLabel(slice.queued)}
                    <br />
                    <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
                      Jobs Queued: {slice.queued.toLocaleString()}
                    </Box>
                  </Typography>
                </Box>
              )}

              <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
                <Box>
                  <Typography
                    variant="overline"
                    component="h3"
                    sx={{ color: "text.secondary", lineHeight: 1.6, display: "block" }}
                  >
                    Jobs queued this day
                  </Typography>
                  {slice.queued > 0 && slice.stateAsOf ? (
                    <>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        where those {slice.queued.toLocaleString()} jobs stand now
                      </Typography>
                      <Box sx={{ mt: 0.75 }}>
                        <CohortStateRows counts={slice.stateAsOf} total={slice.queued} />
                      </Box>
                    </>
                  ) : (
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      Nothing was submitted on this day.
                    </Typography>
                  )}
                </Box>

                <Divider flexItem />

                <Box>
                  <Typography
                    variant="overline"
                    component="h3"
                    sx={{ color: "text.secondary", lineHeight: 1.6, display: "block" }}
                  >
                    Changed state this day
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    all jobs, whenever they were queued
                  </Typography>
                  {slice.changed === 0 ? (
                    <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
                      No jobs changed state.
                    </Typography>
                  ) : (
                    <>
                      <Box sx={{ mt: 0.75 }}>
                        <ActivityRows
                          started={slice.started}
                          completed={slice.completed}
                          removed={slice.removed}
                        />
                      </Box>
                      {/*
                        These lines count transitions, not jobs, so they can exceed
                        the calendar's figure for the same day. Saying so here is what
                        lets the calendar stay a job count without the two looking
                        like a contradiction.
                      */}
                      <Typography
                        variant="caption"
                        component="p"
                        sx={{ color: "text.secondary", mt: 1, fontStyle: "italic" }}
                      >
                        Counts every transition, so a job that did more than one thing
                        this day appears on more than one line. The calendar counts jobs
                        instead: {slice.changed.toLocaleString()} distinct{" "}
                        {slice.changed === 1 ? "job" : "jobs"} moved this day.
                      </Typography>
                    </>
                  )}
                </Box>
              </Stack>
            </Stack>
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}
