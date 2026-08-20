"use client";

import { Box } from "@mui/material";

import { BAR_STATE_STYLES, CARRIED_ACTIVE_COLOR } from "./palette";

/**
 * The mark that means "this is a queue, not a day": three stacked rules narrowing
 * upward, a queue seen side-on.
 *
 * Shared by the queue markers on the boundaries and by the queue scale down the
 * right of the calendar, so the reader can see that the scale on the right belongs
 * to those bars and not to the ones inside the tiles.
 */
export default function QueueGlyph({
  size = 11,
  active = false,
}: {
  size?: number;
  /** Picks up the strong indigo while the thing it marks is hovered. */
  active?: boolean;
}) {
  return (
    <Box
      component="svg"
      viewBox="0 0 12 12"
      aria-hidden
      sx={{
        width: size,
        height: size,
        display: "block",
        color: active ? BAR_STATE_STYLES.active.color : CARRIED_ACTIVE_COLOR,
        transition: "color 120ms",
      }}
    >
      <rect x="2" y="7.6" width="8" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="3.25" y="5.05" width="5.5" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="4.5" y="2.5" width="3" height="1.5" rx="0.75" fill="currentColor" />
    </Box>
  );
}
