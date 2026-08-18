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

import type { StackedBarData } from "../types";
import {
  ALL_CLUSTERS,
  BAR_COUNT_ORDER,
  buildSliceMap,
  compactNumber,
  type DayData,
  type DaySlice,
} from "./dayCards";
import {
  buildDayActivity,
  buildDayCensus,
  expandSeries,
  formatDayLong,
  formatDayShort,
} from "./binModel";
import { BAR_STATE_STYLES } from "./palette";
import DayActivityBars from "./DayActivityBars";
import DayStackedBars from "./DayStackedBars";
import JobGrid from "./JobGrid";
import { ActivityRows, CohortStateRows } from "./StateRows";
import { boxScaleLabel } from "./waffle";

interface DayDialogProps {
  /** Cohort/activity source (day-cards bake). */
  dayData: DayData;
  /** 4-hour bin source (stacked-bars bake). */
  barData: StackedBarData;
  /** The day being inspected, or null when the dialog is closed. */
  day: string | null;
  /** The page-level cluster selection; the dialog is scoped to it. */
  cluster: string;
  /** Change the page-level selection, so the two selects can never disagree. */
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
  const parts = BAR_COUNT_ORDER.map(
    (state, i) =>
      `${(slice.stateAsOf?.[i] ?? 0).toLocaleString()} ${BAR_STATE_STYLES[state].label.toLowerCase()}`,
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

/**
 * Centred per-day breakdown: where that day's cohort stands, and how the day's
 * work resolved bin by bin -- the stacked-bar counterpart of the Sankey page's
 * dialog (copied and adapted, not imported).
 */
export default function DayDialog({
  dayData,
  barData,
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
    for (const cohort of dayData.cohorts) {
      if (cohort.day === day && cohort.queued > 0) entry(cohort.cluster).placed += cohort.queued;
    }
    for (const row of dayData.activity) {
      if (row.day === day) entry(row.cluster).changed += row.changed;
    }
    return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }, [dayData, day]);

  // A page-level selection that plays no part in this day falls back to all
  // clusters rather than presenting an empty breakdown.
  const effectiveCluster =
    cluster !== ALL_CLUSTERS && !dayClusters.some((c) => c.id === cluster)
      ? ALL_CLUSTERS
      : cluster;

  const slice = useMemo(
    () => (day ? (buildSliceMap(dayData, effectiveCluster).get(day) ?? null) : null),
    [dayData, effectiveCluster, day],
  );

  // The day's six-bin derivation for the same cluster scope: the whole-cohort
  // ratio census in cluster mode, per-bin change counts for all clusters.
  const journeyMode = effectiveCluster !== ALL_CLUSTERS;
  const { census, activity } = useMemo(() => {
    if (!day) return { census: null, activity: null };
    const dayIndex = barData.days.indexOf(day);
    if (dayIndex < 0) return { census: null, activity: null };
    const dense = expandSeries(barData, effectiveCluster);
    return journeyMode
      ? { census: buildDayCensus(barData, dense, dayIndex, "journey"), activity: null }
      : { census: null, activity: buildDayActivity(barData, dense, dayIndex) };
  }, [barData, effectiveCluster, journeyMode, day]);

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
            <Stack spacing={3}>
              <Box>
                <Typography
                  variant="overline"
                  component="label"
                  htmlFor="stacked-day-cluster-select"
                  sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}
                >
                  Cluster
                </Typography>
                <Select
                  id="stacked-day-cluster-select"
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

                {slice.changed === 0 && !(census?.hasData ?? false) ? (
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
                    No jobs changed state.
                  </Typography>
                ) : (
                  <>
                    {census?.hasData && (
                      <Box sx={{ mt: 1 }}>
                        <DayStackedBars
                          bins={census.bins}
                          height={240}
                          label={`Share of the cluster's jobs active, completed, and removed per 4-hour bin on ${formatDayLong(slice.day)}`}
                        />
                      </Box>
                    )}
                    {activity?.hasData && (
                      <Box sx={{ mt: 1 }}>
                        <DayActivityBars
                          bins={activity.bins}
                          height={240}
                          label={`State changes per 4-hour bin on ${formatDayLong(slice.day)}`}
                        />
                      </Box>
                    )}
                    <Box sx={{ mt: 1.5 }}>
                      <ActivityRows
                        placed={slice.queued}
                        completed={slice.completed}
                        removed={slice.removed}
                      />
                    </Box>
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
