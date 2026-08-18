"use client";

import { useMemo } from "react";
import { Box, Button, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";

import type { StackedBarData } from "../types";
import {
  PERIOD_OPTIONS,
  buildDayActivity,
  buildDayCensus,
  buildPeriodActivity,
  buildPeriodCensus,
  formatDayLong,
  formatDayShort,
  slicePeriod,
  type DenseSeries,
  type PeriodKey,
} from "./binModel";
import DayActivityBars from "./DayActivityBars";
import DayStackedBars from "./DayStackedBars";
import { ActivityRows } from "./StateRows";

interface PeriodCardProps {
  data: StackedBarData;
  /** The selected clusters' summed series, as expanded by the page. */
  dense: DenseSeries;
  /** Cluster mode draws the journey ratio; all-jobs draws change magnitudes. */
  journeyMode: boolean;
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
  /** Open the day dialog; only offered when the period is a single day. */
  onOpenDetail: (day: string) => void;
}

function rangeLabel(days: string[]): string {
  if (days.length === 1) return formatDayLong(days[0]);
  return `${formatDayShort(days[0])} – ${formatDayShort(days[days.length - 1])}`;
}

/**
 * The landing summary: what moved over a trailing period -- the stacked-bar
 * counterpart of the Sankey page's period card (copied and adapted, not
 * imported). Yesterday keeps its 4-hour bins; a week or month coarsens to one
 * bar per day, magnitude in all-jobs mode and the whole-cluster ratio in
 * cluster mode. The period ends on the last complete day rather than the as-of
 * day, since the as-of day is still in progress and would understate every count.
 */
export default function PeriodCard({
  data,
  dense,
  journeyMode,
  period,
  onPeriodChange,
  onOpenDetail,
}: PeriodCardProps) {
  const model = useMemo(() => {
    const slice = slicePeriod(data, period);
    if (!slice) return null;
    const single = slice.days.length === 1;

    // Totals always come from the activity deltas -- in journey mode the census
    // is cumulative from the window start, which is not "this period's changes".
    const totals = single
      ? (() => {
          const day = buildDayActivity(data, dense, slice.endIndex);
          return {
            placed: day.bins.reduce((sum, bin) => sum + bin.placed, 0),
            completed: day.bins.reduce((sum, bin) => sum + bin.completed, 0),
            removed: day.bins.reduce((sum, bin) => sum + bin.removed, 0),
          };
        })()
      : (() => {
          const activity = buildPeriodActivity(data, dense, slice);
          return {
            placed: activity.bins.reduce((sum, bin) => sum + bin.placed, 0),
            completed: activity.bins.reduce((sum, bin) => sum + bin.completed, 0),
            removed: activity.bins.reduce((sum, bin) => sum + bin.removed, 0),
          };
        })();

    const censusBins = journeyMode
      ? single
        ? buildDayCensus(data, dense, slice.endIndex, "journey").bins
        : buildPeriodCensus(data, dense, slice).bins
      : null;
    const activityBins = journeyMode
      ? null
      : single
        ? buildDayActivity(data, dense, slice.endIndex).bins
        : buildPeriodActivity(data, dense, slice).bins;

    return { slice, single, totals, censusBins, activityBins };
  }, [data, dense, journeyMode, period]);

  const moved = model ? model.totals.placed + model.totals.completed + model.totals.removed : 0;
  const xTitle = model?.single ? "Hour of day" : "Day";

  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 2, sm: 2.5 }, borderColor: "primary.main", borderWidth: 2 }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            What happened
          </Typography>
          <Select
            size="small"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value as PeriodKey)}
            aria-label="Summary period"
            sx={{ fontWeight: 700 }}
          >
            {PERIOD_OPTIONS.map((option) => (
              <MenuItem key={option.key} value={option.key}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
          {model && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {rangeLabel(model.slice.days)}
              {model.slice.truncated && " · limited by the baked window"}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {model?.single && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => onOpenDetail(model.slice.days[0])}
            >
              See the full day
            </Button>
          )}
        </Stack>

        {!model || moved === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No jobs changed state.
          </Typography>
        ) : (
          <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 2, md: 3 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {model.censusBins ? (
                <DayStackedBars
                  bins={model.censusBins}
                  height={220}
                  xTitle={xTitle}
                  label={`Share of the cluster's jobs active, completed, and removed over ${rangeLabel(model.slice.days)}`}
                />
              ) : (
                model.activityBins && (
                  <DayActivityBars
                    bins={model.activityBins}
                    height={220}
                    xTitle={xTitle}
                    label={`State changes over ${rangeLabel(model.slice.days)}`}
                  />
                )
              )}
            </Box>

            <Box sx={{ flexShrink: 0, minWidth: { md: 260 } }}>
              <Typography variant="body2" sx={{ mb: 0.75 }}>
                <Box component="span" sx={{ fontWeight: 700 }}>
                  {moved.toLocaleString()}
                </Box>{" "}
                <Box component="span" sx={{ color: "text.secondary" }}>
                  state changes, broken down as:
                </Box>
              </Typography>
              <ActivityRows
                placed={model.totals.placed}
                completed={model.totals.completed}
                removed={model.totals.removed}
              />
              <Typography
                variant="caption"
                component="p"
                sx={{ color: "text.secondary", mt: 1, fontStyle: "italic" }}
              >
                Counts transitions, not jobs: one job placed and finished inside the
                period counts on two lines.
              </Typography>
            </Box>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
