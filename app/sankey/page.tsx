import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import type { DayData } from "./types";
import DaysView from "./view";

export const metadata: Metadata = {
  title: "Job Timeline",
  description: "Day-by-day view of what happened to a user's HTCondor jobs.",
};

/**
 * Reads the pre-baked aggregate at build time (the site is a static export), so the
 * browser gets the numbers inlined and does no fetching or per-job math.
 * Regenerate with: node scripts/build-day-data.mjs
 */
export default async function DaysPage() {
  const file = path.join(process.cwd(), "public", "data", "day-cards.json");
  const data = JSON.parse(await readFile(file, "utf8")) as DayData;

  return <DaysView data={data} />;
}
