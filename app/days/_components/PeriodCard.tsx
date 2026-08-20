"use client";

import { Alert, Box, Button, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";

import {
  PERIOD_OPTIONS,
  formatDayLong,
  formatDayShort,
  hasFlow,
  type PeriodKey,
  type PeriodSummary,
} from "./dayCards";
import { ActivityRows } from "./StateRows";
import StateFlowSankey, { FLOW_LEGEND } from "./StateFlowSankey";

interface PeriodCardProps {
  summary: PeriodSummary | null;
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
  onOpenDetail: () => void;
}

function rangeLabel(summary: PeriodSummary): string {
  if (summary.days.length === 1) return formatDayLong(summary.days[0]);
  return `${formatDayShort(summary.days[0])} – ${formatDayShort(summary.days[summary.days.length - 1])}`;
}

/**
 * The landing summary: what moved over a trailing period, as a Sankey. First
 * thing a user wants on opening the page, before going hunting through the month.
 *
 * The period ends on the last complete day rather than the as-of day, since the
 * as-of day is still in progress and would understate every count.
 *
 * The diagram is the Sankey page's, with Placed folded into Active -- so the
 * three states here are exactly the three the calendar below paints, and the
 * page never asks the reader to hold two different state models at once.
 */
export default function PeriodCard({
  summary,
  period,
  onPeriodChange,
  onOpenDetail,
}: PeriodCardProps) {
  const moved = summary ? summary.transitions : 0;
  const multiDay = !!summary && summary.days.length > 1;

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
          {summary && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {rangeLabel(summary)}
              {summary.truncated && " · limited by the baked window"}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {summary && summary.days.length === 1 && (
            <Button variant="outlined" size="small" onClick={onOpenDetail}>
              See the full day
            </Button>
          )}
        </Stack>

        {!summary || moved === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No jobs changed state.
          </Typography>
        ) : (
          <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 2, md: 3 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {hasFlow(summary.flows) ? (
                <StateFlowSankey
                  flows={summary.flows}
                  carry={summary.carry}
                  height={220}
                  multiDay={multiDay}
                  label={`State changes over ${rangeLabel(summary)}`}
                />
              ) : (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Flow data needs a rebuild — run <code>node scripts/build-day-data.mjs</code>.
                </Alert>
              )}
            </Box>

            {/*
              Fixed width, not flexShrink with a minimum. A shrink-proof column
              sized by its content takes its longest line as its base width, so
              one long sentence in here silently squeezed the diagram beside it
              down to zero pixels.
            */}
            <Box sx={{ flexShrink: 0, width: { md: 272 } }}>
              <Typography variant="body2" sx={{ mb: 0.75 }}>
                <Box component="span" sx={{ fontWeight: 700 }}>
                  {moved.toLocaleString()}
                </Box>{" "}
                <Box component="span" sx={{ color: "text.secondary" }}>
                  state changes, broken down as:
                </Box>
              </Typography>
              <ActivityRows
                placed={summary.placed}
                completed={summary.completed}
                removed={summary.removed}
              />
              <Typography
                variant="caption"
                component="p"
                sx={{ color: "text.secondary", mt: 1, fontStyle: "italic" }}
              >
                Counts transitions, not jobs: a job placed and finished inside the period
                counts on two lines.
                {summary.distinctChanged !== null &&
                  ` ${summary.distinctChanged.toLocaleString()} distinct ${
                    summary.distinctChanged === 1 ? "job" : "jobs"
                  } moved.`}
              </Typography>

              {/* Legend for the flow, including the carried-in state that has no
                  equivalent in the waffle's three-state palette. */}
              <Box sx={{ mt: 2 }}>
                <Typography
                  variant="overline"
                  component="p"
                  sx={{ color: "text.secondary", lineHeight: 1.6 }}
                >
                  Flow key
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                    columnGap: 1.5,
                    rowGap: 0.5,
                    mt: 0.5,
                  }}
                >
                  {FLOW_LEGEND.map((entry) => (
                    <Stack key={entry.label} direction="row" spacing={0.75} alignItems="center">
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "2px",
                          backgroundColor: entry.color,
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {entry.label}
                      </Typography>
                    </Stack>
                  ))}
                </Box>
              </Box>
            </Box>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
