"use client";

import { useMemo } from "react";
import { Box } from "@mui/material";
import {
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Bar } from "react-chartjs-2";

import type { BinCensus } from "./binModel";
import { BAR_SEGMENT_ORDER, SEGMENT_STYLES } from "./palette";

// Chart.js v4 is tree-shakeable: register exactly what the bar chart needs.
Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

interface DayStackedBarsProps {
  bins: BinCensus[];
  height?: number;
  /** X-axis title; the period card passes "Day" for its per-day bars. */
  xTitle?: string;
  /** Accessible description; the canvas itself is opaque to a screen reader. */
  label: string;
}

/** Absolute count for one segment in one bin, for the tooltip. */
function countOf(bin: BinCensus, state: (typeof BAR_SEGMENT_ORDER)[number]): number {
  return bin[state];
}

/**
 * One day as six 100%-stacked bars, one per 4-hour bin.
 *
 * The view is percentages so a 500-job day and a 900,000-job day both read as
 * "how did the day's work resolve"; the absolute counts live in the tooltip.
 * Empty bins (nothing in play yet) draw nothing rather than a 0/0 bar.
 */
export default function DayStackedBars({
  bins,
  height = 320,
  xTitle = "Hour of day",
  label,
}: DayStackedBarsProps) {
  const { data, options } = useMemo(() => {
    const pct = (count: number, inPlay: number) => (inPlay > 0 ? (count / inPlay) * 100 : 0);

    const data = {
      labels: bins.map((bin) => bin.label),
      datasets: BAR_SEGMENT_ORDER.map((state) => ({
        label: SEGMENT_STYLES[state].label,
        data: bins.map((bin) => pct(countOf(bin, state), bin.inPlay)),
        backgroundColor: SEGMENT_STYLES[state].color,
        borderWidth: 0,
        // Thin slivers (one removed job among a million) should still be hoverable.
        minBarLength: 0,
      })),
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      scales: {
        x: {
          stacked: true,
          title: { display: true, text: xTitle },
          grid: { display: false },
        },
        y: {
          stacked: true,
          min: 0,
          max: 100,
          title: { display: true, text: "Share of jobs in play" },
          ticks: { callback: (value: string | number) => `${value}%` },
        },
      },
      plugins: {
        legend: { position: "bottom" as const, labels: { boxWidth: 14, boxHeight: 14 } },
        tooltip: {
          callbacks: {
            title: (items: TooltipItem<"bar">[]) =>
              // "08–12 h" for hour bins; day labels stand on their own.
              items.length > 0 ? `${items[0].label}${xTitle === "Hour of day" ? " h" : ""}` : "",
            // Percent on screen, totals on hover -- this is where the absolute
            // numbers live.
            label: (ctx: TooltipItem<"bar">) => {
              const bin = bins[ctx.dataIndex];
              const state = BAR_SEGMENT_ORDER[ctx.datasetIndex];
              const count = countOf(bin, state);
              const share = bin.inPlay > 0 ? ((count / bin.inPlay) * 100).toFixed(1) : "0.0";
              return `${SEGMENT_STYLES[state].label}: ${count.toLocaleString()} jobs (${share}%)`;
            },
            footer: (items: TooltipItem<"bar">[]) => {
              if (items.length === 0) return "";
              const bin = bins[items[0].dataIndex];
              return `${bin.inPlay.toLocaleString()} jobs in play by the end of this bin`;
            },
          },
        },
      },
    };

    return { data, options };
  }, [bins, xTitle]);

  return (
    <Box role="img" aria-label={label} sx={{ position: "relative", width: "100%", height }}>
      <Bar data={data} options={options} />
    </Box>
  );
}
