"use client";

import { Alert, Box, Button, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";

import type { PeriodKey, PeriodSummary } from "./dayModel";
import { PERIOD_OPTIONS, formatDayLong, formatDayShort, hasFlow } from "./dayModel";
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
 * The landing summary: what moved over a trailing period. First thing a user wants
 * on opening the page, before going hunting through the month.
 *
 * The period ends on the last complete day rather than the as-of day, since the
 * as-of day is still in progress and would understate every count.
 */
export default function PeriodCard({
  summary,
  period,
  onPeriodChange,
  onOpenDetail,
}: PeriodCardProps) {
  const moved = summary ? summary.transitions : 0;

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
                  variant="full"
                  height={220}
                  // Over a multi-day period "today" is no longer one day, so the two
                  // source nodes mean "placed on the day it moved" and "placed before
                  // that day" instead.
                  sameDayLabels={summary.days.length > 1}
                  label={`State changes over ${rangeLabel(summary)}`}
                />
              ) : (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Flow data needs a rebuild — run <code>node scripts/build-day-data.mjs</code>.
                </Alert>
              )}
            </Box>

            <Box sx={{ flexShrink: 0, minWidth: { md: 260 } }}>
              <Typography variant="body2" sx={{ mb: 0.75 }}>
                <Box component="span" sx={{ fontWeight: 700 }}>
                  {summary.distinctChanged !== null
                    ? summary.distinctChanged.toLocaleString()
                    : moved.toLocaleString()}
                </Box>{" "}
                <Box component="span" sx={{ color: "text.secondary" }}>
                  {summary.distinctChanged !== null
                    ? "jobs changed state, broken down as:"
                    : "state changes, broken down as:"}
                </Box>
              </Typography>
              <ActivityRows
                started={summary.started}
                completed={summary.completed}
                removed={summary.removed}
              />
              <Typography
                variant="caption"
                component="p"
                sx={{ color: "text.secondary", mt: 1, fontStyle: "italic" }}
              >
                {summary.distinctChanged !== null
                  ? `A job that did more than one thing appears on more than one line, so these add up to more than ${summary.distinctChanged.toLocaleString()}.`
                  : "Counts transitions, not jobs: one job moving on several days counts each time."}
              </Typography>

              {/* Legend for the flow, including the two carried-in states that have
                  no equivalent in the waffle's four-state palette. */}
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
                    gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))",
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
