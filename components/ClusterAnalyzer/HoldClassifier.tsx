"use client";

import {
  Alert,
  Box,
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
import { formatDuration } from "@/lib/format";
import type { HoldData } from "@/lib/types";

function epochToString(epoch: number): string {
  const d = new Date(epoch * 1000);
  if (Number.isNaN(d.getTime())) return "N/A";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function HoldClassifier({ data }: { data: HoldData }) {
  if (data.heldCount === 0) {
    return (
      <Alert severity="success">
        No held jobs found in this file. The hold classifier groups jobs with{" "}
        <code>JobStatus == 5</code> by their <code>HoldReasonCode</code> — this dataset contains no
        such jobs (and no hold columns), so there is nothing to classify.
      </Alert>
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Held jobs in cluster: <strong>{data.heldCount}</strong>
      </Typography>

      {data.timeStats && (
        <Stack spacing={0.5} sx={{ mb: 3 }}>
          <Typography variant="subtitle2">⏱️ Time analysis</Typography>
          <Typography variant="body2">First held: {epochToString(data.timeStats.firstHeld)}</Typography>
          <Typography variant="body2">Last held: {epochToString(data.timeStats.lastHeld)}</Typography>
          <Typography variant="body2">Duration: {data.timeStats.durationHours.toFixed(1)} hours</Typography>
          <Typography variant="body2">Avg hold: {formatDuration(data.timeStats.avgHoldDuration)}</Typography>
        </Stack>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Hold Reason Label</TableCell>
              <TableCell align="right">SubCode</TableCell>
              <TableCell align="right">% of Held Jobs (Count)</TableCell>
              <TableCell align="right">Avg Hold Time</TableCell>
              <TableCell>Example Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.buckets.map((b, i) => (
              <TableRow key={`${b.code}-${i}`}>
                <TableCell>{b.label}</TableCell>
                <TableCell align="right">{b.subCode}</TableCell>
                <TableCell align="right">
                  {b.percent.toFixed(1)}% ({b.count})
                </TableCell>
                <TableCell align="right">{b.avgHoldLabel}</TableCell>
                <TableCell>{b.exampleReason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" gutterBottom>
        Legend
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell align="right">Code</TableCell>
              <TableCell>Label</TableCell>
              <TableCell>Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.legend.map((l) => (
              <TableRow key={l.code}>
                <TableCell align="right">{l.code}</TableCell>
                <TableCell>{l.label}</TableCell>
                <TableCell>{l.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
