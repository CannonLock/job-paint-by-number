import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import type { DayData } from "../sankey/types";
import SandWorkerView from "./view";

export const metadata: Metadata = {
  title: "Jobs as sand (Web Worker)",
  description:
    "The falling-sand job simulation with the physics and rendering moved off the main thread into a Web Worker.",
};

/**
 * Same baked aggregate as /sand, read at build time. The worker variant changes
 * where the simulation runs, not what it is fed.
 */
export default async function SandWorkerPage() {
  const file = path.join(process.cwd(), "public", "data", "day-cards.json");
  const data = JSON.parse(await readFile(file, "utf8")) as DayData;

  return <SandWorkerView data={data} />;
}
