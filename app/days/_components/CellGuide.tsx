"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import Close from "@mui/icons-material/Close";

import { QUEUE_HEIGHT_CAP, barFraction, buildScaleTicks } from "./binModel";
import { compactNumber } from "./dayCards";
import {
  ACTIVITY_ORDER,
  ACTIVITY_STYLES,
  BAR_STATE_STYLES,
  CARRIED_ACTIVE_COLOR,
  QUEUE_TEXTURE,
} from "./palette";
import QueueGlyph from "./QueueGlyph";

/**
 * Which part of the example cell a feature is about. Several features point at
 * the bars, so emphasis is expressed per part rather than per feature.
 */
type Part = "date" | "axis" | "bars" | "caption" | "queue" | "queueAxis";

type FeatureId =
  | "date"
  | "windows"
  | "colour"
  | "height"
  | "hover"
  | "queue"
  | "caption"
  | "finished";

interface Feature {
  id: FeatureId;
  title: string;
  body: string;
  /** Parts of the example that stay lit while this feature is hovered. */
  parts: Part[];
}

/**
 * The features of a calendar cell, ordered by what a reader needs first.
 *
 * Orientation before structure, structure before encoding, and within the
 * encoding "what happened" before "how much" -- you have to know what you are
 * looking at before its size means anything. Then the escape hatch (hover for the
 * real numbers), then the one bar that is not a day, and finally the details and
 * the edge case, which only matter once the rest has landed.
 */
const FEATURES: Feature[] = [
  {
    id: "date",
    title: "One cell is one day",
    body: "Click anywhere in it to open that day in full — its cohort, its charts, and its exact counts.",
    parts: ["date"],
  },
  {
    id: "windows",
    title: "Six bars, six 4-hour windows",
    body: "Midnight on the left through to midnight on the right, so you can see when in the day the work landed. An empty slot is a window in which nothing moved.",
    parts: ["bars"],
  },
  {
    id: "colour",
    title: "Colour is what happened",
    body: "Jobs placed, completed, and removed, stacked bottom to top — so one bar can show all three at once.",
    parts: ["bars"],
  },
  {
    id: "height",
    title: "Height is how much happened",
    body: "Every bar on the month is scaled against the busiest single window in it. The numbers down the left of each row say what those heights are worth in state changes.",
    parts: ["axis", "bars"],
  },
  {
    id: "hover",
    title: "Hover a bar for the numbers",
    body: "The bars are deliberately small and unlabelled — a month of them is a shape you scan. Hovering one gives its exact counts, and lights up the scale it is measured against.",
    parts: ["bars", "axis"],
  },
  {
    id: "queue",
    title: "The bar on the edge is the queue",
    body: "It belongs to no single day — it straddles midnight, counting the jobs simply sitting in the queue as one day becomes the next. Light blue was already in flight; dark blue arrived that day. Its falling hatch tells it apart from the day bars and points the way you want the queue to go. Being a headcount rather than a count of changes, it is measured against its own scale, down the right.",
    parts: ["queue", "queueAxis"],
  },
  {
    id: "caption",
    title: "The caption counts jobs",
    body: "Distinct jobs that changed state that day. A job that did two things still counts once, which is why this rarely matches the bars added up.",
    parts: ["caption"],
  },
  {
    id: "finished",
    title: "Blank bars can mean finished",
    body: "With one cluster or batch selected the bars are cumulative, and once its last job reaches a final state the day draws that one all-finished bar and stops. Empty windows after it mean the work is done, not that the data ran out.",
    parts: ["bars"],
  },
];

/** The made-up day the example draws: a quiet morning, a busy afternoon. */
const EXAMPLE_BINS = [
  { label: "00–04", placed: 0, completed: 0, removed: 0 },
  { label: "04–08", placed: 1200, completed: 0, removed: 0 },
  { label: "08–12", placed: 400, completed: 900, removed: 0 },
  { label: "12–16", placed: 0, completed: 2600, removed: 300 },
  { label: "16–20", placed: 0, completed: 1100, removed: 0 },
  { label: "20–24", placed: 0, completed: 200, removed: 0 },
];

const EXAMPLE_TOTALS = EXAMPLE_BINS.map(
  (bin) => bin.placed + bin.completed + bin.removed,
);
const EXAMPLE_PEAK = Math.max(...EXAMPLE_TOTALS);
/** The bar the colour and hover features point at: the only one with all three. */
const FOCUS_BIN = 3;

const SLOT_HEIGHT = 150;
const GUTTER = 46;

/** A queue to match the example day: mostly carried over, partly fresh. */
const EXAMPLE_QUEUE = { carried: 2998, fromToday: 2242 };
const EXAMPLE_QUEUE_TOTAL = EXAMPLE_QUEUE.carried + EXAMPLE_QUEUE.fromToday;
/**
 * A peak for the queue's own scale. Height and ticks are both derived from it with
 * the real functions, so the example cannot drift from what the calendar does.
 */
const EXAMPLE_QUEUE_PEAK = 8400;
const EXAMPLE_QUEUE_FRACTION =
  barFraction(EXAMPLE_QUEUE_TOTAL, EXAMPLE_QUEUE_PEAK, "linear") *
  QUEUE_HEIGHT_CAP;
const EXAMPLE_QUEUE_TICKS = buildScaleTicks(
  EXAMPLE_QUEUE_PEAK,
  "linear",
  QUEUE_HEIGHT_CAP,
);

/** Width the example reserves for the queue scale hanging off its right. */
const RIGHT_GUTTER = 56;

/** The example cell's own padding, in px, so the slot can cancel it exactly. */
const CELL_PAD = 12;

/** Reserved row below the slot for the hour labels; see ExampleCell. */
const HOUR_ROW = 14;

/** The activity scale's ticks, from the same peak the example's bars use. */
const EXAMPLE_ACTIVITY_TICKS = buildScaleTicks(EXAMPLE_PEAK, "linear");

interface CellGuideDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the checkbox state when the dialog is dismissed. */
  onRememberChange: (remember: boolean) => void;
  remember: boolean;
}

/**
 * The "how to read a cell" dialog the page opens with.
 *
 * A calendar tile packs six stacked bars, a height scale, and a caption into
 * about 150 by 130 pixels. That density is the point -- it is what lets a month
 * be one glance -- but it means nothing on the tile has room to label itself. So
 * the labelling happens once, here, against an oversized example: the reader
 * hovers a feature on the left and sees exactly which part of the cell it means
 * light up on the right.
 */
export default function CellGuideDialog({
  open,
  onClose,
  onRememberChange,
  remember,
}: CellGuideDialogProps) {
  const [active, setActive] = useState<FeatureId | null>(null);
  const feature = FEATURES.find((f) => f.id === active) ?? null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="body">
      <DialogTitle sx={{ pr: 6, pb: 1 }}>
        <Typography
          component="span"
          variant="h6"
          sx={{ fontWeight: 700, display: "block" }}
        >
          How to read a day in the calendar
        </Typography>
        <Typography
          component="span"
          variant="caption"
          sx={{ color: "text.secondary" }}
        >
          hover anything on the left to find it on the right
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
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={{ xs: 2.5, md: 3 }}
        >
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
            {FEATURES.map((entry) => (
              <FeatureCard
                key={entry.id}
                feature={entry}
                active={active === entry.id}
                onActivate={() => setActive(entry.id)}
                onDeactivate={() => setActive(null)}
              />
            ))}
          </Stack>

          <Box
            sx={{
              flexShrink: 0,
              width: { xs: "100%", md: 340 },
              // Sticks alongside the list, so a feature low down still has the
              // example in view when it lights up.
              position: { md: "sticky" },
              top: { md: 8 },
              alignSelf: "flex-start",
            }}
          >
            <ExampleCell active={feature} />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, justifyContent: "space-between" }}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={remember}
              onChange={(event) => onRememberChange(event.target.checked)}
            />
          }
          label={
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Don&apos;t show this again
            </Typography>
          }
        />
        <Button variant="contained" onClick={onClose}>
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Swatch plus text, matching the real readout's shape. */
function ReadoutLine({ color, text }: { color: string; text: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "2px",
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <Typography variant="caption">{text}</Typography>
    </Stack>
  );
}

function FeatureCard({
  feature,
  active,
  onActivate,
  onDeactivate,
}: {
  feature: Feature;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  return (
    <Box
      // Focusable as well as hoverable: the highlight is the explanation, so it
      // cannot be mouse-only.
      tabIndex={0}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
      sx={{
        p: 1.25,
        borderRadius: 1,
        border: "1px solid",
        borderColor: active ? "primary.main" : "divider",
        backgroundColor: active ? "action.hover" : "transparent",
        cursor: "default",
        transition: "border-color 120ms, background-color 120ms",
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {feature.title}
      </Typography>
      <Typography
        variant="caption"
        component="p"
        sx={{ color: "text.secondary", mt: 0.25 }}
      >
        {feature.body}
      </Typography>
    </Box>
  );
}

/**
 * An oversized calendar cell, built from the same palette and the same height
 * maths as the real thing so nothing here can teach the reader something the
 * calendar does not do.
 */
function ExampleCell({ active }: { active: Feature | null }) {
  const lit = (part: Part) => !active || active.parts.includes(part);
  // Two features single out one bar; the rest treat the row as a whole.
  const focusOneBar = active?.id === "colour" || active?.id === "hover";

  const dim = (part: Part) => ({
    opacity: lit(part) ? 1 : 0.25,
    transition: "opacity 140ms",
  });

  const ring = (part: Part) => ({
    outline: active && active.parts.includes(part) ? "2px solid" : "2px solid transparent",
    outlineColor: active && active.parts.includes(part) ? "primary.main" : "transparent",
    outlineOffset: "3px",
    borderRadius: "3px",
    transition: "outline-color 140ms",
  });

  return (
    <Box>
      {/* Both scales hang outside the cell, as they do on a real row, so the
          wrapper reserves their width on either side. */}
      <Box sx={{ pl: `${GUTTER}px`, pr: `${RIGHT_GUTTER}px` }}>
        <Box
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            backgroundColor: "background.paper",
            p: `${CELL_PAD}px`,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <Box sx={{ alignSelf: "center", ...dim("date"), ...ring("date") }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: "text.secondary" }}>
              12
            </Typography>
          </Box>

          {/*
            One slot, and everything that has to share a baseline is positioned
            against it at bottom: 0 -- the bars, both scales, and the queue marker.
            They used to be aligned by matching offsets measured from the cell,
            which is what let them drift apart: the hour labels quietly added their
            own height to the row, so the activity scale sat lower than the bars it
            was labelling.

            The negative side margins pull the slot out to the cell's borders, so
            the queue marker straddles the edge exactly as it straddles a real day
            boundary.
          */}
          <Box sx={{ position: "relative", height: SLOT_HEIGHT, mx: `-${CELL_PAD}px` }}>
            {/* The activity scale, outside the cell on the left. */}
            <Box
              sx={{
                position: "absolute",
                right: `calc(100% + 8px)`,
                bottom: 0,
                height: "100%",
                width: GUTTER - 16,
                ...dim("axis"),
                ...ring("axis"),
              }}
            >
              {EXAMPLE_ACTIVITY_TICKS.map((tick) => (
                <ExampleTick key={tick.value} tick={tick} side="left" />
              ))}
            </Box>

            {/* The six bars, inset to the cell's own padding. */}
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                mx: `${CELL_PAD}px`,
                display: "flex",
                gap: "3px",
                alignItems: "flex-end",
                ...dim("bars"),
                ...ring("bars"),
              }}
            >
              {EXAMPLE_BINS.map((bin, index) => {
                const total = EXAMPLE_TOTALS[index];
                const muted = focusOneBar && index !== FOCUS_BIN;
                return (
                  <Box
                    key={bin.label}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      opacity: muted ? 0.25 : 1,
                      transition: "opacity 140ms",
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column-reverse",
                        // The example is linear, which is the page's default.
                        height: `${(barFraction(total, EXAMPLE_PEAK, "linear") * 100).toFixed(3)}%`,
                        minHeight: total > 0 ? 2 : 0,
                        borderRadius: "2px",
                        overflow: "hidden",
                        outline:
                          focusOneBar && index === FOCUS_BIN
                            ? "2px solid"
                            : "2px solid transparent",
                        outlineColor:
                          focusOneBar && index === FOCUS_BIN ? "primary.main" : "transparent",
                        outlineOffset: "2px",
                      }}
                    >
                      {total > 0 &&
                        ACTIVITY_ORDER.map((state) => (
                          <Box
                            key={state}
                            sx={{
                              flexGrow: bin[state],
                              flexBasis: 0,
                              backgroundColor: ACTIVITY_STYLES[state].color,
                            }}
                          />
                        ))}
                    </Box>
                  </Box>
                );
              })}
            </Box>

            {/* The queue marker, astride the cell's right border. */}
            <Box
              sx={{
                position: "absolute",
                left: "100%",
                bottom: 0,
                height: "100%",
                width: 18,
                transform: "translateX(-50%)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                ...dim("queue"),
                ...ring("queue"),
              }}
            >
              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  height: `${EXAMPLE_QUEUE_FRACTION * 100}%`,
                  display: "flex",
                  flexDirection: "column-reverse",
                  borderRadius: "2px",
                  overflow: "hidden",
                  boxShadow: (theme) => `0 0 0 1px ${theme.palette.background.paper}`,
                }}
              >
                <Box
                  sx={{
                    flexGrow: EXAMPLE_QUEUE.carried,
                    flexBasis: 0,
                    backgroundColor: CARRIED_ACTIVE_COLOR,
                  }}
                />
                <Box
                  sx={{
                    flexGrow: EXAMPLE_QUEUE.fromToday,
                    flexBasis: 0,
                    backgroundColor: BAR_STATE_STYLES.active.color,
                  }}
                />
                <Box sx={{ position: "absolute", inset: 0, ...QUEUE_TEXTURE }} />
              </Box>
              <Box
                aria-hidden
                sx={{
                  position: "absolute",
                  top: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  mt: "3px",
                }}
              >
                <QueueGlyph size={14} active={active?.id === "queue"} />
              </Box>
            </Box>

            {/* The queue's own scale, outside the cell on the right. */}
            <Box
              sx={{
                position: "absolute",
                left: `calc(100% + 20px)`,
                bottom: 0,
                height: "100%",
                width: RIGHT_GUTTER - 26,
                ...dim("queueAxis"),
                ...ring("queueAxis"),
              }}
            >
              {EXAMPLE_QUEUE_TICKS.map((tick) => (
                <ExampleTick key={tick.value} tick={tick} side="right" />
              ))}
              <Box sx={{ position: "absolute", top: "100%", left: 0, mt: "3px" }}>
                <QueueGlyph size={14} active={active?.id === "queue"} />
              </Box>
            </Box>
          </Box>

          {/*
            The hour labels sit in their own reserved row below the slot rather
            than inside it. In the slot they added height to the bars' container
            and dragged the baseline down with them; here the row is always
            present and only its ink comes and goes.
          */}
          <Box
            sx={{
              height: HOUR_ROW,
              display: "flex",
              gap: "3px",
              opacity: active?.id === "windows" ? 1 : 0,
              transition: "opacity 140ms",
            }}
          >
            {EXAMPLE_BINS.map((bin) => (
              <Typography
                key={bin.label}
                component="span"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "center",
                  fontSize: "0.6rem",
                  lineHeight: `${HOUR_ROW}px`,
                  color: "text.secondary",
                }}
              >
                {bin.label.split("–")[0]}
              </Typography>
            ))}
          </Box>

          <Box sx={{ alignSelf: "center", ...dim("caption"), ...ring("caption") }}>
            <Typography component="span" sx={{ fontSize: "0.72rem", fontWeight: 700 }}>
              4.1k changed
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Standing in for the real hover readout, so the reader knows what to
          expect before they go looking for it. Whichever bar they are asking
          about is the one it describes. */}
      <Box
        sx={{
          mt: 1.5,
          opacity: active?.id === "hover" || active?.id === "queue" ? 1 : 0,
          transition: "opacity 140ms",
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            display: "inline-block",
            px: 1.25,
            py: 0.75,
            borderRadius: 1,
            // Matches the real readout's solid dark ground; see
            // READOUT_SLOT_PROPS in BinReadout.
            backgroundColor: "grey.900",
            color: "common.white",
          }}
        >
          {active?.id === "queue" ? (
            <>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
                Queue at midnight · Wed, Aug 12 → Thu, Aug 13
              </Typography>
              <Typography variant="caption" sx={{ display: "block", opacity: 0.8 }}>
                {EXAMPLE_QUEUE_TOTAL.toLocaleString()} jobs still in the queue
              </Typography>
              <ReadoutLine
                color={CARRIED_ACTIVE_COLOR}
                text={`${EXAMPLE_QUEUE.carried.toLocaleString()} already in flight before this day`}
              />
              <ReadoutLine
                color={BAR_STATE_STYLES.active.color}
                text={`${EXAMPLE_QUEUE.fromToday.toLocaleString()} placed this day, still in flight`}
              />
            </>
          ) : (
            <>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
                Wed, Aug 12 · 12–16 h
              </Typography>
              {ACTIVITY_ORDER.filter((state) => EXAMPLE_BINS[FOCUS_BIN][state] > 0).map(
                (state) => (
                  <ReadoutLine
                    key={state}
                    color={ACTIVITY_STYLES[state].color}
                    text={`${EXAMPLE_BINS[FOCUS_BIN][state].toLocaleString()} jobs ${state}`}
                  />
                ),
              )}
            </>
          )}
        </Box>
      </Box>

      <Typography
        variant="caption"
        component="p"
        sx={{ color: "text.secondary", mt: 1.5, fontStyle: "italic" }}
      >
        An example day, drawn about twice the size of a real cell.
      </Typography>
    </Box>
  );
}

/** One labelled gridline on the example's scales. */
function ExampleTick({
  tick,
  side,
}: {
  tick: { value: number; fraction: number };
  side: "left" | "right";
}) {
  const dash = <Box sx={{ width: 4, height: "1px", backgroundColor: "divider", flexShrink: 0 }} />;
  return (
    <Box
      sx={{
        position: "absolute",
        ...(side === "left" ? { right: 0 } : { left: 0 }),
        bottom: `${tick.fraction * 100}%`,
        transform: "translateY(50%)",
        display: "flex",
        alignItems: "center",
        gap: "3px",
      }}
    >
      {side === "right" && dash}
      <Typography
        component="span"
        sx={{ fontSize: "0.7rem", lineHeight: 1, color: "text.secondary" }}
      >
        {compactNumber(tick.value)}
      </Typography>
      {side === "left" && dash}
    </Box>
  );
}
