"use client";

import { useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import Calendar from "react-calendar";

import "react-calendar/dist/Calendar.css";

import type { BarScale } from "../types";
import {
  QUEUE_HEIGHT_CAP,
  TILE_BARS_HEIGHT,
  buildScaleTicks,
  type DayActivity,
  type DayCensus,
  type ScaleKind,
  type ScaleTick,
} from "./binModel";
import {
  compactNumber,
  dayKeyOf,
  formatDayShort,
  isEmptySlice,
  parseDayKey,
  type DaySlice,
} from "./dayCards";
import TileAxis, { AXIS_WIDTH, QUEUE_OVERHANG } from "./TileAxis";
import TileActivityBars from "./TileActivityBars";
import TileBars from "./TileBars";
import TileQueueBar from "./TileQueueBar";

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
  /** Which scale the magnitude bars use. Ignored by the ratio bars. */
  scale: BarScale;
  /**
   * Largest end-of-day queue in the baked window. The queue markers scale against
   * this, which is deliberately neither the bar peak nor per month: one counts
   * standing jobs, the other counts changes. See queuePeak.
   */
  queuePeak: number;
  /**
   * Tallest 4-hour bin on the visible month; every tile scales against it so bar
   * heights compare across days. Measured by the page rather than here, because
   * the scale hint beside the toggle reasons about the same number.
   */
  peakBinTotal: number;
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
 * Month grid where each day carries its six 4-hour stacked bars. No placed waffle
 * on the tiles: placements already appear as the bars' own segments, so the tile
 * is just the chart and its caption. Hovering any bar gives the numbers behind it.
 */
export default function JobCalendar({
  slices,
  censuses,
  activities,
  scale,
  peakBinTotal,
  queuePeak,
  firstDay,
  lastDay,
  asOf,
  activeStartDate,
  onActiveStartDateChange,
  onSelectDay,
}: JobCalendarProps) {
  const minDate = parseDayKey(firstDay);
  const maxDate = parseDayKey(lastDay);

  // Which scale the pointer is currently over. The calendar draws bars against two
  // of them, so hovering a bar lights up the axis that governs it -- and, just as
  // usefully, leaves the other one alone.
  const [hoveredScale, setHoveredScale] = useState<ScaleKind | null>(null);

  // What the day bars' heights mean, which differs by mode: one group's ratio bars
  // are always a 0-100% share of its cohort, while the magnitude bars are counts
  // against this month's busiest bin under the chosen scale.
  const axis = useMemo<{ ticks: ScaleTick[]; unit: "count" | "percent" }>(
    () =>
      censuses
        ? {
            ticks: [
              { value: 100, fraction: 1 },
              { value: 50, fraction: 0.5 },
              { value: 0, fraction: 0 },
            ],
            unit: "percent",
          }
        : { ticks: buildScaleTicks(peakBinTotal, scale), unit: "count" },
    [censuses, peakBinTotal, scale],
  );

  // The queue markers' own scale, on the right. Capped exactly as the bars are, so
  // a label sits at the height the value it names is actually drawn at.
  const queueTicks = useMemo(
    () => (activities ? buildScaleTicks(queuePeak, scale, QUEUE_HEIGHT_CAP) : []),
    [activities, queuePeak, scale],
  );

  return (
    <Box
      sx={{
        // The axis hangs off the left of the grid, so the wrapper reserves its
        // width. Padding rather than a negative margin on the labels themselves:
        // this way the numbers can never be pushed under the page's own edge, and
        // a narrow viewport shrinks the calendar instead of clipping the scale.
        pl: `${AXIS_WIDTH}px`,
        // Room for the queue scale, plus the half of the last column's queue marker
        // that hangs past the grid's right edge and which that scale sits clear of.
        pr: `${AXIS_WIDTH + QUEUE_OVERHANG}px`,
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
          // Positioned so the row axis can be placed against the tile.
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: `${TILE_GAP}px`,
          // Tall enough for the date, the bars slot, and its caption.
          minHeight: 136,
          // No horizontal padding: the journey bars run edge to edge so one day's
          // census meets the next day's. Everything else in the tile is centred
          // text, which does not miss the inset.
          padding: `${TILE_PAD_Y}px 0`,
          border: "1px solid",
          borderColor: "divider",
          background: "none",
          fontSize: "0.75rem",
          color: "text.primary",
          // Deliberately unclipped, so the row axis -- a child of the tile --
          // can reach past its left edge and sit outside the grid.
          //
          // !important is load-bearing here, unusually. react-calendar renders
          // each tile as a <button>, and the browser clips a button's content at
          // a priority a plain author declaration does not outrank: with
          // `overflow: visible` as the only matching rule in the document, the
          // computed value still came back `hidden`. This is the one thing that
          // moves it. Should a future engine ignore it, the labels are clipped and
          // nothing else changes -- the bars, the hover readouts, and the note at
          // the foot of the page all still work.
          //
          // The day's own content does its own clipping -- see .day-body in
          // TileBody.
          overflow: "visible !important",
        },
        // One axis per row at each end: activity on the row's first tile, the queue
        // scale on its last.
        "& .react-calendar__month-view__days__day:not(:nth-of-type(7n + 1)) .day-axis": {
          display: "none",
        },
        "& .react-calendar__month-view__days__day:not(:nth-of-type(7n)) .day-axis-right": {
          display: "none",
        },
        "& .react-calendar__tile:enabled:hover, & .react-calendar__tile:enabled:focus": {
          backgroundColor: "action.hover",
        },
        "& .react-calendar__tile:disabled": {
          backgroundColor: "transparent",
          color: "text.disabled",
        },
        // Dim the day, not the tile: the row axis is a sibling of the body and
        // belongs to the whole row, so it must stay legible even when the row
        // happens to start in the previous month.
        "& .react-calendar__month-view__days__day--neighboringMonth > abbr, & .react-calendar__month-view__days__day--neighboringMonth .day-body":
          { opacity: 0.35 },
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
          const slice = slices.get(key);
          // Local-midnight arithmetic, not a milliseconds offset, so the label is
          // right across a daylight-saving boundary.
          const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
          const nextKey = dayKeyOf(next);
          return (
            <>
              {/* Rendered on every tile, revealed by CSS on the first of each
                  row. See TileAxis. */}
              <TileAxis
                ticks={axis.ticks}
                height={BARS_SLOT}
                bottom={AXIS_BOTTOM}
                side="left"
                unit={axis.unit}
                highlighted={hoveredScale === "activity"}
              />
              {/* The queue scale, revealed by CSS on the last tile of each row.
                  Only where there are queue markers to scale. */}
              {queueTicks.length > 0 && (
                <TileAxis
                  ticks={queueTicks}
                  height={BARS_SLOT}
                  bottom={AXIS_BOTTOM}
                  side="right"
                  unit="count"
                  highlighted={hoveredScale === "queue"}
                  glyph
                />
              )}
              <TileBody
                slice={slice}
                census={censuses?.get(key)}
                activity={activities?.get(key)}
                peakBinTotal={peakBinTotal}
                scale={scale}
                onHoverScale={setHoveredScale}
              />
              {/*
                Only in the all-clusters view. A single cluster's tiles already
                show its standing state -- the two blues in the last bar of a
                journey tile ARE its queue -- so a separate marker would repeat
                what the tile has already said, against a second scale the
                percentage axis cannot annotate.

                Sibling of the day body, not a child of it: the body clips, and
                this has to hang over the boundary into tomorrow.
              */}
              {activities && slice?.queue && slice.queue.total > 0 && (
                <TileQueueBar
                  queue={slice.queue}
                  day={key}
                  nextDay={slices.has(nextKey) ? nextKey : null}
                  peak={queuePeak}
                  scale={scale}
                  height={BARS_SLOT}
                  bottom={AXIS_BOTTOM}
                  onHoverScale={setHoveredScale}
                />
              )}
            </>
          );
        }}
      />
    </Box>
  );
}

/**
 * Fixed height for every tile's bars. The ratio bars are percentages, so a
 * uniform canvas keeps the six-bin shape legible on every day; the magnitude bars
 * carry their own height inside it.
 */
const BARS_SLOT = TILE_BARS_HEIGHT;

// Tile geometry, shared between the CSS below and the axis offset. The row axis
// is positioned against the tile, so it can only line up with the bars if these
// three numbers and the CSS agree -- hence one definition, used in both places.
const TILE_PAD_Y = 6;
const TILE_GAP = 4;
const CAPTION_LINE = 14;

/**
 * Distance from a tile's bottom edge up to the floor of its bar slot: the
 * caption, the gap above it, and the tile's own bottom padding.
 */
const AXIS_BOTTOM = TILE_PAD_Y + CAPTION_LINE + TILE_GAP;

const TILE_CAPTION = {
  fontSize: "0.64rem",
  fontWeight: 700,
  height: `${CAPTION_LINE}px`,
  lineHeight: `${CAPTION_LINE}px`,
  textAlign: "center",
  whiteSpace: "nowrap",
} as const;

/**
 * One day's tile content: the bar slot and its caption.
 *
 * Deliberately the same skeleton on every day, including days with nothing to
 * draw. The row axis is positioned against the tile, so it can only line up with
 * the bars if the slot sits at the same height in every tile -- and the leftmost
 * tile of a row is as likely to be an empty day as a busy one.
 */
function TileBody({
  slice,
  census,
  activity,
  peakBinTotal,
  scale,
  onHoverScale,
}: {
  slice: DaySlice | undefined;
  census: DayCensus | undefined;
  activity: DayActivity | undefined;
  peakBinTotal: number;
  scale: BarScale;
  onHoverScale: (kind: ScaleKind | null) => void;
}) {
  // Cluster mode shows the census whenever jobs are in view, moved or not;
  // all-jobs mode shows the magnitude bars only when something changed.
  const barsVisible = slice ? (census ? census.hasData : !!activity?.hasData) : false;
  const dayLabel = slice ? formatDayShort(slice.day) : "";

  // The day bake counts starts, completions and removals, so a day whose only
  // event was a submission has "0 changed" -- which reads as nothing happened
  // next to a tile full of fresh blue. In cluster mode the census knows better.
  const caption = !slice
    ? ""
    : !barsVisible
      ? ""
      : slice.changed > 0
        ? `${compactNumber(slice.changed)} changed`
        : census && census.placedToday > 0
          ? `${compactNumber(census.placedToday)} placed`
          : `${compactNumber(slice.changed)} changed`;

  return (
    <Box
      className="day-body"
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: `${TILE_GAP}px`,
        // The tile is unclipped so the axis can reach outside it; the day's own
        // content is clipped here instead.
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: "100%",
          height: BARS_SLOT,
          display: "flex",
          alignItems: barsVisible ? "flex-end" : "center",
          justifyContent: "center",
        }}
      >
        {barsVisible && slice ? (
          // The journey bars span the tile so they butt against the neighbouring
          // day's; the magnitude bars stay inset and centred, where a gap between
          // days is correct -- each is its own independent total, not a series.
          <Box sx={{ width: "100%", maxWidth: census ? "none" : 104, minWidth: 0 }}>
            {census ? (
              <TileBars
                bins={census.bins}
                height={BARS_SLOT}
                dayLabel={dayLabel}
                finishedAt={census.finishedAt}
                label={`${compactNumber(slice.changed)} jobs changed state`}
                onHoverScale={onHoverScale}
              />
            ) : (
              activity && (
                <TileActivityBars
                  bins={activity.bins}
                  peakBinTotal={peakBinTotal}
                  scale={scale}
                  height={BARS_SLOT}
                  dayLabel={dayLabel}
                  label={`${compactNumber(activity.total)} state changes`}
                  onHoverScale={onHoverScale}
                />
              )
            )}
          </Box>
        ) : (
          // Nothing to plot, but the day still has a headline worth showing.
          slice &&
          (slice.queued > 0 || slice.changed > 0) && (
            <Typography
              component="span"
              sx={{ fontSize: "0.68rem", fontWeight: 700, lineHeight: 1.3 }}
            >
              {slice.changed > 0
                ? `${compactNumber(slice.changed)} changed`
                : `${compactNumber(slice.queued)} placed`}
            </Typography>
          )
        )}
      </Box>

      {/* Always present, even when blank: it is what holds the bar slot at the
          same height in every tile, which is what the row axis is aligned to. */}
      <Typography component="span" sx={TILE_CAPTION}>
        {caption || "\u00A0"}
      </Typography>
    </Box>
  );
}
