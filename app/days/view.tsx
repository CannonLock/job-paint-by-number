"use client";

import { useMemo, useState } from "react";
import {
  Box,
  Button,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import Link from "next/link";

import type { DayData } from "./types";
import DayDialog from "./_components/DayDialog";
import JobCalendar from "./_components/JobCalendar";
import MonthSummary from "./_components/MonthSummary";
import YesterdayCard from "./_components/YesterdayCard";
import {
  ALL_CLUSTERS,
  asOfDay,
  buildSliceMap,
  formatDayShort,
  monthRollup,
  parseDayKey,
  previousDay,
} from "./_components/dayModel";

interface DaysViewProps {
  data: DayData;
}

export default function DaysView({ data }: DaysViewProps) {
  const asOf = asOfDay(data);
  const yesterday = previousDay(data);

  const [cluster, setCluster] = useState<string>(ALL_CLUSTERS);
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Which of the two per-day graphics the calendar draws. Both on by default;
  // turning one off gives the other the full width of a tile.
  const [views, setViews] = useState<string[]>(["placed", "updates"]);
  // Open on the month containing the as-of day: the part of the window with the
  // freshest activity.
  const [activeStartDate, setActiveStartDate] = useState<Date>(() => {
    const d = parseDayKey(asOf);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const slices = useMemo(() => buildSliceMap(data, cluster), [data, cluster]);

  const rollup = useMemo(
    () => monthRollup(slices, activeStartDate.getFullYear(), activeStartDate.getMonth()),
    [slices, activeStartDate],
  );

  const monthLabel = activeStartDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const clusterLabel = cluster === ALL_CLUSTERS ? "all clusters" : `cluster ${cluster}`;

  return (
    <Box
      component="main"
      sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 }, maxWidth: 1100, mx: "auto" }}
    >
      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          What happened to {data.owner}&apos;s jobs
        </Typography>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          {data.counted.toLocaleString()} jobs across {data.clusters.length} clusters,{" "}
          {clusterLabel}. Every day shows the jobs placed that day, coloured by where they
          stand as of {formatDayShort(asOf)}. Click a day for its full breakdown.
        </Typography>
      </Stack>

      <Stack spacing={3}>
        <YesterdayCard
          slice={yesterday ? (slices.get(yesterday) ?? null) : null}
          onOpenDetail={() => yesterday && setOpenDay(yesterday)}
        />

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ xs: "stretch", sm: "flex-end" }}
        >
          <Box>
            <Typography
              variant="overline"
              component="label"
              htmlFor="cluster-select"
              sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}
            >
              Cluster
            </Typography>
            <Select
              id="cluster-select"
              size="small"
              value={cluster}
              onChange={(event) => setCluster(String(event.target.value))}
              sx={{ mt: 0.5, minWidth: 260 }}
            >
              <MenuItem value={ALL_CLUSTERS}>All clusters ({data.clusters.length})</MenuItem>
              {data.clusters.map((c) => (
                <MenuItem key={c.id} value={String(c.id)}>
                  Cluster {c.id} · {c.total.toLocaleString()} jobs
                </MenuItem>
              ))}
            </Select>
          </Box>

          {/*
            The calendar filters in place; the per-cluster runtime, hold and resource
            analysis is a route of its own so it can be linked and so its baked JSON
            only loads when asked for.
          */}
          {cluster !== ALL_CLUSTERS && (
            <Button
              component={Link}
              href={`/days/cluster/${cluster}`}
              variant="outlined"
              size="medium"
              endIcon={<ArrowForwardIcon />}
            >
              Cluster {cluster} detail
            </Button>
          )}

          <Box sx={{ ml: { sm: "auto" } }}>
            <Typography
              variant="overline"
              component="p"
              sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}
            >
              Show in calendar
            </Typography>
            <ToggleButtonGroup
              size="small"
              value={views}
              onChange={(_, next: string[]) => setViews(next)}
              aria-label="Which graphics to draw on each day"
              sx={{ mt: 0.5 }}
            >
              <ToggleButton value="placed" aria-label="Show jobs placed each day">
                Placed
              </ToggleButton>
              <ToggleButton value="updates" aria-label="Show state changes each day">
                Updates
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Stack>

        <MonthSummary
          rollup={rollup}
          monthLabel={monthLabel}
          asOfLabel={formatDayShort(asOf)}
        />

        <JobCalendar
          slices={slices}
          firstDay={data.days[0]}
          lastDay={asOf}
          asOf={asOf}
          activeStartDate={activeStartDate}
          onActiveStartDateChange={setActiveStartDate}
          onSelectDay={setOpenDay}
          showPlaced={views.includes("placed")}
          showUpdates={views.includes("updates")}
        />
      </Stack>

      <DayDialog
        slice={openDay ? (slices.get(openDay) ?? null) : null}
        asOf={asOf}
        open={openDay !== null}
        onClose={() => setOpenDay(null)}
      />

      <Typography
        variant="caption"
        component="p"
        sx={{ color: "text.secondary", mt: 4, display: "block" }}
      >
        Baked {new Date(data.generatedAt).toLocaleString()} ({data.timezone}) from{" "}
        {data.sources.adstash.terminalRecords.toLocaleString()} Adstash terminal records
        and {data.sources.condorQ.stillQueued.toLocaleString()} live condor_q ads on{" "}
        {data.sources.condorQ.schedd}. &ldquo;Today&rdquo; is {formatDayShort(asOf)}, the last
        day in the baked window. Hold is not shown: the history records carry no hold data
        for these jobs.
      </Typography>
    </Box>
  );
}
