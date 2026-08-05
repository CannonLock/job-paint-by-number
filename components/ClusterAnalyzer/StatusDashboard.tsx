"use client";

import { Bar } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { JOB_STATES, type DashboardData } from "@/lib/types";

const STATE_COLORS: Record<string, string> = {
  Idle: "#9e9e9e",
  Running: "#2e7d32",
  Removing: "#ed6c02",
  Completed: "#1976d2",
  Held: "#d32f2f",
  "Transferring Output": "#0288d1",
  Suspended: "#7b1fa2",
};

export default function StatusDashboard({ data }: { data: DashboardData }) {
  if (data.totalJobs === 0) {
    return <Typography color="text.secondary">No jobs found in the file.</Typography>;
  }

  const labels = [...JOB_STATES];
  const counts = labels.map((s) => data.counts[s]);

  const chartData: ChartData<"bar"> = {
    labels,
    datasets: [
      {
        label: "Job count",
        data: counts,
        backgroundColor: labels.map((s) => STATE_COLORS[s]),
        borderRadius: 4,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.x ?? 0;
            const pct = ((v / data.totalJobs) * 100).toFixed(1);
            return `${v} jobs (${pct}%)`;
          },
        },
      },
    },
    scales: {
      x: { beginAtZero: true, title: { display: true, text: "Number of jobs" } },
    },
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Total jobs: <strong>{data.totalJobs.toLocaleString()}</strong>
      </Typography>
      <Box sx={{ height: 320, mb: 3 }}>
        <Bar data={chartData} options={options} />
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell align="right">Count</TableCell>
              <TableCell align="right">%</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {labels.map((s) => {
              const c = data.counts[s];
              const pct = (c / data.totalJobs) * 100;
              return (
                <TableRow key={s}>
                  <TableCell>
                    <Box
                      component="span"
                      sx={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "2px",
                        bgcolor: STATE_COLORS[s],
                        mr: 1,
                      }}
                    />
                    {s}
                  </TableCell>
                  <TableCell align="right">{c.toLocaleString()}</TableCell>
                  <TableCell align="right">{pct.toFixed(1)}%</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
