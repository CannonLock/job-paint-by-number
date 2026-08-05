"use client";

import { Box, Paper, Stack, Typography } from "@mui/material";

import { STATE_ORDER, STATE_STYLES } from "./palette";
import type { MonthRollup } from "./dayModel";

interface MonthSummaryProps {
  rollup: MonthRollup;
  monthLabel: string;
  asOfLabel: string;
}

/**
 * Breakdown of the jobs queued during the displayed month, and where they stand
 * today. Sits above the calendar and doubles as its legend -- four states on
 * screen means a legend is not optional, and pairing each colour with its count
 * here keeps colour from being the only carrier of meaning.
 */
export default function MonthSummary({ rollup, monthLabel, asOfLabel }: MonthSummaryProps) {
  const { queued, stateAsOf } = rollup;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={{ xs: 2, md: 4 }}
        alignItems={{ xs: "flex-start", md: "center" }}
      >
        <Box sx={{ minWidth: 180 }}>
          <Typography
            variant="overline"
            component="h2"
            sx={{ color: "text.secondary", lineHeight: 1.6, display: "block" }}
          >
            Queued in {monthLabel}
          </Typography>
          <Typography variant="h4" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {queued.toLocaleString()}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {queued === 0 ? "no jobs submitted" : `status as of ${asOfLabel}`}
          </Typography>
        </Box>

        {queued > 0 && (
          <Stack
            direction="row"
            spacing={{ xs: 2, sm: 3 }}
            flexWrap="wrap"
            useFlexGap
            sx={{ flex: 1 }}
          >
            {STATE_ORDER.map((state, i) => {
              const value = stateAsOf[i];
              const share = queued > 0 ? (value / queued) * 100 : 0;
              return (
                <Box key={state} sx={{ minWidth: 104 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "2px",
                        backgroundColor: STATE_STYLES[state].color,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {STATE_STYLES[state].label}
                    </Typography>
                  </Stack>
                  <Typography variant="h6" component="p" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                    {value.toLocaleString()}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {value === 0 ? "—" : share < 0.1 ? "<0.1%" : `${share.toFixed(share < 10 ? 1 : 0)}%`}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
