"use client";

import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { Chart, LinearScale, Tooltip } from "chart.js";
import { SankeyController, Flow } from "chartjs-chart-sankey";

import type { DayFlows, StateCounts } from "../types";
import type { JourneyDay } from "./dayModel";
import { STATE_STYLES } from "./palette";

Chart.register(SankeyController, Flow, LinearScale, Tooltip);

/**
 * Node identity: the four states at the day's open and close. Separate keys per
 * side because the plugin needs distinct nodes to draw a state persisting.
 */
const NODE = {
  startPlaced: "startPlaced",
  startActive: "startActive",
  startCompleted: "startCompleted",
  startRemoved: "startRemoved",
  endPlaced: "endPlaced",
  endActive: "endActive",
  endCompleted: "endCompleted",
  endRemoved: "endRemoved",
} as const;

const NODE_NAMES: Record<string, string> = {
  [NODE.startPlaced]: STATE_STYLES.queued.label,
  [NODE.startActive]: STATE_STYLES.running.label,
  [NODE.startCompleted]: STATE_STYLES.completed.label,
  [NODE.startRemoved]: STATE_STYLES.removed.label,
  [NODE.endPlaced]: STATE_STYLES.queued.label,
  [NODE.endActive]: STATE_STYLES.running.label,
  [NODE.endCompleted]: STATE_STYLES.completed.label,
  [NODE.endRemoved]: STATE_STYLES.removed.label,
};

const BLANK_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(NODE).map((key) => [key, ""]),
);

const NODE_COLORS: Record<string, string> = {
  [NODE.startPlaced]: STATE_STYLES.queued.color,
  [NODE.startActive]: STATE_STYLES.running.color,
  [NODE.startCompleted]: STATE_STYLES.completed.color,
  [NODE.startRemoved]: STATE_STYLES.removed.color,
  [NODE.endPlaced]: STATE_STYLES.queued.color,
  [NODE.endActive]: STATE_STYLES.running.color,
  [NODE.endCompleted]: STATE_STYLES.completed.color,
  [NODE.endRemoved]: STATE_STYLES.removed.color,
};

const COLUMNS: Record<string, number> = {
  [NODE.startPlaced]: 0,
  [NODE.startActive]: 0,
  [NODE.startCompleted]: 0,
  [NODE.startRemoved]: 0,
  [NODE.endPlaced]: 1,
  [NODE.endActive]: 1,
  [NODE.endCompleted]: 1,
  [NODE.endRemoved]: 1,
};

/** Top to bottom: placed, active, completed, removed -- the page-wide state order. */
const PRIORITY: Record<string, number> = {
  [NODE.startPlaced]: 0,
  [NODE.startActive]: 1,
  [NODE.startCompleted]: 2,
  [NODE.startRemoved]: 3,
  [NODE.endPlaced]: 0,
  [NODE.endActive]: 1,
  [NODE.endCompleted]: 2,
  [NODE.endRemoved]: 3,
};

/**
 * Pixel gap the tile variant puts between a column's nodes. NOTE: the plugin's
 * option for this is `nodePadding` (default 10) -- the `padding` dataset option
 * feeds label offsets, not node spacing, and passing the gap there silently left
 * the default in force while the height compensation assumed 2px. 10 keeps the
 * spacing the tiles have always rendered with; the compensation math below now
 * uses the same number the plugin does.
 */
export const TILE_NODE_GAP = 10;

/** Vertical canvas padding the tile variant reserves (1px top + 1px bottom). */
const TILE_CANVAS_PAD = 2;

/**
 * How many category nodes this day's busiest column draws. Counted from the
 * edges the diagram will actually render, NOT from the censuses: the clamped
 * persistence/attribution arithmetic in buildJourneyEdges can draw a node the
 * census calls empty (or drop one it calls populated), and a tile sized for the
 * census count then renders at the wrong scale and stops lining up with its
 * neighbours. Drives the per-tile height compensation below.
 */
export function journeyCategoryCount(journey: JourneyDay): number {
  const startNodes = new Set<string>();
  const endNodes = new Set<string>();
  for (const edge of buildJourneyEdges(journey)) {
    startNodes.add(edge.from);
    endNodes.add(edge.to);
  }
  return Math.max(startNodes.size, endNodes.size, 1);
}

/**
 * Canvas height that makes this tile's flows render at the same jobs-per-pixel
 * scale as the month's busiest tile, so adjacent days' shared states line up
 * across the tile border.
 *
 * The plugin normalises every diagram to fill its canvas: a column with k nodes
 * spends (k-1) gaps of `TILE_NODE_GAP` px, so its flows get h²/(h+(k-1)·gap)
 * pixels of a height-h canvas. Fixing that flow-pixel budget F to the K-category
 * worst case and solving h² - F·h - F(k-1)·gap = 0 for each tile's own k gives
 * the height at which its scale matches. Tiles are top-anchored in a fixed slot,
 * so the compensation surfaces as blank space at the bottom and the captions
 * below stay on one line.
 */
export function journeyTileHeight(categories: number, maxCategories: number, slot: number): number {
  const gap = TILE_NODE_GAP;
  const k = Math.max(1, Math.min(categories, maxCategories));
  // Work on the drawable height; the canvas padding is constant across tiles.
  const slotContent = slot - TILE_CANVAS_PAD;
  const flowBudget = (slotContent * slotContent) / (slotContent + (maxCategories - 1) * gap);
  const h =
    (flowBudget + Math.sqrt(flowBudget * flowBudget + 4 * flowBudget * (k - 1) * gap)) / 2;
  return Math.round(Math.min(h + TILE_CANVAS_PAD, slot));
}

type Edge = { from: string; to: string; flow: number };

const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

const pushIf = (edges: Edge[], from: string, to: string, flow: number) => {
  if (flow > 0) edges.push({ from, to, flow });
};

const ZERO_FLOWS: DayFlows = {
  placedTodayToActive: 0,
  placedBeforeToActive: 0,
  activeToCompleted: 0,
  activeToRemoved: 0,
  placedTodayToRemoved: 0,
  placedBeforeToRemoved: 0,
  placedTodayToCompleted: 0,
  placedBeforeToCompleted: 0,
};

/**
 * Edges for one day of the journey. StateCounts order: [placed, active,
 * completed, removed].
 *
 * The cross-edges come from the measured flows; the persistence edges (a state
 * flowing into itself) are the start census minus what left it. One attribution
 * is not measured: a job placed and terminated the same day appears in the flows
 * as a start plus a termination, and the termination cannot be pinned to it or to
 * a job already active at the open. Terminations are assumed to drain the jobs
 * that opened the day as Active first -- consistent with the stacked-bar page --
 * with any excess attributed to same-day starts and drawn placed -> terminal.
 */
function buildJourneyEdges(journey: JourneyDay): Edge[] {
  const [startPlaced, startActive, startCompleted, startRemoved] = journey.start as StateCounts;
  const flows = journey.flows ?? ZERO_FLOWS;
  const starts = flows.placedTodayToActive + flows.placedBeforeToActive;
  const directCompleted = flows.placedTodayToCompleted + flows.placedBeforeToCompleted;
  const directRemoved = flows.placedTodayToRemoved + flows.placedBeforeToRemoved;

  // Terminations from Active, drained oldest-first (see docstring).
  const fromOpenCompleted = Math.min(flows.activeToCompleted, startActive);
  const fromOpenRemoved = Math.min(flows.activeToRemoved, startActive - fromOpenCompleted);
  // The remainder terminated the same day they started: placed -> terminal.
  const sameDayCompleted = flows.activeToCompleted - fromOpenCompleted;
  const sameDayRemoved = flows.activeToRemoved - fromOpenRemoved;

  const placedToActive = clamp(starts - sameDayCompleted - sameDayRemoved);
  const placedToCompleted = directCompleted + sameDayCompleted;
  const placedToRemoved = directRemoved + sameDayRemoved;

  const edges: Edge[] = [];
  pushIf(edges, NODE.startPlaced, NODE.endActive, placedToActive);
  pushIf(edges, NODE.startPlaced, NODE.endCompleted, placedToCompleted);
  pushIf(edges, NODE.startPlaced, NODE.endRemoved, placedToRemoved);
  pushIf(
    edges,
    NODE.startPlaced,
    NODE.endPlaced,
    clamp(startPlaced - placedToActive - placedToCompleted - placedToRemoved),
  );

  pushIf(edges, NODE.startActive, NODE.endCompleted, fromOpenCompleted);
  pushIf(edges, NODE.startActive, NODE.endRemoved, fromOpenRemoved);
  pushIf(edges, NODE.startActive, NODE.endActive, clamp(startActive - fromOpenCompleted - fromOpenRemoved));

  // Terminal states persist untouched: this is what keeps every job in view.
  pushIf(edges, NODE.startCompleted, NODE.endCompleted, startCompleted);
  pushIf(edges, NODE.startRemoved, NODE.endRemoved, startRemoved);
  return edges;
}

interface ClusterJourneySankeyProps {
  journey: JourneyDay;
  /** "tile" is colour only, no text, no interaction; "full" labels and hovers. */
  variant?: "tile" | "full";
  height?: number;
  /** Accessible description; the canvas itself is opaque to a screen reader. */
  label: string;
}

/**
 * One day of a cluster's whole-cohort journey: every job the cluster has placed,
 * flowing from its state at the day's open to its state at the close. Totals are
 * constant across days (completed and removed persist), so with a fixed canvas
 * the diagram reads as a ratio of the whole cluster -- the reader watches amber
 * turn teal day by day.
 */
export default function ClusterJourneySankey({
  journey,
  variant = "full",
  height = 160,
  label,
}: ClusterJourneySankeyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const data = buildJourneyEdges(journey);
    if (data.length === 0) return;

    const isTile = variant === "tile";

    // Node totals for labels, straight off the drawn edges.
    const totals: Record<string, number> = {};
    for (const edge of data) {
      totals[edge.from] = (totals[edge.from] ?? 0) + edge.flow;
      totals[edge.to] = (totals[edge.to] ?? 0) + edge.flow;
    }
    const labels = isTile
      ? BLANK_LABELS
      : Object.fromEntries(
          Object.entries(NODE_NAMES).map(([key, name]) => [
            key,
            (totals[key] ?? 0) > 0 ? `${name}  ${totals[key].toLocaleString()}` : "",
          ]),
        );

    chartRef.current = new Chart(canvas, {
      type: "sankey",
      data: {
        datasets: [
          {
            data,
            colorFrom: (ctx: { raw?: { from?: string } }) =>
              NODE_COLORS[ctx.raw?.from ?? ""] ?? "#999",
            colorTo: (ctx: { raw?: { to?: string } }) => NODE_COLORS[ctx.raw?.to ?? ""] ?? "#999",
            colorMode: "gradient",
            labels,
            column: COLUMNS,
            priority: PRIORITY,
            size: "max",
            borderWidth: 0,
            nodeWidth: isTile ? 3 : 10,
            // The real node-spacing option; pinned so the height compensation
            // can never drift from what the plugin lays out.
            nodePadding: isTile ? TILE_NODE_GAP : 10,
            padding: isTile ? 2 : 12,
            font: isTile ? undefined : { size: 11 },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        events: isTile ? [] : ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
        // Tiles keep zero horizontal padding so adjacent days' columns meet at
        // the tile border and the calendar row reads as one continuous flow.
        layout: { padding: isTile ? { left: 0, right: 0, top: 1, bottom: 1 } : 4 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !isTile,
            callbacks: {
              title: () => "",
              label: (ctx) => {
                const raw = (ctx.raw ?? {}) as { from?: string; to?: string; flow?: number };
                const from = NODE_NAMES[raw.from ?? ""] ?? raw.from;
                const to = NODE_NAMES[raw.to ?? ""] ?? raw.to;
                const verb = from === to ? `stayed ${to?.toLowerCase()}` : `${from} → ${to}`;
                return `${verb}: ${(raw.flow ?? 0).toLocaleString()} jobs`;
              },
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [journey, variant]);

  return (
    <Box
      role="img"
      aria-label={label}
      sx={{ position: "relative", width: "100%", height, minWidth: 0 }}
    >
      <canvas ref={canvasRef} />
    </Box>
  );
}
