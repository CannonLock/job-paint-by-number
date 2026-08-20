import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import type { StackedBarData } from "./types";
import type { DayData } from "./_components/dayCards";
import DaysView from "./view";

export const metadata: Metadata = {
  title: "Job Days",
  description:
    "What happened to a user's HTCondor jobs: a flow summary of the last day, week, or month over a calendar of 4-hour stacked bars.",
};

/**
 * Reads the pre-baked aggregates at build time (the site is a static export), so
 * the browser gets the numbers inlined and does no fetching or per-job math.
 *
 * Two files on purpose: day-cards.json carries the per-day cohort censuses, the
 * flow edges the Sankey draws, and the end-of-day carry-over census; and
 * stacked-bars.json carries the 4-hour transition series the calendar's bars
 * draw. Regenerate with:
 *   node scripts/build-day-data.mjs
 *   node scripts/build-stacked-bar-data.mjs
 */
export default async function DaysPage() {
  const dataDir = path.join(process.cwd(), "public", "data");
  const data = JSON.parse(
    await readFile(path.join(dataDir, "stacked-bars.json"), "utf8"),
  ) as StackedBarData;
  const dayData = JSON.parse(
    await readFile(path.join(dataDir, "day-cards.json"), "utf8"),
  ) as DayData;

  return <DaysView data={data} dayData={dayData} />;
}
