import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import type { DayData } from "../sankey/types";
import SandWasmView from "./view";

export const metadata: Metadata = {
  title: "Jobs as sand (Rust/WASM)",
  description:
    "The falling-sand job simulation with its cellular automaton rewritten in Rust and compiled to WebAssembly.",
};

/**
 * Reads the same baked aggregate /sand and the calendar use, at build time. The
 * simulation needs the per-day flows and nothing more, so no new data pipeline is
 * involved -- and reading the identical file is what makes the ms/frame numbers on
 * the two pages comparable.
 */
export default async function SandWasmPage() {
  const file = path.join(process.cwd(), "public", "data", "day-cards.json");
  const data = JSON.parse(await readFile(file, "utf8")) as DayData;

  return <SandWasmView data={data} />;
}
