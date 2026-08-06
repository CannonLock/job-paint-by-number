"use client";

import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { Chart, LinearScale, Tooltip } from "chart.js";
import { SankeyController, Flow } from "chartjs-chart-sankey";

import type { DayCarry, DayFlows } from "../types";
import { STATE_STYLES } from "./palette";

// Chart.js v4 is tree-shakeable: every controller, element and scale must be
// registered explicitly. The sankey controller lays its nodes out on linear x/y
// scales, so omitting LinearScale fails at render with
// `"linear" is not a registered scale`.
Chart.register(SankeyController, Flow, LinearScale, Tooltip);

/**
 * Node identity. Keys are stable ids; `labels` supplies what the reader sees, so
 * the tiny variant can drop text without changing the graph.
 */
const NODE = {
  placedToday: "placedToday",
  placedBefore: "placedBefore",
  activeBefore: "activeBefore",
  active: "active",
  completed: "completed",
  removed: "removed",
  stillPlaced: "stillPlaced",
  stillActive: "stillActive",
} as const;

const NODE_NAMES: Record<string, string> = {
  [NODE.placedToday]: "Placed Today",
  [NODE.placedBefore]: "Placed Before",
  [NODE.activeBefore]: "Active Before",
  [NODE.active]: STATE_STYLES.running.label,
  [NODE.completed]: STATE_STYLES.completed.label,
  [NODE.removed]: STATE_STYLES.removed.label,
  [NODE.stillPlaced]: "Still Placed",
  [NODE.stillActive]: "Still Active",
};

/**
 * Blank label for every node, used by the tile variant.
 *
 * An empty `labels` object is not enough: the plugin falls back to printing the
 * raw node key, so tiles would read "placedBefore". Mapping each key to an empty
 * string is what actually suppresses the text.
 */
const BLANK_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(NODE).map((key) => [key, ""]),
);

/**
 * Jobs passing through each node, taken straight off the drawn edges so the labels
 * can never disagree with the ribbons. With carry-over present each rank balances,
 * so max(in, out) is simply the node's throughput.
 */
function nodeTotals(edges: { from: string; to: string; flow: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  const incoming: Record<string, number> = {};
  for (const edge of edges) {
    out[edge.from] = (out[edge.from] ?? 0) + edge.flow;
    incoming[edge.to] = (incoming[edge.to] ?? 0) + edge.flow;
  }
  const totals: Record<string, number> = {};
  for (const key of Object.values(NODE)) {
    totals[key] = Math.max(out[key] ?? 0, incoming[key] ?? 0);
  }
  return totals;
}

/**
 * Backlog carried in from earlier days: the Placed amber, aged into a duller ochre
 * so stale work reads as stale at a glance.
 *
 * Validated with the other four at --pairs all: chroma PASS, CVD all-pairs PASS
 * (worst 11.6 deutan against the removed red, which is the pair a brown naturally
 * threatens since brown is dark desaturated red-orange), normal-vision 16.3 against
 * the fresh amber. Darker browns were tried first and failed - #8a6a2f collides
 * with the removed red at dE 5.1, #7a5c33 at 3.4.
 */
const PLACED_BEFORE_COLOR = "#a8791f";

const NODE_COLORS: Record<string, string> = {
  [NODE.placedToday]: STATE_STYLES.queued.color,
  [NODE.placedBefore]: PLACED_BEFORE_COLOR,
  [NODE.activeBefore]: STATE_STYLES.running.color,
  [NODE.active]: STATE_STYLES.running.color,
  [NODE.completed]: STATE_STYLES.completed.color,
  [NODE.removed]: STATE_STYLES.removed.color,
  // Carry-out keeps its state's colour: what is still placed at midnight is the
  // stale backlog tomorrow inherits, so it takes the aged ochre.
  [NODE.stillPlaced]: PLACED_BEFORE_COLOR,
  [NODE.stillActive]: STATE_STYLES.running.color,
};

/**
 * Column index per node. Pinning these stops the layout from reshuffling ranks
 * between days, which would make the small multiples in the calendar unreadable.
 */
const NODE_COLUMNS: Record<string, number> = {
  [NODE.placedToday]: 0,
  [NODE.placedBefore]: 0,
  [NODE.activeBefore]: 0,
  [NODE.active]: 1,
  [NODE.completed]: 2,
  [NODE.removed]: 2,
  [NODE.stillPlaced]: 2,
  [NODE.stillActive]: 2,
};

/** Measured transition edges. Zero-weight edges are dropped before render. */
const TRANSITION_EDGES: { from: string; to: string; key: keyof DayFlows }[] = [
  { from: NODE.placedToday, to: NODE.active, key: "placedTodayToActive" },
  { from: NODE.placedBefore, to: NODE.active, key: "placedBeforeToActive" },
  { from: NODE.active, to: NODE.completed, key: "activeToCompleted" },
  { from: NODE.active, to: NODE.removed, key: "activeToRemoved" },
  { from: NODE.placedToday, to: NODE.removed, key: "placedTodayToRemoved" },
  { from: NODE.placedBefore, to: NODE.removed, key: "placedBeforeToRemoved" },
  { from: NODE.placedToday, to: NODE.completed, key: "placedTodayToCompleted" },
  { from: NODE.placedBefore, to: NODE.completed, key: "placedBeforeToCompleted" },
];

const clampPositive = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * Build the full edge list: measured transitions, plus the carry-over edges that
 * make the day balance.
 *
 * Carry-out is a residual — what came into a rank minus what left it by a measured
 * transition. It is computed rather than read from the census so the ribbons always
 * sum correctly even if the two were built from slightly different job populations;
 * a negative residual would mean the inputs disagree, and is clamped to zero rather
 * than drawn as an impossible flow.
 */
function buildEdges(flows: DayFlows, carry: DayCarry | null) {
  const edges = TRANSITION_EDGES.filter((edge) => flows[edge.key] > 0).map((edge) => ({
    from: edge.from,
    to: edge.to,
    flow: flows[edge.key],
  }));
  if (!carry) return edges;

  // Jobs already running when the day began, flowing into Active.
  if (carry.activeIn > 0) {
    edges.push({ from: NODE.activeBefore, to: NODE.active, flow: carry.activeIn });
  }

  // Placed work that neither started nor left the queue today.
  const todayLeft =
    flows.placedTodayToActive + flows.placedTodayToRemoved + flows.placedTodayToCompleted;
  const todayStays = clampPositive(carry.placedNew - todayLeft);
  if (todayStays > 0) {
    edges.push({ from: NODE.placedToday, to: NODE.stillPlaced, flow: todayStays });
  }

  const backlogLeft =
    flows.placedBeforeToActive + flows.placedBeforeToRemoved + flows.placedBeforeToCompleted;
  const backlogStays = clampPositive(carry.placedIn - backlogLeft);
  if (backlogStays > 0) {
    edges.push({ from: NODE.placedBefore, to: NODE.stillPlaced, flow: backlogStays });
  }

  // Still executing at midnight: everything that entered Active, less what finished.
  const activeIn = carry.activeIn + flows.placedTodayToActive + flows.placedBeforeToActive;
  const activeStays = clampPositive(activeIn - (flows.activeToCompleted + flows.activeToRemoved));
  if (activeStays > 0) {
    edges.push({ from: NODE.active, to: NODE.stillActive, flow: activeStays });
  }

  return edges;
}

/** Job counts spanning a single job to a million; the tile scale covers that range. */
const VOLUME_DECADES = 6;

/**
 * Rendered height for a tile Sankey, log-scaled by how many jobs moved that day.
 *
 * A Sankey always normalises to fill its canvas, so a 500-job day and a 900,000-job
 * day draw identically — the diagram says how work was distributed but nothing
 * about how much there was. Scaling the whole diagram by log10 of the day's volume
 * restores that: across a month, busy days are visibly taller than quiet ones,
 * and the log keeps four orders of magnitude inside a few dozen pixels.
 *
 * Deliberately applied to the canvas, not to the flow values. Log-transforming the
 * individual flows would make the ribbons within one day lie about their relative
 * sizes — a 10:1 split would draw as roughly 1.5:1. Proportions inside a day stay
 * linear and truthful; only the overall size carries the cross-day signal.
 */
export function tileFlowHeight(jobsMoved: number, min: number, max: number): number {
  const magnitude = Math.log10(Math.max(jobsMoved, 1));
  const fraction = Math.min(magnitude / VOLUME_DECADES, 1);
  return Math.round(min + fraction * (max - min));
}

interface StateFlowSankeyProps {
  flows: DayFlows;
  /**
   * Carry-over context. Without it the diagram draws transitions only, so a job
   * that was already running and stays running is invisible. Null on data baked
   * before the census existed.
   */
  carry?: DayCarry | null;
  /**
   * "tile" is the calendar variant: colour only, no text, no interaction.
   * "full" labels the nodes and shows counts on hover.
   */
  variant?: "tile" | "full";
  height?: number;
  /** Accessible description; the canvas itself is opaque to a screen reader. */
  label: string;
}

/**
 * Sankey of one day's state changes, via chartjs-chart-sankey.
 *
 * Drawn on a canvas rather than as SVG because the calendar renders one of these
 * per day, and the plugin handles the ribbon geometry that would otherwise have to
 * be hand-rolled twice at two sizes.
 */
export default function StateFlowSankey({
  flows,
  carry = null,
  variant = "full",
  height = 160,
  label,
}: StateFlowSankeyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const data = buildEdges(flows, carry);
    if (data.length === 0) return;

    const isTile = variant === "tile";

    // Node name plus the jobs through it, e.g. "Completed 276,647". Only nodes the
    // day actually uses get a label, so an unused rank stays blank rather than
    // printing a zero.
    const totals = nodeTotals(data);
    const labels = isTile
      ? BLANK_LABELS
      : Object.fromEntries(
          Object.entries(NODE_NAMES).map(([key, name]) => [
            key,
            totals[key] > 0 ? `${name}  ${totals[key].toLocaleString()}` : "",
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
            column: NODE_COLUMNS,
            // Tiles are ~56px wide; a normal node bar and padding would leave no
            // room for the ribbons themselves.
            size: "max",
            borderWidth: 0,
            nodeWidth: isTile ? 3 : 10,
            padding: isTile ? 2 : 12,
            font: isTile ? undefined : { size: 11 },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Small multiples that animate on every re-render are just noise.
        animation: false,
        events: isTile ? [] : ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
        layout: { padding: isTile ? 1 : 4 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !isTile,
            callbacks: {
              title: () => "",
              // Chart.js types tooltipItem.raw as unknown; the sankey controller
              // puts the edge record there.
              label: (ctx) => {
                const raw = (ctx.raw ?? {}) as { from?: string; to?: string; flow?: number };
                const from = NODE_NAMES[raw.from ?? ""] ?? raw.from;
                const to = NODE_NAMES[raw.to ?? ""] ?? raw.to;
                return `${from} → ${to}: ${(raw.flow ?? 0).toLocaleString()} jobs`;
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
  }, [flows, carry, variant]);

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
