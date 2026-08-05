"use client";

import { Bar, Scatter } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import { Alert, Box, Chip, Grid, Stack, Typography } from "@mui/material";
import { formatEpochHumanRelative, formatSecondsHuman } from "@/lib/format";
import type { HistogramData, ScatterData } from "@/lib/types";

const FAST_COLOR = "#d32f2f";
const NORMAL_COLOR = "#1976d2";

interface Props {
  histogram: HistogramData | null;
  scatter: ScatterData | null;
}

export default function RuntimeHistogram({ histogram, scatter }: Props) {
  if (!histogram) {
    return (
      <Alert severity="info">
        No valid <code>RemoteWallClockTime</code> data found to build a runtime histogram.
      </Alert>
    );
  }

  const labels = histogram.bins.map((b) => `${String(b.pctStart).padStart(2, "0")}–${String(b.pctEnd).padStart(2, "0")}%`);
  const histData: ChartData<"bar"> = {
    labels,
    datasets: [
      {
        label: "# Jobs",
        data: histogram.bins.map((b) => b.count),
        backgroundColor: histogram.bins.map((b) => (b.isFast ? FAST_COLOR : NORMAL_COLOR)),
        borderRadius: 4,
      },
    ],
  };

  const histOptions: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => `Percentile ${items[0].label}`,
          label: (ctx) => {
            const b = histogram.bins[ctx.dataIndex];
            return [
              `${b.count} jobs`,
              `Range: ${formatSecondsHuman(b.left)} – ${formatSecondsHuman(b.right)}`,
              `Median: ${formatSecondsHuman(b.median)}${b.isFast ? " (fast)" : ""}`,
            ];
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: "Runtime percentile" } },
      y: { beginAtZero: true, title: { display: true, text: "# Jobs" } },
    },
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Chip label={`ClusterId: ${histogram.clusterId || "—"}`} size="small" />
        <Chip label={`Jobs: ${histogram.totalRuntimeJobs}`} size="small" />
        <Chip
          label={`First submitted: ${histogram.firstSubmitted !== null ? formatEpochHumanRelative(histogram.firstSubmitted) : "N/A"}`}
          size="small"
        />
        <Chip
          label={`Last completed: ${histogram.lastCompleted !== null ? formatEpochHumanRelative(histogram.lastCompleted) : "N/A"}`}
          size="small"
        />
      </Stack>

      <Typography variant="subtitle1" gutterBottom>
        Runtime distribution by percentile
      </Typography>
      <Box sx={{ height: 320, mb: 1 }}>
        <Bar data={histData} options={histOptions} />
      </Box>
      <Alert severity={histogram.fastJobCount > 0 ? "warning" : "success"} sx={{ mb: 4 }}>
        Bars in <span style={{ color: FAST_COLOR, fontWeight: 600 }}>red</span> are percentile bins
        whose median runtime is under 10 minutes. Jobs in such bins:{" "}
        <strong>{histogram.fastJobCount}</strong>
      </Alert>

      {scatter && (
        <>
          <Typography variant="subtitle1" gutterBottom>
            Job index vs. runtime
          </Typography>
          <Grid container spacing={1} sx={{ mb: 1 }}>
            <Grid size="auto">
              <Chip label={`Median: ${formatSecondsHuman(scatter.median)}`} size="small" />
            </Grid>
            <Grid size="auto">
              <Chip label={`Correlation: ${scatter.correlation.toFixed(3)}`} size="small" />
            </Grid>
            <Grid size="auto">
              <Chip
                label={
                  scatter.trend === "longer"
                    ? "Trend: later jobs run LONGER ⚠️"
                    : scatter.trend === "faster"
                      ? "Trend: later jobs run FASTER ✓"
                      : "Trend: consistent runtime ✓"
                }
                color={scatter.trend === "longer" ? "warning" : scatter.trend === "faster" ? "success" : "default"}
                size="small"
              />
            </Grid>
          </Grid>
          <Box sx={{ height: 320 }}>
            <Scatter
              data={{
                datasets: [
                  {
                    label: "Job runtime",
                    data: scatter.points,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    backgroundColor: "rgba(25, 118, 210, 0.5)",
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) =>
                        `Job #${ctx.parsed.x ?? 0}: ${formatSecondsHuman(ctx.parsed.y ?? 0)}`,
                    },
                  },
                },
                scales: {
                  x: { title: { display: true, text: "Job index" }, min: 0, max: scatter.maxIndex },
                  y: {
                    title: { display: true, text: "Runtime (capped at p95)" },
                    min: 0,
                    max: scatter.maxRuntime || undefined,
                    ticks: { callback: (v) => formatSecondsHuman(Number(v)) },
                  },
                },
              }}
            />
          </Box>
          {scatter.outliers > 0 && (
            <Typography variant="caption" color="text.secondary">
              Note: {scatter.outliers} job(s) with runtime &gt; {formatSecondsHuman(scatter.maxRuntime)}{" "}
              (95th percentile) are capped to the top of the chart.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}
