"use client";

import { useState } from "react";
import { Alert, AlertTitle, Box, Button, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Link from "next/link";

import "@/components/ClusterAnalyzer/chartSetup";
import HoldClassifier from "@/components/ClusterAnalyzer/HoldClassifier";
import ResourceReport from "@/components/ClusterAnalyzer/ResourceReport";
import RuntimeHistogram from "@/components/ClusterAnalyzer/RuntimeHistogram";
import StatusDashboard from "@/components/ClusterAnalyzer/StatusDashboard";

import type { ClusterInfo } from "../../types";
import type { ClusterAnalysisFile } from "../types";

interface ClusterDetailViewProps {
  clusterId: string;
  info: ClusterInfo | null;
  analysis: ClusterAnalysisFile | null;
  /** Set when the bake deliberately passed this cluster over for its size. */
  skipped: { cluster: number; jobs: number; reason: string } | null;
  /** Set when the bake attempted this cluster and errored. */
  failed: { cluster: number; reason: string } | null;
  owner: string;
  asOfGeneratedAt: string;
}

const TABS = ["Status Dashboard", "Runtime Histogram", "Hold Classifier", "Resource Report"];

function TabPanel({
  value,
  index,
  children,
}: {
  value: number;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <Box role="tabpanel" hidden={value !== index} sx={{ pt: 3 }}>
      {value === index && children}
    </Box>
  );
}

export default function ClusterDetailView({
  clusterId,
  info,
  analysis,
  skipped,
  failed,
  owner,
  asOfGeneratedAt,
}: ClusterDetailViewProps) {
  const [tab, setTab] = useState(0);

  return (
    <Box
      component="main"
      sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 }, maxWidth: 1100, mx: "auto" }}
    >
      <Button
        component={Link}
        href="/days"
        startIcon={<ArrowBackIcon />}
        size="small"
        sx={{ mb: 2 }}
      >
        Back to the calendar
      </Button>

      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Cluster {clusterId}
        </Typography>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          {info
            ? `${info.total.toLocaleString()} jobs queued in the window` +
              (info.firstQueued ? `, first on ${info.firstQueued}` : "") +
              `. ${owner}.`
            : `No cluster ${clusterId} in the baked window.`}
        </Typography>
      </Stack>

      {!analysis ? (
        skipped ? (
          <Alert severity="warning">
            <AlertTitle>Too large to analyze yet</AlertTitle>
            Cluster {clusterId} holds {skipped.jobs.toLocaleString()} jobs, above the bake&apos;s
            ceiling. The per-cluster aggregations cost about 1.7s on a small cluster but over
            100s on one this size — and the cost is in the aggregations, not the query filter, so
            it is still being tracked down. Re-run with{" "}
            <code>MAX_CLUSTER_JOBS=0 npx tsx scripts/build-cluster-data.ts</code> to attempt it
            anyway. The calendar view already covers this cluster in full.
          </Alert>
        ) : failed ? (
          <Alert severity="error">
            <AlertTitle>Analysis failed</AlertTitle>
            The bake attempted cluster {clusterId} and errored: <code>{failed.reason}</code>
          </Alert>
        ) : (
          <Alert severity="info">
            <AlertTitle>Cluster analysis not baked</AlertTitle>
            This view is generated from Adstash aggregations at build time by{" "}
            <code>scripts/build-cluster-data.ts</code>, which needs a reachable Elasticsearch. No
            file was found for cluster {clusterId}. Run{" "}
            <code>node scripts/build-day-data.mjs</code> then{" "}
            <code>npx tsx scripts/build-cluster-data.ts</code> with the tunnel up, and rebuild.
          </Alert>
        )
      ) : (
        <>
          {analysis.warnings.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle>Truncated aggregations</AlertTitle>
              <Stack component="ul" sx={{ m: 0, pl: 2 }} spacing={0.5}>
                {analysis.warnings.map((w) => (
                  <Typography component="li" variant="body2" key={w}>
                    {w}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          )}

          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
            {TABS.map((label) => (
              <Tab key={label} label={label} />
            ))}
          </Tabs>

          <TabPanel value={tab} index={0}>
            <StatusDashboard data={analysis.dashboard} />
          </TabPanel>
          <TabPanel value={tab} index={1}>
            <RuntimeHistogram histogram={analysis.histogram} scatter={analysis.scatter} />
          </TabPanel>
          <TabPanel value={tab} index={2}>
            {/*
              These numbers are keyed on LastJobStatus, not JobStatus. In the history
              index JobStatus is the state a job finished in, so the upstream
              JobStatus == 5 filter finds nothing; saying so here keeps a small hold
              count from reading as a bug.
            */}
            <Alert severity="info" sx={{ mb: 2 }}>
              Held jobs are identified by <code>{analysis.meta.holdsKeyedOn}</code>, since these are
              terminal history records where <code>JobStatus</code> only carries the final state.
              Hold reason text is not published — codes and counts only.
            </Alert>
            <HoldClassifier data={analysis.holds} />
          </TabPanel>
          <TabPanel value={tab} index={3}>
            <ResourceReport data={analysis.analytics} />
          </TabPanel>

          <Paper variant="outlined" sx={{ mt: 4, p: 2 }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Baked {new Date(analysis.generatedAt).toLocaleString()} from{" "}
              {analysis.meta.requests} Elasticsearch aggregations ({analysis.meta.tookMs}ms of query
              time, {analysis.meta.documentsFetched} documents transferred). Calendar data baked{" "}
              {new Date(asOfGeneratedAt).toLocaleString()}. Cluster IDs are anonymized labels, not
              real HTCondor ClusterIds.
            </Typography>
          </Paper>
        </>
      )}
    </Box>
  );
}
