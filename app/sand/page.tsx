import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import type { DayData } from "../sankey/types";
import SandView from "./view";

export const metadata: Metadata = {
  title: "Jobs as sand",
  description: "Physics-driven sand simulation of HTCondor jobs moving between states.",
};

/**
 * Reads the same baked aggregate the calendar uses, at build time. The simulation
 * needs the per-day flows and nothing more, so no new data pipeline is involved.
 */
export default async function SandPage() {
  const file = path.join(process.cwd(), "public", "data", "day-cards.json");
  const data = JSON.parse(await readFile(file, "utf8")) as DayData;

  return <SandView data={data} />;
}
