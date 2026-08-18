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

import type { BinActivity } from "./binModel";
import { ACTIVITY_ORDER, ACTIVITY_STYLES } from "./palette";

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

interface DayActivityBarsProps {
  bins: BinActivity[];
  height?: number;
  /** X-axis title; the period card passes "Day" for its per-day bars. */
  xTitle?: string;
  /** Accessible description; the canvas itself is opaque to a screen reader. */
  label: string;
}

/**
 * One day as six count-stacked bars: how many state changes landed in each
 * 4-hour bin. Unlike the census chart this one is about magnitude -- a heavy bin
 * towers, an idle one is empty -- so the y axis is jobs, not percent.
 */
export default function DayActivityBars({
  bins,
  height = 320,
  xTitle = "Hour of day",
  label,
}: DayActivityBarsProps) {
  const { data, options } = useMemo(() => {
    const data = {
      labels: bins.map((bin) => bin.label),
      datasets: ACTIVITY_ORDER.map((state) => ({
        label: ACTIVITY_STYLES[state].label,
        data: bins.map((bin) => bin[state]),
        backgroundColor: ACTIVITY_STYLES[state].color,
        borderWidth: 0,
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
          title: { display: true, text: "State changes" },
          ticks: { precision: 0 },
        },
      },
      plugins: {
        legend: { position: "bottom" as const, labels: { boxWidth: 14, boxHeight: 14 } },
        tooltip: {
          callbacks: {
            title: (items: TooltipItem<"bar">[]) =>
              // "08–12 h" for hour bins; day labels stand on their own.
              items.length > 0 ? `${items[0].label}${xTitle === "Hour of day" ? " h" : ""}` : "",
            label: (ctx: TooltipItem<"bar">) => {
              const bin = bins[ctx.dataIndex];
              const state = ACTIVITY_ORDER[ctx.datasetIndex];
              return `${ACTIVITY_STYLES[state].label}: ${bin[state].toLocaleString()} jobs`;
            },
            footer: (items: TooltipItem<"bar">[]) => {
              if (items.length === 0) return "";
              const bin = bins[items[0].dataIndex];
              return `${bin.total.toLocaleString()} state changes in this bin`;
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
