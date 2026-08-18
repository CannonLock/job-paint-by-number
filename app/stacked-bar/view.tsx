"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import type { StackedBarData } from "./types";
import DayDialog from "./_components/DayDialog";
import JobCalendar from "./_components/JobCalendar";
import PeriodCard from "./_components/PeriodCard";
import {
  ALL_CLUSTERS,
  buildDayActivity,
  buildDayCensus,
  expandSeries,
  type DayActivity,
  type DayCensus,
  type PeriodKey,
} from "./_components/binModel";
import {
  asOfDay,
  buildSliceMap,
  parseDayKey,
  type DayData,
} from "./_components/dayCards";
import { CLUSTER_PARAM, writeClusterParam } from "./_components/urlState";

interface StackedBarViewProps {
  data: StackedBarData;
  /** The day bake, for the calendar's waffles and the dialog's cohort breakdown. */
  dayData: DayData;
}

export default function StackedBarView({ data, dayData }: StackedBarViewProps) {
  const [cluster, setCluster] = useState<string>(ALL_CLUSTERS);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("yesterday");
  // Whether the calendar tiles draw their bars; there is no placed waffle on
  // this page's calendar.
  const [views, setViews] = useState<string[]>(["updates"]);
  const asOf = asOfDay(dayData);
  // Open on the month containing the as-of day: the freshest part of the window.
  const [activeStartDate, setActiveStartDate] = useState<Date>(() => {
    const d = parseDayKey(asOf);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Deep link: ?clusterId=13, same contract as the Sankey page.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(CLUSTER_PARAM);
    if (id && data.series.some((s) => String(s.cluster) === id)) setCluster(id);
  }, [data]);

  const selectCluster = (next: string) => {
    setCluster(next);
    writeClusterParam(next);
  };

  // Two views on purpose: all-jobs shows the MAGNITUDE of state changes per bin
  // (counts), while a single cluster shows its whole cohort as a RATIO that
  // drifts to completed over the days, never dropping a job from view.
  const journeyMode = cluster !== ALL_CLUSTERS;

  const dense = useMemo(() => expandSeries(data, cluster), [data, cluster]);

  // Calendar inputs: per-day cohort slices (day bake) plus one of the two per-day
  // 4-hour derivations, depending on the mode.
  const slices = useMemo(() => buildSliceMap(dayData, cluster), [dayData, cluster]);
  const censuses = useMemo(() => {
    if (!journeyMode) return null;
    const out = new Map<string, DayCensus>();
    data.days.forEach((day, index) => out.set(day, buildDayCensus(data, dense, index, "journey")));
    return out;
  }, [data, dense, journeyMode]);
  const activities = useMemo(() => {
    if (journeyMode) return null;
    const out = new Map<string, DayActivity>();
    data.days.forEach((day, index) => out.set(day, buildDayActivity(data, dense, index)));
    return out;
  }, [data, dense, journeyMode]);

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
          {dayData.counted.toLocaleString()} jobs across {data.series.length} clusters,{" "}
          {clusterLabel}. Every day shows its state changes in 4-hour bins:{" "}
          {journeyMode
            ? "the whole cluster as a ratio, with completed work staying in view so the bars drift toward teal as jobs finish"
            : "how many jobs were placed, completed, or removed in each bin, so a heavy bin towers and a quiet one stays empty"}
          . Click a day for its full breakdown.
        </Typography>
      </Stack>

      <Stack spacing={3}>
        <PeriodCard
          data={data}
          dense={dense}
          journeyMode={journeyMode}
          period={period}
          onPeriodChange={setPeriod}
          onOpenDetail={setOpenDay}
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
              htmlFor="stacked-cluster-select"
              sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}
            >
              Cluster
            </Typography>
            <Select
              id="stacked-cluster-select"
              size="small"
              value={cluster}
              onChange={(event) => selectCluster(String(event.target.value))}
              sx={{ mt: 0.5, minWidth: 260 }}
            >
              <MenuItem value={ALL_CLUSTERS}>All clusters ({data.series.length})</MenuItem>
              {data.series.map((s) => (
                <MenuItem key={s.cluster} value={String(s.cluster)}>
                  Cluster {s.cluster} · {s.total.toLocaleString()} jobs
                </MenuItem>
              ))}
            </Select>
          </Box>

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
              <ToggleButton value="updates" aria-label="Show state changes each day">
                Updates
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Stack>

        <JobCalendar
          slices={slices}
          censuses={censuses}
          activities={activities}
          firstDay={dayData.days[0]}
          lastDay={asOf}
          asOf={asOf}
          activeStartDate={activeStartDate}
          onActiveStartDateChange={setActiveStartDate}
          onSelectDay={setOpenDay}
          showUpdates={views.includes("updates")}
        />
      </Stack>

      <DayDialog
        dayData={dayData}
        barData={data}
        day={openDay}
        cluster={cluster}
        onClusterChange={selectCluster}
        asOf={asOf}
        open={openDay !== null}
        onClose={() => setOpenDay(null)}
      />

      <Typography
        variant="caption"
        component="p"
        sx={{ color: "text.secondary", mt: 4, display: "block" }}
      >
        Bars are cumulative snapshots: a bin shows where the day&apos;s work stands at
        its end, so Completed and Removed only ever grow through the day. Baked{" "}
        {new Date(data.generatedAt).toLocaleString()} ({data.timezone}) from Adstash
        terminal records merged with {data.sources.condorQ.liveAds.toLocaleString()} live
        condor_q ads on {data.sources.condorQ.schedd}.
      </Typography>
    </Box>
  );
}
