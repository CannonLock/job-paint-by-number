"use client";

import { Box, Stack, Typography } from "@mui/material";

import type { BarScale } from "../types";
import type { ScaleAdvice } from "./binModel";

export const SCALE_LABELS: Record<BarScale, string> = {
  linear: "Linear",
  log: "Log",
};

/**
 * What each scale buys and what it costs. One source of wording for the info
 * tooltip beside the toggle and the note at the foot of the page, so the two can
 * never drift apart.
 *
 * Both entries are stated as a pair on purpose: neither scale is the right
 * answer. Linear is the only one you can read ratios off; log is the only one
 * that shows you a quiet week at all when the same month holds a 900,000-change
 * day. The reader needs to know which one they are looking at.
 */
export const SCALE_HELP: Record<BarScale, { good: string; bad: string }> = {
  linear: {
    good:
      "Bar heights are proportional to the work. Twice as tall really is twice as many state changes, so you can compare days by eye and trust the answer.",
    bad:
      "One heavy day flattens the rest of the month. Against a 900,000-change peak a 600-change bin is well under a pixel, so busy-but-ordinary days read as empty ones.",
  },
  log: {
    good:
      "Quiet days stay visible next to a heavy one, and the order of the bins is preserved, so you can still see when in the day the work landed.",
    bad:
      "Heights are no longer proportional. A bar half as tall can be thousands of times less work, so comparisons are ordinal only — hover a bar, or open the day, for the real numbers.",
  },
};

/**
 * The nudge that sits beside the toggle when the linear scale has flattened most
 * of the month onto the 2-pixel floor.
 *
 * In the document flow rather than a popup: it is information about what the
 * reader is looking at, not an interruption, so it should not cover the thing it
 * is describing or need dismissing. One sentence -- the info tooltip and the note
 * at the foot of the page carry the full argument.
 */
export function ScaleHint({ advice }: { advice: ScaleAdvice }) {
  return (
    <Typography variant="caption" component="p" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
      {advice.squashedDays} of {advice.activeDays} busy days are too short to read at this
      scale.
      <br />
      Try{" "}
      <Box component="span" sx={{ fontWeight: 700, color: "primary.main" }}>
        Log Scale
      </Box>{" "}
      to increase bar sizes at the cost of easily comparable magnitudes.
    </Typography>
  );
}

/** Compact good/bad pair for one scale. Used inside the info tooltip. */
function HelpEntry({ scale }: { scale: BarScale }) {
  const help = SCALE_HELP[scale];
  return (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
        {SCALE_LABELS[scale]}
      </Typography>
      <Typography variant="caption" component="p" sx={{ display: "block", lineHeight: 1.5 }}>
        Good: {help.good}
      </Typography>
      <Typography variant="caption" component="p" sx={{ display: "block", lineHeight: 1.5 }}>
        Catch: {help.bad}
      </Typography>
    </Box>
  );
}

/** Tooltip body for the info icon beside the scale toggle. */
export function ScaleHelpTooltip() {
  return (
    <Stack spacing={1} sx={{ maxWidth: 320, py: 0.5 }}>
      <Typography variant="caption" sx={{ display: "block", lineHeight: 1.5 }}>
        How the calendar turns state-change counts into bar heights. It scales every
        day against the busiest 4-hour bin on the visible month, so heights are
        comparable across that month and nowhere else.
      </Typography>
      <HelpEntry scale="linear" />
      <HelpEntry scale="log" />
      <Typography variant="caption" sx={{ display: "block", lineHeight: 1.5, fontStyle: "italic" }}>
        Either way the segments inside one bar stay linear, so a single bar&apos;s
        composition is always truthful.
      </Typography>
    </Stack>
  );
}

/**
 * The note at the foot of the page. Same content as the tooltip, written out as
 * prose for the reader who scrolled rather than hovered.
 */
export function ScaleNote({ scale }: { scale: BarScale }) {
  return (
    <Box component="section">
      <Typography variant="overline" component="h3" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
        A note on the bar scale
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: "text.secondary", display: "block" }}>
        The calendar&apos;s magnitude bars are scaled against the busiest 4-hour bin on the
        month you are looking at, which means heights compare honestly within a month and
        not between months — paging to a quieter month rescales everything. The toggle
        above picks how that scaling works, and it is currently{" "}
        <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
          {SCALE_LABELS[scale]}
        </Box>
        .
      </Typography>
      <Typography
        variant="caption"
        component="p"
        sx={{ color: "text.secondary", display: "block", mt: 0.75 }}
      >
        <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
          Linear
        </Box>{" "}
        is the honest one: {SCALE_HELP.linear.good} Its problem is dynamic range —{" "}
        {SCALE_HELP.linear.bad}
      </Typography>
      <Typography
        variant="caption"
        component="p"
        sx={{ color: "text.secondary", display: "block", mt: 0.75 }}
      >
        <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
          Log
        </Box>{" "}
        trades that away for visibility: {SCALE_HELP.log.good} Its problem is that{" "}
        {SCALE_HELP.log.bad}
      </Typography>
      <Typography
        variant="caption"
        component="p"
        sx={{ color: "text.secondary", display: "block", mt: 0.75, fontStyle: "italic" }}
      >
        Neither scale distorts a single bar: the split between placed, completed, and
        removed inside one column is always linear, and the day detail keeps a plain
        count axis with exact totals. The scale only changes how tall one column is
        next to another.
      </Typography>
    </Box>
  );
}
