"use client";

import { Bar } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import {
  Alert,
  Box,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type {
  AnalyticsData,
  NumberSummary,
  ResourceRequestRow,
  SavingsRec,
  UsageDistributionBin,
} from "@/lib/types";

function RequestTable({
  title,
  rows,
  unit,
}: {
  title: string;
  rows: ResourceRequestRow[];
  unit: string;
}) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <Typography variant="subtitle2" gutterBottom>
        {title}
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No data
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.value}>
                  <TableCell>
                    {r.value}
                    {unit ? ` ${unit}` : ""}
                  </TableCell>
                  <TableCell align="right">{r.count} job(s)</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Grid>
  );
}

function fmt(n: number, percentage: boolean): string {
  return percentage ? `${n.toFixed(1)}%` : n.toFixed(1);
}

function SummaryTable({ summaries }: { summaries: NumberSummary[] }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Resource (units)</TableCell>
            <TableCell align="right">Min</TableCell>
            <TableCell align="right">Q1</TableCell>
            <TableCell align="right">Median</TableCell>
            <TableCell align="right">Q3</TableCell>
            <TableCell align="right">Max</TableCell>
            <TableCell align="right">StdDev</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {summaries.map((s) => (
            <TableRow key={s.label}>
              <TableCell>{s.label}</TableCell>
              {s.hasData ? (
                <>
                  <TableCell align="right">{fmt(s.min, s.percentage)}</TableCell>
                  <TableCell align="right">{fmt(s.q1, s.percentage)}</TableCell>
                  <TableCell align="right">{fmt(s.median, s.percentage)}</TableCell>
                  <TableCell align="right">{fmt(s.q3, s.percentage)}</TableCell>
                  <TableCell align="right">{fmt(s.max, s.percentage)}</TableCell>
                  <TableCell align="right">{fmt(s.stdDev, s.percentage)}</TableCell>
                </>
              ) : (
                <TableCell colSpan={6} align="right">
                  Not enough data
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function UtilizationBar({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2">{pct.toFixed(1)}%</Typography>
      </Box>
      <LinearProgress variant="determinate" value={clamped} sx={{ height: 10, borderRadius: 1 }} />
    </Box>
  );
}

function efficiencyNote(resource: string, eff: number): { severity: "warning" | "success"; text: string } {
  if (eff < 15)
    return { severity: "warning", text: `${resource} usage is ${eff.toFixed(1)}% — significant over-provisioning` };
  if (eff < 50)
    return { severity: "warning", text: `${resource} usage is ${eff.toFixed(1)}% — consider reducing requests` };
  if (eff > 80)
    return { severity: "success", text: `${resource} usage is ${eff.toFixed(1)}% — well optimized` };
  return { severity: "success", text: `${resource} usage is ${eff.toFixed(1)}%` };
}

function DistributionChart({
  title,
  bins,
  unit,
}: {
  title: string;
  bins: UsageDistributionBin[];
  unit: string;
}) {
  if (bins.length === 0) return null;
  const data: ChartData<"bar"> = {
    labels: bins.map((b) => `${b.label} ${unit}`),
    datasets: [
      {
        label: "# Jobs",
        data: bins.map((b) => b.count),
        backgroundColor: "#1976d2",
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
          label: (ctx) => `${bins[ctx.dataIndex].count} jobs (${bins[ctx.dataIndex].pct.toFixed(1)}%)`,
        },
      },
    },
    scales: { x: { beginAtZero: true } },
  };
  return (
    <Grid size={{ xs: 12, md: 6 }}>
      <Typography variant="subtitle2" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ height: 200 }}>
        <Bar data={data} options={options} />
      </Box>
    </Grid>
  );
}

function savingsText(s: SavingsRec): string {
  if (s.resource === "cpu") {
    return `Current request ${s.current.toFixed(1)} CPUs at ${s.currentEfficiency?.toFixed(1)}% efficiency → recommend ${s.recommended} CPUs (${s.jobsAffected} jobs).`;
  }
  const unit = "GiB";
  return `Current request ${s.current.toFixed(1)} ${unit} → recommend ${s.recommended.toFixed(1)} ${unit} (${s.reductionPct?.toFixed(0)}% less, ~${s.savingsGibHours?.toFixed(1)} ${unit}-hours saved across ${s.jobsAffected} jobs).`;
}

export default function ResourceReport({ data }: { data: AnalyticsData }) {
  return (
    <Box>
      <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Cluster ID
          </Typography>
          <Typography variant="h6">{data.clusterId || "—"}</Typography>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Job Count
          </Typography>
          <Typography variant="h6">{data.totalJobs.toLocaleString()}</Typography>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Avg Runtime
          </Typography>
          <Typography variant="h6">{data.avgRuntimeLabel}</Typography>
        </Box>
      </Stack>

      <Typography variant="subtitle1" gutterBottom>
        Requested resources
      </Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <RequestTable title="Memory (GiB)" rows={data.memRequested} unit="GiB" />
        <RequestTable title="Disk (GiB)" rows={data.diskRequested} unit="GiB" />
        <RequestTable title="CPUs" rows={data.cpuRequested} unit="" />
        <RequestTable title="GPUs" rows={data.gpuRequested} unit="" />
      </Grid>

      <Typography variant="subtitle1" gutterBottom>
        Usage summary
      </Typography>
      <Box sx={{ mb: 4 }}>
        <SummaryTable summaries={data.summaries} />
      </Box>

      <Typography variant="subtitle1" gutterBottom>
        Overall utilization (median efficiency)
      </Typography>
      <Box sx={{ mb: 4, maxWidth: 560 }}>
        <UtilizationBar label="Memory usage" pct={data.memEfficiency} />
        <UtilizationBar label="Disk usage" pct={data.diskEfficiency} />
        <UtilizationBar label="CPU usage" pct={data.cpuEfficiency} />
      </Box>

      {(data.memDistribution.length > 0 || data.diskDistribution.length > 0) && (
        <>
          <Typography variant="subtitle1" gutterBottom>
            Resource usage distribution
          </Typography>
          <Grid container spacing={3} sx={{ mb: 4 }}>
            <DistributionChart title="Memory" bins={data.memDistribution} unit={data.memDistributionUnit} />
            <DistributionChart title="Disk" bins={data.diskDistribution} unit={data.diskDistributionUnit} />
          </Grid>
        </>
      )}

      {data.savings.length > 0 && (
        <>
          <Typography variant="subtitle1" gutterBottom>
            Optimization recommendations
          </Typography>
          <Stack spacing={1} sx={{ mb: 4 }}>
            {data.savings.map((s) => (
              <Alert key={s.resource} severity="info">
                <strong style={{ textTransform: "capitalize" }}>{s.resource}: </strong>
                {savingsText(s)}
              </Alert>
            ))}
          </Stack>
        </>
      )}

      <Typography variant="subtitle1" gutterBottom>
        Efficiency notes
      </Typography>
      <Stack spacing={1}>
        {[
          efficiencyNote("Memory", data.memEfficiency),
          efficiencyNote("Disk", data.diskEfficiency),
          efficiencyNote("CPU", data.cpuEfficiency),
        ].map((n, i) => (
          <Alert key={i} severity={n.severity}>
            {n.text}
          </Alert>
        ))}
      </Stack>
    </Box>
  );
}
