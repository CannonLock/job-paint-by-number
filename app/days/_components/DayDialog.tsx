"use client";

import { useMemo } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import Close from "@mui/icons-material/Close";

import type { StackedBarData } from "../types";
import { buildDayActivity, buildDayCensus, expandSeries } from "./binModel";
import {
  buildSliceMap,
  compactNumber,
  formatDayLong,
  formatDayShort,
  type DayData,
} from "./dayCards";
import {
  ALL_GROUPS,
  GROUP_BY_LABELS,
  clusterFilterFor,
  type BatchInfo,
  type GroupBy,
} from "./grouping";
import DayActivityBars from "./DayActivityBars";
import DayStackedBars from "./DayStackedBars";
import { ActivityRows } from "./StateRows";

interface DayDialogProps {
  /** Cohort/activity source (day-cards bake). */
  dayData: DayData;
  /** 4-hour bin source (stacked-bars bake). */
  barData: StackedBarData;
  /** The day being inspected, or null when the dialog is closed. */
  day: string | null;
  /** Which grouping the page is using; the dialog offers the same one. */
  groupBy: GroupBy;
  /** The page-level selection; the dialog is scoped to it. */
  selection: string;
  /** Change the page-level selection, so the two selects can never disagree. */
  onSelectionChange: (selection: string) => void;
  /** Batch membership, for grouping this day's clusters into batches. */
  batches?: BatchInfo[];
  /** The day everything is read as of. */
  asOf: string;
  open: boolean;
  onClose: () => void;
}

/** What one group did on the dialog's day, for the select's option labels. */
interface DayGroupEntry {
  id: string;
  label: string;
  placed: number;
  changed: number;
}

function optionLabel(entry: DayGroupEntry): string {
  const parts: string[] = [];
  if (entry.placed > 0) parts.push(`${compactNumber(entry.placed)} placed`);
  if (entry.changed > 0) parts.push(`${compactNumber(entry.changed)} changed`);
  return parts.length > 0 ? `${entry.label} · ${parts.join(", ")}` : entry.label;
}

/**
 * Centred per-day breakdown: where that day's cohort stands, and how the day's
 * work resolved bin by bin.
 */
export default function DayDialog({
  dayData,
  barData,
  day,
  groupBy,
  selection,
  onSelectionChange,
  batches,
  asOf,
  open,
  onClose,
}: DayDialogProps) {
  // Clusters that are part of this day: a cohort placed on it, or any activity.
  const dayClusters = useMemo(() => {
    const byId = new Map<string, { placed: number; changed: number }>();
    if (!day) return byId;
    const entry = (id: number) => {
      const key = String(id);
      let e = byId.get(key);
      if (!e) byId.set(key, (e = { placed: 0, changed: 0 }));
      return e;
    };
    for (const cohort of dayData.cohorts) {
      if (cohort.day === day && cohort.queued > 0) entry(cohort.cluster).placed += cohort.queued;
    }
    for (const row of dayData.activity) {
      if (row.day === day) entry(row.cluster).changed += row.changed;
    }
    return byId;
  }, [dayData, day]);

  // The same day's clusters, rolled up into whichever grouping the page is using.
  // A batch appears only if at least one of its clusters took part, and carries the
  // summed figures for the ones that did.
  const dayGroups = useMemo<DayGroupEntry[]>(() => {
    if (groupBy === "batch") {
      const out: DayGroupEntry[] = [];
      for (const batch of batches ?? []) {
        let placed = 0;
        let changed = 0;
        let present = false;
        for (const member of batch.clusters) {
          const stats = dayClusters.get(String(member));
          if (!stats) continue;
          present = true;
          placed += stats.placed;
          changed += stats.changed;
        }
        if (present) out.push({ id: batch.id, label: batch.name, placed, changed });
      }
      return out.sort((a, b) => b.changed - a.changed || b.placed - a.placed);
    }
    return [...dayClusters.entries()]
      .map(([id, stats]) => ({ id, label: `Cluster ${id}`, ...stats }))
      .sort((a, b) => Number(a.id) - Number(b.id));
  }, [dayClusters, groupBy, batches]);

  // A page-level selection that plays no part in this day falls back to everything
  // rather than presenting an empty breakdown.
  const effective =
    selection !== ALL_GROUPS && !dayGroups.some((g) => g.id === selection)
      ? ALL_GROUPS
      : selection;

  const filter = useMemo(
    () => clusterFilterFor(barData.series, batches, groupBy, effective),
    [barData.series, batches, groupBy, effective],
  );

  const slice = useMemo(
    () => (day ? (buildSliceMap(dayData, filter).get(day) ?? null) : null),
    [dayData, filter, day],
  );

  // The day's six-bin derivation for the same scope: the whole-cohort ratio census
  // for one group, per-bin change counts for everything.
  const journeyMode = filter !== null;
  const { census, activity } = useMemo(() => {
    if (!day) return { census: null, activity: null };
    const dayIndex = barData.days.indexOf(day);
    if (dayIndex < 0) return { census: null, activity: null };
    const dense = expandSeries(barData, filter);
    return journeyMode
      ? { census: buildDayCensus(barData, dense, dayIndex, "journey"), activity: null }
      : { census: null, activity: buildDayActivity(barData, dense, dayIndex) };
  }, [barData, filter, journeyMode, day]);

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
                  htmlFor="days-day-group-select"
                  sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}
                >
                  {GROUP_BY_LABELS[groupBy]}
                </Typography>
                <Select
                  id="days-day-group-select"
                  size="small"
                  value={effective}
                  onChange={(event) => onSelectionChange(String(event.target.value))}
                  sx={{ mt: 0.5, minWidth: 260 }}
                >
                  <MenuItem value={ALL_GROUPS}>
                    {groupBy === "batch"
                      ? `All batches on this day (${dayGroups.length})`
                      : `All clusters on this day (${dayGroups.length})`}
                  </MenuItem>
                  {dayGroups.map((group) => (
                    <MenuItem key={group.id} value={group.id}>
                      {optionLabel(group)}
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
                        {census.finishedAt !== null && (
                          <Typography
                            variant="caption"
                            component="p"
                            sx={{ color: "text.secondary", mt: 0.5, fontStyle: "italic" }}
                          >
                            The cluster&apos;s last job reached a final state in the{" "}
                            {census.bins[census.finishedAt].label} window, so the rest of the
                            day is left blank rather than repeating an all-finished bar.
                          </Typography>
                        )}
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
                      Counts every transition, so a job that did more than one thing this day
                      appears on more than one line. The calendar counts jobs instead:{" "}
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
