"use client";

import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { Chart, LinearScale, Tooltip } from "chart.js";
import { SankeyController, Flow } from "chartjs-chart-sankey";

import { mergedFlows, type DayCarry, type DayFlows } from "./dayCards";
import { BAR_STATE_STYLES, CARRIED_ACTIVE_COLOR } from "./palette";

// Chart.js v4 is tree-shakeable: every controller, element and scale must be
// registered explicitly. The sankey controller lays its nodes out on linear x/y
// scales, so omitting LinearScale fails at render with
// `"linear" is not a registered scale`.
Chart.register(SankeyController, Flow, LinearScale, Tooltip);

/**
 * Node identity. Keys are stable ids; `labels` supplies what the reader sees.
 *
 * Three ranks and six nodes, against the Sankey page's nine. Merging Placed into
 * Active is what collapses it: the queue and the compute node are one state, so
 * the "Placed Before" backlog, the placed-straight-to-terminal shortcuts, and the
 * queue-pool rank the multi-day period model needed all disappear. What is left
 * is the actual question -- what was in play, what arrived, and how it left.
 */
const NODE = {
  /** In play before the day or period opened: queued or running, both Active here. */
  alreadyActive: "alreadyActive",
  /** Placed during the day or period; placement is how a job becomes Active. */
  placed: "placed",
  /** The Active pool everything passes through. */
  active: "active",
  completed: "completed",
  removed: "removed",
  /** Still Active when the day or period closed; tomorrow's carry-in. */
  stillActive: "stillActive",
} as const;

const NODE_NAMES: Record<string, string> = {
  [NODE.alreadyActive]: "Already Active",
  [NODE.placed]: "Placed Today",
  [NODE.active]: "Active",
  [NODE.completed]: BAR_STATE_STYLES.completed.label,
  [NODE.removed]: BAR_STATE_STYLES.removed.label,
  [NODE.stillActive]: "Still Active",
};

const NODE_COLORS: Record<string, string> = {
  [NODE.alreadyActive]: CARRIED_ACTIVE_COLOR,
  [NODE.placed]: BAR_STATE_STYLES.active.color,
  [NODE.active]: BAR_STATE_STYLES.active.color,
  [NODE.completed]: BAR_STATE_STYLES.completed.color,
  [NODE.removed]: BAR_STATE_STYLES.removed.color,
  // Carry-out keeps the carried colour: what is still active at midnight is what
  // tomorrow inherits as "Already Active".
  [NODE.stillActive]: CARRIED_ACTIVE_COLOR,
};

/**
 * Colour key for the flow. Carried state is listed explicitly because it has no
 * equivalent in the three-state waffle and would otherwise be an unlabelled
 * colour on the page.
 */
export const FLOW_LEGEND: { label: string; color: string }[] = [
  { label: "Already active", color: CARRIED_ACTIVE_COLOR },
  { label: "Placed (became active)", color: BAR_STATE_STYLES.active.color },
  { label: BAR_STATE_STYLES.completed.label, color: BAR_STATE_STYLES.completed.color },
  { label: BAR_STATE_STYLES.removed.label, color: BAR_STATE_STYLES.removed.color },
  { label: "Still active", color: CARRIED_ACTIVE_COLOR },
];

/**
 * Column index per node. Pinning these stops the layout from reshuffling ranks
 * between periods, so the diagram keeps the same shape as the reader switches
 * from yesterday to a month.
 */
const COLUMNS: Record<string, number> = {
  [NODE.alreadyActive]: 0,
  [NODE.placed]: 0,
  [NODE.active]: 1,
  [NODE.completed]: 2,
  [NODE.removed]: 2,
  [NODE.stillActive]: 2,
};

type Edge = { from: string; to: string; flow: number };

const pushIf = (edges: Edge[], from: string, to: string, flow: number) => {
  if (flow > 0) edges.push({ from, to, flow });
};

/**
 * Jobs passing through each node, taken straight off the drawn edges so the labels
 * can never disagree with the ribbons.
 */
function nodeTotals(edges: Edge[]): Record<string, number> {
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
 * The edges for a day or a period -- one builder for both.
 *
 * With Placed and Running merged there is no same-day attribution left to get
 * wrong, and the diagram balances exactly at every length: what came in (already
 * active plus placed) equals what went out (completed plus removed plus still
 * active), because both sides are measured. The four-state diagram could not do
 * this -- a job placed inside the period but started days later counted as
 * "placed before" on the day it moved, so deriving carry-out from same-day
 * transitions stranded such jobs and needed a separate period model.
 *
 * Carry-over is the census at the two edges of the window, not a sum of
 * intermediate days: those cancel out internally.
 */
export function buildEdges(flows: DayFlows, carry: DayCarry | null): Edge[] {
  const { completed, removed } = mergedFlows(flows);
  const edges: Edge[] = [];

  if (carry) {
    // Queued and running are both Active here, so the two measured carry-in
    // figures are one number.
    pushIf(edges, NODE.alreadyActive, NODE.active, carry.placedIn + carry.activeIn);
    pushIf(edges, NODE.placed, NODE.active, carry.placedNew);
  }

  pushIf(edges, NODE.active, NODE.completed, completed);
  pushIf(edges, NODE.active, NODE.removed, removed);
  if (carry) pushIf(edges, NODE.active, NODE.stillActive, carry.placedOut + carry.activeOut);

  return edges;
}

interface StateFlowSankeyProps {
  flows: DayFlows;
  /**
   * Carry-over context. Without it the diagram can only draw the terminations,
   * so what was in play and what is left over go missing. Null on data baked
   * before the census existed.
   */
  carry?: DayCarry | null;
  /**
   * Rename the two source nodes for a multi-day period, where "today" is no
   * longer a single day.
   */
  multiDay?: boolean;
  height?: number;
  /** Accessible description; the canvas itself is opaque to a screen reader. */
  label: string;
}

/**
 * Sankey of one period's state changes, via chartjs-chart-sankey.
 *
 * Drawn on a canvas rather than as SVG because the plugin handles the ribbon
 * geometry that would otherwise have to be hand-rolled.
 */
export default function StateFlowSankey({
  flows,
  carry = null,
  multiDay = false,
  height = 220,
  label,
}: StateFlowSankeyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const data = buildEdges(flows, carry);
    if (data.length === 0) return;

    // Node name plus the jobs through it, e.g. "Completed  276,647". Only nodes
    // the period actually uses get a label, so an unused rank stays blank rather
    // than printing a zero.
    const totals = nodeTotals(data);
    const names = multiDay
      ? { ...NODE_NAMES, [NODE.placed]: "Placed In Period", [NODE.alreadyActive]: "Active At Start" }
      : NODE_NAMES;
    const labels = Object.fromEntries(
      Object.entries(names).map(([key, name]) => [
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
            column: COLUMNS,
            size: "max",
            borderWidth: 0,
            nodeWidth: 10,
            padding: 12,
            font: { size: 11 },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: 4 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: () => "",
              // Chart.js types tooltipItem.raw as unknown; the sankey controller
              // puts the edge record there.
              label: (ctx) => {
                const raw = (ctx.raw ?? {}) as { from?: string; to?: string; flow?: number };
                const from = names[raw.from ?? ""] ?? raw.from;
                const to = names[raw.to ?? ""] ?? raw.to;
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
  }, [flows, carry, multiDay]);

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
