import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import type { DayData } from "./_components/dayCards";
import type { StackedBarData } from "./types";
import StackedBarView from "./view";

export const metadata: Metadata = {
  title: "Job Day Bars",
  description: "4-hour stacked bars of how a user's HTCondor jobs resolved through each day.",
};

/**
 * Reads the pre-baked aggregates at build time (the site is a static export), so
 * the browser gets the numbers inlined and does no fetching or per-job math.
 *
 * Two files on purpose: stacked-bars.json carries the 4-hour transition series
 * this page's charts draw, and day-cards.json carries the per-day cohort censuses
 * the calendar's waffles and the dialog's breakdown need. Regenerate with:
 *   node scripts/build-stacked-bar-data.mjs
 *   node scripts/build-day-data.mjs
 */
export default async function StackedBarPage() {
  const dataDir = path.join(process.cwd(), "public", "data");
  const data = JSON.parse(
    await readFile(path.join(dataDir, "stacked-bars.json"), "utf8"),
  ) as StackedBarData;
  const dayData = JSON.parse(
    await readFile(path.join(dataDir, "day-cards.json"), "utf8"),
  ) as DayData;

  return <StackedBarView data={data} dayData={dayData} />;
}
