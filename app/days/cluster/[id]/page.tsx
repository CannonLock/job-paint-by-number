import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

import type { DayData } from "../../types";
import type { ClusterAnalysisFile, ClusterIndexFile } from "../types";
import ClusterDetailView from "./view";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readDayData(): Promise<DayData> {
  return JSON.parse(await readFile(path.join(DATA_DIR, "day-cards.json"), "utf8")) as DayData;
}

/**
 * One route per cluster in the baked window. Driven by day-cards.json rather than
 * the clusters directory so the route still exists (and explains itself) when a
 * cluster's analysis failed to bake.
 */
export async function generateStaticParams() {
  const data = await readDayData();
  return data.clusters.map((cluster) => ({ id: String(cluster.id) }));
}

export const metadata: Metadata = {
  title: "Cluster detail",
  description: "Status, runtime, holds, and resource utilization for one HTCondor cluster.",
};

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await readDayData();
  const cluster = data.clusters.find((c) => String(c.id) === id) ?? null;

  // A missing file is expected rather than exceptional: the bake needs Adstash, and
  // CI has no route to it. The view renders an explicit notice instead of failing
  // the build, so the calendar stays deployable either way.
  let analysis: ClusterAnalysisFile | null = null;
  try {
    const raw = await readFile(path.join(DATA_DIR, "clusters", `${id}.json`), "utf8");
    analysis = JSON.parse(raw) as ClusterAnalysisFile;
  } catch {
    analysis = null;
  }

  // Read the bake index so a missing file can say *why* -- skipped for size, failed,
  // or never attempted are three different things to a reader.
  let index: ClusterIndexFile | null = null;
  try {
    const raw = await readFile(path.join(DATA_DIR, "clusters", "index.json"), "utf8");
    index = JSON.parse(raw) as ClusterIndexFile;
  } catch {
    index = null;
  }

  const numericId = Number(id);
  const skipped = index?.skipped.find((s) => s.cluster === numericId) ?? null;
  const failed = index?.failed.find((f) => f.cluster === numericId) ?? null;

  return (
    <ClusterDetailView
      clusterId={id}
      info={cluster}
      analysis={analysis}
      skipped={skipped}
      failed={failed}
      owner={data.owner}
      asOfGeneratedAt={data.generatedAt}
    />
  );
}
