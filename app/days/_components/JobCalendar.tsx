"use client";

import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import Calendar from "react-calendar";

import "react-calendar/dist/Calendar.css";

import type { DaySlice } from "../types";
import JobGrid from "./JobGrid";
import StateFlowSankey, { relativeFlowHeight } from "./StateFlowSankey";
import {
  asOfDay,
  compactNumber,
  dayKeyOf,
  hasFlow,
  isEmptySlice,
  parseDayKey,
} from "./dayModel";

interface JobCalendarProps {
  slices: Map<string, DaySlice>;
  /** First and last day the baked window covers, "YYYY-MM-DD". */
  firstDay: string;
  lastDay: string;
  /** The day everything is read as of; marked in the grid. */
  asOf: string;
  activeStartDate: Date;
  onActiveStartDateChange: (date: Date) => void;
  onSelectDay: (day: string) => void;
  /** Show the waffle of jobs placed that day. */
  showPlaced: boolean;
  /** Show the Sankey of that day's state changes. */
  showUpdates: boolean;
}

/**
 * Month grid where each day carries its own waffle of the jobs queued that day,
 * coloured by where those jobs stand today.
 *
 * react-calendar ships a compact stylesheet built for plain date picking, so the
 * tiles are restyled here to hold a 10x10 grid plus a count. Overrides live in sx
 * rather than a CSS file so they can read the MUI theme and stay next to the
 * component they belong to.
 */
export default function JobCalendar({
  slices,
  firstDay,
  lastDay,
  asOf,
  activeStartDate,
  onActiveStartDateChange,
  onSelectDay,
  showPlaced,
  showUpdates,
}: JobCalendarProps) {
  const minDate = parseDayKey(firstDay);
  const maxDate = parseDayKey(lastDay);

  // Busiest day in the month on screen. Tile heights are scaled against this, so
  // one diagram always fills its slot and the rest read in proportion to it --
  // otherwise a quiet month would draw every day as an identical stub.
  const { peakChanged, quietestChanged } = useMemo(() => {
    let peak = 0;
    let quietest = Infinity;
    for (const slice of slices.values()) {
      const date = parseDayKey(slice.day);
      if (
        date.getFullYear() !== activeStartDate.getFullYear() ||
        date.getMonth() !== activeStartDate.getMonth() ||
        slice.changed <= 0
      ) {
        continue;
      }
      if (slice.changed > peak) peak = slice.changed;
      if (slice.changed < quietest) quietest = slice.changed;
    }
    return { peakChanged: peak, quietestChanged: Number.isFinite(quietest) ? quietest : 0 };
  }, [slices, activeStartDate]);

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
          // Tall enough for the stack: flow slot, its caption, the waffle, its
          // caption. Content is top-aligned so every tile's rows line up.
          minHeight: { xs: 180, sm: 216 },
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
        // Days outside the visible month: keep the grid rectangular, recede.
        "& .react-calendar__month-view__days__day--neighboringMonth": { opacity: 0.35 },
        // react-calendar marks the browser's own current date. That is not the day
        // this page reads as of -- the baked window ends whenever the data was
        // built -- so its marker is neutralised and the as-of day is marked
        // instead, below. Otherwise the outline lands on a disabled tile past
        // maxDate the day after a bake.
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
        // Locked to month view: the waffles only mean anything per day.
        view="month"
        minDetail="month"
        maxDetail="month"
        activeStartDate={activeStartDate}
        onActiveStartDateChange={({ activeStartDate: next }) => {
          if (next) onActiveStartDateChange(next);
        }}
        minDate={minDate}
        maxDate={maxDate}
        // Selection is expressed by the dialog, not by a painted tile.
        value={null}
        onClickDay={(date) => onSelectDay(dayKeyOf(date))}
        tileClassName={({ date, view }) =>
          view === "month" && dayKeyOf(date) === asOf ? "day-as-of" : null
        }
        tileDisabled={({ date }) => isEmptySlice(slices.get(dayKeyOf(date)))}
        tileContent={({ date, view }) => {
          if (view !== "month") return null;
          const slice = slices.get(dayKeyOf(date));
          return (
            <TileBody
              slice={slice}
              showPlaced={showPlaced}
              showUpdates={showUpdates}
              peakChanged={peakChanged}
              quietestChanged={quietestChanged}
            />
          );
        }}
      />
    </Box>
  );
}

/**
 * What sits under the date number in each tile: the waffle and the queued count
 * when jobs were submitted that day.
 *
 * Days with no submissions but plenty of churn get a one-line note instead of an
 * empty grid -- most days in a window look like this, and rendering 100 blank
 * boxes on each would read as "nothing happened" when in fact hundreds of
 * thousands of jobs changed state.
 */
/**
 * Fixed vertical space reserved for the flow. The diagram is drawn shorter than
 * this when the day is quiet, but the slot never shrinks -- that is what keeps the
 * caption below it on a constant line across every tile.
 */
const SANKEY_SLOT = 88;

/**
 * Height the quietest day on the page renders at. Low enough that the log scale has
 * real range against the 88px peak, but tall enough that the diagram still reads as
 * three ranks of ribbons rather than a smudge.
 */
const SANKEY_MIN = 20;

const TILE_CAPTION = {
  fontSize: "0.64rem",
  fontWeight: 700,
  lineHeight: 1.3,
  textAlign: "center",
  whiteSpace: "nowrap",
} as const;

function TileBody({
  slice,
  showPlaced,
  showUpdates,
  peakChanged,
  quietestChanged,
}: {
  slice: DaySlice | undefined;
  showPlaced: boolean;
  showUpdates: boolean;
  /** Busiest day currently on screen; anchors the top of the tile scale. */
  peakChanged: number;
  /** Quietest non-empty day on screen; anchors the bottom. */
  quietestChanged: number;
}) {
  if (!slice) return null;

  const placedVisible = showPlaced && slice.queued > 0;
  // Held as a value rather than a boolean so the type predicate narrows below.
  const flows = showUpdates && hasFlow(slice.flows) ? slice.flows : null;
  const flowVisible = flows !== null;
  if (!placedVisible && !flowVisible) {
    // slice.changed is distinct jobs, not a sum of the transition lines -- a job
    // that ran and finished today counts once here and twice in the day detail.
    if (slice.queued === 0 && slice.changed === 0) return null;
    return (
      <Typography
        component="span"
        sx={{ fontSize: "0.68rem", color: "text.secondary", lineHeight: 1.3, mt: "auto", mb: "auto" }}
      >
        {slice.queued > 0 ? (
          <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
            {compactNumber(slice.queued)} placed
          </Box>
        ) : (
          <>
            none placed
            <Box component="span" sx={{ display: "block", fontWeight: 700, color: "text.primary" }}>
              {compactNumber(slice.changed)} changed
            </Box>
          </>
        )}
      </Typography>
    );
  }

  return (
    <>
      {/*
        Stacked, not side by side: flow on top, then its caption, then the waffle.
        The flow lives in a fixed-height slot and hangs from the top of it, so its
        log-scaled height varies while the caption underneath stays on the same line
        in every tile -- which is what makes the heights comparable down a column.
      */}
      {flows && (
        <Box
          sx={{
            width: "100%",
            height: SANKEY_SLOT,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
          }}
        >
          <Box sx={{ width: "100%", maxWidth: 104, minWidth: 0 }}>
            <StateFlowSankey
              flows={flows}
              carry={slice.carry}
              variant="tile"
              // Tiles show what moved that day; unchanged backlog would drown it.
              changesOnly
              height={relativeFlowHeight(
                slice.changed,
                quietestChanged,
                peakChanged,
                SANKEY_MIN,
                SANKEY_SLOT,
              )}
              label={`${compactNumber(slice.changed)} jobs changed state`}
            />
          </Box>
        </Box>
      )}

      {flowVisible && (
        <Typography component="span" sx={TILE_CAPTION}>
          {compactNumber(slice.changed)} changed
        </Typography>
      )}

      {placedVisible && (
        <Box sx={{ width: "100%", display: "flex", justifyContent: "center", mt: "2px" }}>
          <JobGrid counts={slice.stateAsOf} maxWidth={56} gap={1} />
        </Box>
      )}

      {placedVisible && (
        <Typography component="span" sx={TILE_CAPTION}>
          {compactNumber(slice.queued)} placed
        </Typography>
      )}
    </>
  );
}

/** Exported so the page can label the as-of date consistently. */
export { asOfDay };
