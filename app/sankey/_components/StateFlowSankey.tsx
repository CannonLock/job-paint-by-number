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
  /** Period mode only: the queue itself, fed by both placed sources. */
  placedPool: "placedPool",
  activeBefore: "activeBefore",
  active: "active",
  completed: "completed",
  removed: "removed",
  stillPlaced: "stillPlaced",
  stillActive: "stillActive",
} as const;

const NODE_NAMES: Record<string, string> = {
  [NODE.placedToday]: "Placed",
  [NODE.placedBefore]: "Placed Before",
  [NODE.placedPool]: "In Queue",
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

/**
 * Work that was already running when the day opened, and still running when it
 * closed: the Active indigo lightened so carried state is distinguishable from work
 * that actually moved.
 *
 * Validated with the other five at --pairs all: all gates PASS, worst CVD 11.6 and
 * worst normal-vision 16.3 (both the ochre/red and ochre/amber pairs, unchanged by
 * this addition). Darkening indigo instead was tried first and failed -- #5a6ba8
 * measures only 10.2 against #3b5bdb for normal vision, and #7d84c4 collides with
 * the teal. Lightening turned out to be the direction with room in it.
 */
const CARRIED_ACTIVE_COLOR = "#8ea3e8";

const NODE_COLORS: Record<string, string> = {
  [NODE.placedToday]: STATE_STYLES.queued.color,
  [NODE.placedBefore]: PLACED_BEFORE_COLOR,
  [NODE.placedPool]: STATE_STYLES.queued.color,
  [NODE.activeBefore]: CARRIED_ACTIVE_COLOR,
  [NODE.active]: STATE_STYLES.running.color,
  [NODE.completed]: STATE_STYLES.completed.color,
  [NODE.removed]: STATE_STYLES.removed.color,
  // Carry-out keeps the carried colour of its state: what is still placed at
  // midnight is the stale backlog tomorrow inherits as "Placed Before".
  [NODE.stillPlaced]: PLACED_BEFORE_COLOR,
  [NODE.stillActive]: CARRIED_ACTIVE_COLOR,
};

/**
 * Colour key for the flow. Carried states are listed explicitly because they have
 * no equivalent in the waffle's four-state palette and would otherwise be unlabelled
 * colours on the page.
 */
export const FLOW_LEGEND: { label: string; color: string }[] = [
  { label: "Placed", color: STATE_STYLES.queued.color },
  { label: "Placed before", color: PLACED_BEFORE_COLOR },
  { label: "Already active", color: CARRIED_ACTIVE_COLOR },
  { label: "Became active", color: STATE_STYLES.running.color },
  { label: STATE_STYLES.completed.label, color: STATE_STYLES.completed.color },
  { label: STATE_STYLES.removed.label, color: STATE_STYLES.removed.color },
];

/**
 * Column index per node. Pinning these stops the layout from reshuffling ranks
 * between days, which would make the small multiples in the calendar unreadable.
 */
const DAY_COLUMNS: Record<string, number> = {
  [NODE.placedToday]: 0,
  [NODE.placedBefore]: 0,
  [NODE.activeBefore]: 0,
  [NODE.active]: 1,
  [NODE.completed]: 2,
  [NODE.removed]: 2,
  [NODE.stillPlaced]: 2,
  [NODE.stillActive]: 2,
};

// A fixed state-order `priority` map was tried here (removed at the bottom,
// completed, active, placed on top) and reverted: forcing that order overrode the
// plugin's crossing-minimising layout and made the ribbons overlap far more.
// Node order is left to the plugin.

/** Period mode adds the queue-pool rank, so everything downstream shifts right. */
const PERIOD_COLUMNS: Record<string, number> = {
  [NODE.placedToday]: 0,
  [NODE.placedBefore]: 0,
  [NODE.placedPool]: 1,
  [NODE.activeBefore]: 1,
  [NODE.active]: 2,
  [NODE.completed]: 3,
  [NODE.removed]: 3,
  [NODE.stillPlaced]: 3,
  [NODE.stillActive]: 3,
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

type Edge = { from: string; to: string; flow: number };

const pushIf = (edges: Edge[], from: string, to: string, flow: number) => {
  if (flow > 0) edges.push({ from, to, flow });
};

/** The measured transitions, dropped to zero-free edges. Shared by every builder. */
function transitionEdges(flows: DayFlows): Edge[] {
  return TRANSITION_EDGES.filter((edge) => flows[edge.key] > 0).map((edge) => ({
    from: edge.from,
    to: edge.to,
    flow: flows[edge.key],
  }));
}

/** Jobs placed today that did not move: still placed when the day closed. */
function placedTodayStays(flows: DayFlows, carry: DayCarry): number {
  const todayLeft =
    flows.placedTodayToActive + flows.placedTodayToRemoved + flows.placedTodayToCompleted;
  return Math.min(clampPositive(carry.placedNew - todayLeft), carry.placedOut);
}

/**
 * Edges for one day.
 *
 * Same-day attribution is known here — a transition on this day either belongs to a
 * job placed this day or to one placed earlier — so the two placed sources keep
 * their own ribbons. Carry-out is taken from the measured census rather than
 * inferred, with only the split between the two sources derived.
 */
function buildDayEdges(flows: DayFlows, carry: DayCarry | null): Edge[] {
  const edges = transitionEdges(flows);
  if (!carry) return edges;

  pushIf(edges, NODE.activeBefore, NODE.active, carry.activeIn);

  // Of the jobs placed today, those that did not move are still placed tonight.
  const todayStays = placedTodayStays(flows, carry);
  pushIf(edges, NODE.placedToday, NODE.stillPlaced, todayStays);
  // The rest of tonight's queue is older work, taken as the measured remainder.
  pushIf(edges, NODE.placedBefore, NODE.stillPlaced, clampPositive(carry.placedOut - todayStays));

  pushIf(edges, NODE.active, NODE.stillActive, carry.activeOut);
  return edges;
}

/**
 * Edges for the changes-only variant the calendar tiles draw.
 *
 * Only state that changed during the day appears: every measured transition, plus
 * the jobs placed today that did not move — being placed is itself that day's
 * change. What the full diagram carries and this one deliberately omits is
 * unchanged state: the backlog that opened and closed the day as Placed, and the
 * jobs that were already running and still are (activeBefore → active →
 * stillActive). Jobs that started today and are still running simply end at
 * Active — the start is the change, and drawing a carry-out for them would need
 * an unmeasured split of activeOut between carried and fresh work.
 */
function buildChangeEdges(flows: DayFlows, carry: DayCarry | null): Edge[] {
  const edges = transitionEdges(flows);
  if (!carry) return edges;
  pushIf(edges, NODE.placedToday, NODE.stillPlaced, placedTodayStays(flows, carry));
  return edges;
}

/**
 * Edges for a multi-day period.
 *
 * Over several days the same-day split stops being attributable: a job placed on the
 * 24th that starts on the 1st is "placed before" on the day it moved, yet it was
 * placed inside the period. Deriving carry-out from same-day transitions therefore
 * strands every such job in Still Placed — which is what put ~1.5M phantom jobs
 * there over a month while a week whose jobs all resolved same-day looked fine.
 *
 * So the period model routes both sources into the queue itself and drains that
 * pool using period totals and the measured census at each edge. Nothing is
 * apportioned between the two sources beyond what was actually measured.
 */
function buildPeriodEdges(flows: DayFlows, carry: DayCarry | null): Edge[] {
  if (!carry) return buildDayEdges(flows, null);
  const edges: Edge[] = [];

  // Two ways into the queue: the backlog the period opened with, and new work.
  pushIf(edges, NODE.placedBefore, NODE.placedPool, carry.placedIn);
  pushIf(edges, NODE.placedToday, NODE.placedPool, carry.placedNew);

  // Four ways out, all measured over the period.
  pushIf(
    edges,
    NODE.placedPool,
    NODE.active,
    flows.placedTodayToActive + flows.placedBeforeToActive,
  );
  pushIf(
    edges,
    NODE.placedPool,
    NODE.removed,
    flows.placedTodayToRemoved + flows.placedBeforeToRemoved,
  );
  pushIf(
    edges,
    NODE.placedPool,
    NODE.completed,
    flows.placedTodayToCompleted + flows.placedBeforeToCompleted,
  );
  pushIf(edges, NODE.placedPool, NODE.stillPlaced, carry.placedOut);

  pushIf(edges, NODE.activeBefore, NODE.active, carry.activeIn);
  pushIf(edges, NODE.active, NODE.completed, flows.activeToCompleted);
  pushIf(edges, NODE.active, NODE.removed, flows.activeToRemoved);
  pushIf(edges, NODE.active, NODE.stillActive, carry.activeOut);

  return edges;
}

/**
 * Rendered height for a tile Sankey, log-scaled against the busiest day on screen.
 *
 * A Sankey always normalises to fill its canvas, so a 500-job day and a 900,000-job
 * day draw identically — the diagram says how work was distributed but nothing
 * about how much there was. Scaling the canvas restores that.
 *
 * The scale is relative rather than absolute: the peak day renders at full height
 * and everything else in proportion, so each page uses its whole vertical range
 * instead of a quiet month collapsing into stubs. The trade-off is that heights are
 * only comparable within a page — navigating months rescales.
 *
 * Deliberately applied to the canvas, not to the flow values. Log-transforming the
 * individual flows would make the ribbons within one day lie about their relative
 * sizes — a genuine 10:1 split would draw as roughly 1.5:1. Proportions inside a
 * day stay linear and truthful; only the overall size carries the cross-day signal.
 */
export function relativeFlowHeight(
  jobsMoved: number,
  quietestJobsMoved: number,
  busiestJobsMoved: number,
  min: number,
  max: number,
): number {
  if (jobsMoved <= 0) return min;

  // Anchored at both ends, so the quietest day on the page renders at `min` and the
  // busiest at `max`. Measuring from zero instead wastes most of the range: with a
  // 66-job day against an 859,104-job peak, log10(67)/log10(859105) is already 0.31,
  // so the "shortest" diagram came out a third of the way up regardless of the floor.
  const lo = Math.log10(Math.max(Math.min(quietestJobsMoved, jobsMoved), 1) + 1);
  const hi = Math.log10(Math.max(busiestJobsMoved, jobsMoved) + 1);
  const here = Math.log10(jobsMoved + 1);
  const span = hi - lo;
  const fraction = span > 0 ? Math.min(Math.max((here - lo) / span, 0), 1) : 1;
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
  /**
   * Draw only the state that changed during the day: transitions plus jobs placed
   * that day. Unchanged carried state (placed-before that stayed placed, active
   * that stayed active) is omitted. The calendar tiles use this; the period
   * breakdown and the day detail keep the complete flow.
   */
  changesOnly?: boolean;
  /**
   * Rename the source nodes for a multi-day period, where "today" is no longer a
   * single day: the split is between jobs placed on the day they moved and jobs
   * placed before it.
   */
  sameDayLabels?: boolean;
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
  changesOnly = false,
  sameDayLabels = false,
  height = 160,
  label,
}: StateFlowSankeyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Period mode routes both placed sources through the queue pool; a single
    // day keeps its directly-attributable split; changes-only drops unchanged state.
    const data = sameDayLabels
      ? buildPeriodEdges(flows, carry)
      : changesOnly
        ? buildChangeEdges(flows, carry)
        : buildDayEdges(flows, carry);
    if (data.length === 0) return;

    const isTile = variant === "tile";

    // Node name plus the jobs through it, e.g. "Completed 276,647". Only nodes the
    // day actually uses get a label, so an unused rank stays blank rather than
    // printing a zero.
    const totals = nodeTotals(data);
    const names = sameDayLabels
      ? {
          ...NODE_NAMES,
          [NODE.placedToday]: "Placed In Period",
          [NODE.placedBefore]: "Placed At Start",
        }
      : NODE_NAMES;
    const labels = isTile
      ? BLANK_LABELS
      : Object.fromEntries(
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
            column: sameDayLabels ? PERIOD_COLUMNS : DAY_COLUMNS,
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
  }, [flows, carry, variant, changesOnly, sameDayLabels]);

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
