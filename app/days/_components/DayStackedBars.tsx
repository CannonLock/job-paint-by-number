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
  /** Accessible description; the canvas itself is opaque to a screen reader. */
  label: string;
}

/**
 * One day as six 100%-stacked bars, one per 4-hour bin.
 *
 * The view is percentages so a 500-job day and a 900,000-job day both read as
 * "how did the day's work resolve"; the absolute counts live in the tooltip.
 *
 * Bins the model marked undrawn get null data points rather than zeroes: they
 * keep their tick on the axis -- the day is still 24 hours long -- but draw
 * nothing and raise no tooltip. That is what stops a cluster that finished at
 * 08:00 from repeating an all-teal bar four more times.
 */
export default function DayStackedBars({ bins, height = 320, label }: DayStackedBarsProps) {
  const { data, options } = useMemo(() => {
    const data = {
      labels: bins.map((bin) => bin.label),
      datasets: BAR_SEGMENT_ORDER.map((state) => ({
        label: SEGMENT_STYLES[state].label,
        data: bins.map((bin) =>
          bin.drawn && bin.inPlay > 0 ? (bin[state] / bin.inPlay) * 100 : null,
        ),
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
          title: { display: true, text: "Hour of day" },
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
            title: (items: TooltipItem<"bar">[]) => (items.length > 0 ? `${items[0].label} h` : ""),
            // Percent on screen, totals on hover -- this is where the absolute
            // numbers live.
            label: (ctx: TooltipItem<"bar">) => {
              const bin = bins[ctx.dataIndex];
              const state = BAR_SEGMENT_ORDER[ctx.datasetIndex];
              const count = bin[state];
              const share = bin.inPlay > 0 ? ((count / bin.inPlay) * 100).toFixed(1) : "0.0";
              return `${SEGMENT_STYLES[state].label}: ${count.toLocaleString()} jobs (${share}%)`;
            },
            footer: (items: TooltipItem<"bar">[]) => {
              if (items.length === 0) return "";
              const bin = bins[items[0].dataIndex];
              const base = `${bin.inPlay.toLocaleString()} jobs in play by the end of this bin`;
              return bin.terminal ? `${base} · all of them in a final state` : base;
            },
          },
        },
      },
    };

    return { data, options };
  }, [bins]);

  return (
    <Box role="img" aria-label={label} sx={{ position: "relative", width: "100%", height }}>
      <Bar data={data} options={options} />
    </Box>
  );
}
