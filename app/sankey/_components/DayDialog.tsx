"use client";

import { useMemo } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import Close from "@mui/icons-material/Close";

import type { DayData, DaySlice } from "../types";
import { STATE_ORDER, STATE_STYLES } from "./palette";
import JobGrid from "./JobGrid";
import { ActivityRows, CohortStateRows } from "./StateRows";
import StateFlowSankey from "./StateFlowSankey";
import ClusterJourneySankey from "./ClusterJourneySankey";
import {
  ALL_CLUSTERS,
  buildJourneyMap,
  buildSliceMap,
  compactNumber,
  formatDayLong,
  formatDayShort,
  hasFlow,
} from "./dayModel";
import { boxScaleLabel } from "./waffle";

interface DayDialogProps {
  data: DayData;
  /** The day being inspected, or null when the dialog is closed. */
  day: string | null;
  /** The page-level cluster selection; the dialog is scoped to it. */
  cluster: string;
  /**
   * Change the page-level selection. The dialog's select drives the same state
   * as the page's, so the two can never disagree and the URL stays linkable.
   */
  onClusterChange: (cluster: string) => void;
  /** The day everything is read as of. */
  asOf: string;
  open: boolean;
  onClose: () => void;
}

/** What one cluster did on the dialog's day, for the select's option labels. */
interface DayClusterEntry {
  id: string;
  placed: number;
  changed: number;
}

function gridLabel(slice: DaySlice, asOf: string): string {
  const parts = STATE_ORDER.map(
    (state, i) =>
      `${(slice.stateAsOf?.[i] ?? 0).toLocaleString()} ${STATE_STYLES[state].label.toLowerCase()}`,
  );
  return (
    `${slice.queued.toLocaleString()} jobs placed on ${formatDayShort(slice.day)}; ` +
    `as of ${formatDayShort(asOf)}: ${parts.join(", ")}`
  );
}

function optionLabel(entry: DayClusterEntry): string {
  const parts: string[] = [];
  if (entry.placed > 0) parts.push(`${compactNumber(entry.placed)} placed`);
  if (entry.changed > 0) parts.push(`${compactNumber(entry.changed)} changed`);
  return parts.length > 0 ? `Cluster ${entry.id} · ${parts.join(", ")}` : `Cluster ${entry.id}`;
}

/** Centred per-day breakdown: where that day's cohort stands, and what moved that day. */
export default function DayDialog({
  data,
  day,
  cluster,
  onClusterChange,
  asOf,
  open,
  onClose,
}: DayDialogProps) {
  // Clusters that are part of this day: a cohort placed on it, or any activity.
  const dayClusters = useMemo<DayClusterEntry[]>(() => {
    if (!day) return [];
    const byId = new Map<string, DayClusterEntry>();
    const entry = (id: number) => {
      const key = String(id);
      let e = byId.get(key);
      if (!e) byId.set(key, (e = { id: key, placed: 0, changed: 0 }));
      return e;
    };
    for (const cohort of data.cohorts) {
      if (cohort.day === day && cohort.queued > 0) entry(cohort.cluster).placed += cohort.queued;
    }
    for (const row of data.activity) {
      if (row.day === day) entry(row.cluster).changed += row.changed;
    }
    return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }, [data, day]);

  // A page-level selection that plays no part in this day falls back to all
  // clusters rather than presenting an empty breakdown.
  const effectiveCluster =
    cluster !== ALL_CLUSTERS && !dayClusters.some((c) => c.id === cluster)
      ? ALL_CLUSTERS
      : cluster;

  // buildSliceMap walks the whole window, but the arrays are pre-aggregated and
  // small (tens of rows), so per-open recomputation is cheap.
  const slices = useMemo(() => buildSliceMap(data, effectiveCluster), [data, effectiveCluster]);
  const slice = day ? (slices.get(day) ?? null) : null;

  // Cluster mode swaps the changes diagram for the whole-cohort journey.
  const journey = useMemo(
    () =>
      day && effectiveCluster !== ALL_CLUSTERS
        ? (buildJourneyMap(data, effectiveCluster, slices).get(day) ?? null)
        : null,
    [data, effectiveCluster, slices, day],
  );

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

          {/*
            Two stacked sections rather than two columns: "placed that day" is a
            different question from "what moved that day", and side by side the
            waffle's column forced the second question into a narrow gutter.
            Each section now owns a full row, graphic beside its own numbers.
          */}
          <DialogContent dividers>
            <Stack spacing={3}>
              <Box>
                <Typography
                  variant="overline"
                  component="label"
                  htmlFor="day-cluster-select"
                  sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}
                >
                  Cluster
                </Typography>
                <Select
                  id="day-cluster-select"
                  size="small"
                  value={effectiveCluster}
                  onChange={(event) => onClusterChange(String(event.target.value))}
                  sx={{ mt: 0.5, minWidth: 260 }}
                >
                  <MenuItem value={ALL_CLUSTERS}>
                    All clusters on this day ({dayClusters.length})
                  </MenuItem>
                  {dayClusters.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {optionLabel(c)}
                    </MenuItem>
                  ))}
                </Select>
              </Box>

              <Box component="section">
                <Typography
                  variant="overline"
                  component="h3"
                  sx={{ color: "text.secondary", lineHeight: 1.6, display: "block" }}
                >
                  Placed this day
                </Typography>

                {slice.queued > 0 && slice.stateAsOf ? (
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={{ xs: 2, sm: 3 }}
                    alignItems="flex-start"
                    sx={{ mt: 0.75 }}
                  >
                    <Box sx={{ flexShrink: 0, width: { xs: "100%", sm: 176 } }}>
                      <JobGrid counts={slice.stateAsOf} label={gridLabel(slice, asOf)} showGlyphs />
                      <Typography
                        variant="caption"
                        component="p"
                        sx={{ mt: 1, color: "text.secondary", lineHeight: 1.5 }}
                      >
                        {boxScaleLabel(slice.queued)}
                        <br />
                        <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
                          Jobs Placed: {slice.queued.toLocaleString()}
                        </Box>
                      </Typography>
                    </Box>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        where those {slice.queued.toLocaleString()} jobs stand as of{" "}
                        {formatDayShort(asOf)}
                      </Typography>
                      <Box sx={{ mt: 0.75 }}>
                        <CohortStateRows counts={slice.stateAsOf} total={slice.queued} />
                      </Box>
                    </Box>
                  </Stack>
                ) : (
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
                    Nothing was submitted on this day.
                  </Typography>
                )}
              </Box>

              <Divider flexItem />

              <Box component="section">
                <Typography
                  variant="overline"
                  component="h3"
                  sx={{ color: "text.secondary", lineHeight: 1.6, display: "block" }}
                >
                  Changed state this day
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  all jobs, whenever they were placed
                </Typography>

                {slice.changed === 0 && !journey?.alive ? (
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
                    No jobs changed state.
                  </Typography>
                ) : (
                  <>
                    {/* Cluster mode: the whole cohort's journey through this day.
                        All-clusters keeps the transition diagram. */}
                    {journey?.alive ? (
                      <Box sx={{ mt: 1 }}>
                        <ClusterJourneySankey
                          journey={journey}
                          variant="full"
                          height={200}
                          label={`Cluster journey through ${formatDayLong(slice.day)}`}
                        />
                      </Box>
                    ) : (
                      hasFlow(slice.flows) && (
                        <Box sx={{ mt: 1 }}>
                          <StateFlowSankey
                            flows={slice.flows}
                            carry={slice.carry}
                            variant="full"
                            height={200}
                            label={`State changes on ${formatDayLong(slice.day)}`}
                          />
                        </Box>
                      )
                    )}
                    <Box sx={{ mt: 1.5 }}>
                      <ActivityRows
                        started={slice.started}
                        completed={slice.completed}
                        removed={slice.removed}
                      />
                    </Box>
                    {/*
                      These lines count transitions, not jobs, so they can exceed the
                      calendar's figure for the same day. Saying so here is what lets
                      the calendar stay a job count without the two looking like a
                      contradiction.
                    */}
                    <Typography
                      variant="caption"
                      component="p"
                      sx={{ color: "text.secondary", mt: 1, fontStyle: "italic" }}
                    >
                      Counts every transition, so a job that did more than one thing this
                      day appears on more than one line. The calendar counts jobs instead:{" "}
                      {slice.changed.toLocaleString()} distinct{" "}
                      {slice.changed === 1 ? "job" : "jobs"} moved this day.
                    </Typography>
                  </>
                )}
              </Box>
            </Stack>
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}
