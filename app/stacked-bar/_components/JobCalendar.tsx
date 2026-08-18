"use client";

import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import Calendar from "react-calendar";

import "react-calendar/dist/Calendar.css";

import type { DayActivity, DayCensus } from "./binModel";
import { compactNumber, dayKeyOf, isEmptySlice, parseDayKey, type DaySlice } from "./dayCards";
import TileActivityBars from "./TileActivityBars";
import TileBars from "./TileBars";

interface JobCalendarProps {
  slices: Map<string, DaySlice>;
  /**
   * Cluster mode: per-day journey censuses (cumulative, denominator = the whole
   * cluster), keyed like `slices`. Tiles draw the ratio bars and stay alive every
   * day the cluster has jobs, moved or not.
   */
  censuses: Map<string, DayCensus> | null;
  /**
   * All-jobs mode: per-day per-bin state-change counts. Tiles draw count-scaled
   * bars against the visible month's peak bin, so magnitude is the signal.
   */
  activities: Map<string, DayActivity> | null;
  /** First and last day the baked window covers, "YYYY-MM-DD". */
  firstDay: string;
  lastDay: string;
  /** The day everything is read as of; marked in the grid. */
  asOf: string;
  activeStartDate: Date;
  onActiveStartDateChange: (date: Date) => void;
  onSelectDay: (day: string) => void;
}

/**
 * Month grid where each day carries its six 4-hour stacked bars -- the
 * stacked-bar counterpart of the Sankey page's calendar (copied and adapted,
 * not imported). No placed waffle here: placements already appear as the bars'
 * own segments, so the tile is just the chart and its caption.
 */
export default function JobCalendar({
  slices,
  censuses,
  activities,
  firstDay,
  lastDay,
  asOf,
  activeStartDate,
  onActiveStartDateChange,
  onSelectDay,
}: JobCalendarProps) {
  const minDate = parseDayKey(firstDay);
  const maxDate = parseDayKey(lastDay);

  // All-jobs mode: the tallest bin on the visible month anchors every tile's
  // scale, so bar heights compare honestly across days.
  const peakBinTotal = useMemo(() => {
    if (!activities) return 0;
    let peak = 0;
    for (const [day, activity] of activities) {
      const date = parseDayKey(day);
      if (
        date.getFullYear() !== activeStartDate.getFullYear() ||
        date.getMonth() !== activeStartDate.getMonth()
      ) {
        continue;
      }
      for (const bin of activity.bins) if (bin.total > peak) peak = bin.total;
    }
    return peak;
  }, [activities, activeStartDate]);

  return (
    <Box
      sx={{
        "& .react-calendar": {
          width: "100%",
          maxWidth: "none",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          backgroundColor: "background.paper",
          fontFamily: "inherit",
          lineHeight: 1.4,
        },
        // --- navigation ---
        "& .react-calendar__navigation": {
          height: "auto",
          marginBottom: 0,
          borderBottom: "1px solid",
          borderColor: "divider",
        },
        "& .react-calendar__navigation button": {
          minWidth: 44,
          padding: "10px 6px",
          background: "none",
          fontSize: "1rem",
          fontWeight: 600,
          color: "text.primary",
        },
        "& .react-calendar__navigation button:disabled": { color: "text.disabled" },
        "& .react-calendar__navigation button:enabled:hover, & .react-calendar__navigation button:enabled:focus":
          { backgroundColor: "action.hover" },
        // --- weekday header ---
        "& .react-calendar__month-view__weekdays": {
          fontSize: "0.7rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "text.secondary",
          paddingTop: "6px",
        },
        "& .react-calendar__month-view__weekdays__weekday": { padding: "4px 6px" },
        "& .react-calendar__month-view__weekdays abbr": { textDecoration: "none" },
        // --- day tiles ---
        "& .react-calendar__tile": {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "4px",
          // Tall enough for the date, the bars slot, and its caption -- there is
          // no waffle row on this calendar.
          minHeight: 136,
          padding: "6px 4px",
          border: "1px solid",
          borderColor: "divider",
          background: "none",
          fontSize: "0.75rem",
          color: "text.primary",
          overflow: "hidden",
        },
        "& .react-calendar__tile:enabled:hover, & .react-calendar__tile:enabled:focus": {
          backgroundColor: "action.hover",
        },
        "& .react-calendar__tile:disabled": {
          backgroundColor: "transparent",
          color: "text.disabled",
        },
        "& .react-calendar__month-view__days__day--neighboringMonth": { opacity: 0.35 },
        // The as-of day is marked instead of the browser's own current date; the
        // baked window ends whenever the data was built.
        "& .react-calendar__tile--now": { backgroundColor: "transparent" },
        "& .react-calendar__tile--active": { backgroundColor: "transparent" },
        "& .react-calendar__tile.day-as-of": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: "-2px",
        },
      }}
    >
      <Calendar
        view="month"
        minDetail="month"
        maxDetail="month"
        activeStartDate={activeStartDate}
        onActiveStartDateChange={({ activeStartDate: next }) => {
          if (next) onActiveStartDateChange(next);
        }}
        minDate={minDate}
        maxDate={maxDate}
        value={null}
        onClickDay={(date) => onSelectDay(dayKeyOf(date))}
        tileClassName={({ date, view }) =>
          view === "month" && dayKeyOf(date) === asOf ? "day-as-of" : null
        }
        tileDisabled={({ date }) => {
          const key = dayKeyOf(date);
          // Cluster mode: a day is alive whenever the cluster has jobs in view,
          // even if nothing moved -- persistence is the point.
          if (censuses) {
            return !censuses.get(key)?.hasData && isEmptySlice(slices.get(key));
          }
          return isEmptySlice(slices.get(key));
        }}
        tileContent={({ date, view }) => {
          if (view !== "month") return null;
          const key = dayKeyOf(date);
          return (
            <TileBody
              slice={slices.get(key)}
              census={censuses?.get(key)}
              activity={activities?.get(key)}
              peakBinTotal={peakBinTotal}
            />
          );
        }}
      />
    </Box>
  );
}

/**
 * Fixed height for every tile's bars. Deliberately not scaled by how many jobs
 * moved: the bars are percentages, and a uniform canvas keeps the six-bin shape
 * legible on every day. The "N changed" caption carries the magnitude.
 */
const BARS_SLOT = 88;

const TILE_CAPTION = {
  fontSize: "0.64rem",
  fontWeight: 700,
  lineHeight: 1.3,
  textAlign: "center",
  whiteSpace: "nowrap",
} as const;

function TileBody({
  slice,
  census,
  activity,
  peakBinTotal,
}: {
  slice: DaySlice | undefined;
  census: DayCensus | undefined;
  activity: DayActivity | undefined;
  peakBinTotal: number;
}) {
  if (!slice) return null;

  // Cluster mode shows the census whenever jobs are in view, moved or not;
  // all-jobs mode shows the magnitude bars only when something changed. No
  // placed waffle on this calendar -- placements already appear as the bars'
  // Placed/Became Active segments.
  const barsVisible = census ? census.hasData : !!activity?.hasData;
  if (!barsVisible) {
    if (slice.queued === 0 && slice.changed === 0) return null;
    return (
      <Typography
        component="span"
        sx={{ fontSize: "0.68rem", color: "text.secondary", lineHeight: 1.3, mt: "auto", mb: "auto" }}
      >
        <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
          {slice.changed > 0
            ? `${compactNumber(slice.changed)} changed`
            : `${compactNumber(slice.queued)} placed`}
        </Box>
      </Typography>
    );
  }

  return (
    <>
      <Box
        sx={{
          width: "100%",
          height: BARS_SLOT,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        <Box sx={{ width: "100%", maxWidth: 104, minWidth: 0 }}>
          {census ? (
            <TileBars
              bins={census.bins}
              height={BARS_SLOT}
              label={`${compactNumber(slice.changed)} jobs changed state`}
            />
          ) : (
            activity && (
              <TileActivityBars
                bins={activity.bins}
                peakBinTotal={peakBinTotal}
                height={BARS_SLOT}
                label={`${compactNumber(activity.total)} state changes`}
              />
            )
          )}
        </Box>
      </Box>

      <Typography component="span" sx={TILE_CAPTION}>
        {compactNumber(slice.changed)} changed
      </Typography>
    </>
  );
}
