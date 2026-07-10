"use client";

import { useState } from "react";
import {
  Box,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ReplayIcon from "@mui/icons-material/Replay";

import { ASPECT_RAMP, NO_DATA_COLOR, STAGE_COLORS } from "./renderer";
import type { ColorMode, JobMeta, StageCounts } from "./data";

const rgb = (c: number[]) =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

const RAMP_CSS = `linear-gradient(90deg, ${ASPECT_RAMP.map(
  (c, i) => `${rgb(c)} ${(i / (ASPECT_RAMP.length - 1)) * 100}%`,
).join(", ")})`;

const SPEEDS: { label: string; traverse: number }[] = [
  { label: "0.5×", traverse: 120 },
  { label: "1×", traverse: 60 },
  { label: "2×", traverse: 30 },
  { label: "4×", traverse: 15 },
];

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: "stage", label: "Job Stage" },
  { value: "mem", label: "Requested Memory" },
  { value: "disk", label: "Requested Disk" },
  { value: "wait", label: "Queue Wait" },
  { value: "dur", label: "Run Duration" },
];

const STAGE_LEGEND: { key: keyof StageCounts; label: string; color: string }[] = [
  { key: "queued", label: "Queued", color: rgb(STAGE_COLORS[1]) },
  { key: "running", label: "Running", color: rgb(STAGE_COLORS[2]) },
  { key: "completed", label: "Completed", color: rgb(STAGE_COLORS[3]) },
  { key: "unsubmitted", label: "Not yet submitted", color: rgb(STAGE_COLORS[0]) },
];

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function aspectLegend(mode: ColorMode, meta: JobMeta) {
  switch (mode) {
    case "mem":
      return { title: "Requested Memory", low: "10 MB", high: `${meta.maxMem} MB`, note: "linear" };
    case "disk":
      return {
        title: "Requested Disk",
        low: "10 MB",
        high: `${(meta.maxDisk / 1024 / 1024).toFixed(1)} GB`,
        note: "log scale",
      };
    case "wait":
      return {
        title: "Queue Wait",
        low: "0",
        high: fmtDuration(meta.maxWait),
        note: "√ scale · gray = never ran",
      };
    case "dur":
      return {
        title: "Run Duration",
        low: "0",
        high: fmtDuration(meta.maxDur),
        note: "√ scale",
      };
    default:
      return null;
  }
}

const nf = new Intl.NumberFormat("en-US");

export interface ControlPanelProps {
  meta: JobMeta;
  playing: boolean;
  playhead: number; // seconds from t0
  traverse: number; // seconds to cross the whole timeline
  colorMode: ColorMode;
  counts: StageCounts | null;
  onTogglePlay: () => void;
  onReset: () => void;
  onScrub: (playhead: number) => void;
  onTraverse: (traverse: number) => void;
  onColorMode: (mode: ColorMode) => void;
}

export default function ControlPanel(props: ControlPanelProps) {
  const { meta, playing, playhead, traverse, colorMode, counts } = props;
  const [open, setOpen] = useState(true);

  const dateAtPlayhead = new Date((meta.t0 + playhead) * 1000);
  const dayNum = Math.floor(playhead / 86400) + 1;
  const totalDays = Math.ceil(meta.tMax / 86400);
  const legend = aspectLegend(colorMode, meta);

  // Before expansion the menu is just a button that fades when not hovered.
  if (!open) {
    return (
      <IconButton
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        sx={{
          position: "absolute",
          bottom: 16,
          right: 16,
          color: "#e8eaf0",
          bgcolor: "rgba(16, 18, 27, 0.82)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
          opacity: 0.3,
          transition: "opacity 0.35s ease",
          "&:hover": { opacity: 1, bgcolor: "rgba(16, 18, 27, 0.92)" },
        }}
      >
        <MenuIcon />
      </IconButton>
    );
  }

  // Once expanded the panel stays fully opaque.
  return (
    <Paper
      elevation={0}
      sx={{
        position: "absolute",
        bottom: 16,
        right: 16,
        width: 340,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 32px)",
        overflowY: "auto",
        p: 2,
        borderRadius: 3,
        color: "#e8eaf0",
        bgcolor: "rgba(16, 18, 27, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <IconButton
          size="small"
          onClick={() => setOpen(false)}
          sx={{ color: "#e8eaf0" }}
          aria-label="Collapse menu"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: 0.3 }}>
          HTCondor Job Timeline
        </Typography>
      </Stack>

      <Box sx={{ mt: 1.5 }}>
          {/* Transport */}
          <Stack direction="row" alignItems="center" spacing={1}>
            <IconButton
              onClick={props.onTogglePlay}
              sx={{
                color: "#0a0b10",
                bgcolor: "#38d0f8",
                "&:hover": { bgcolor: "#5fdcfa" },
              }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <PauseIcon /> : <PlayArrowIcon />}
            </IconButton>
            <IconButton onClick={props.onReset} sx={{ color: "#e8eaf0" }} aria-label="Restart">
              <ReplayIcon />
            </IconButton>
            <Box sx={{ flex: 1, textAlign: "right", lineHeight: 1.2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {dateAtPlayhead.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}{" "}
                {dateAtPlayhead.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Typography>
              <Typography variant="caption" sx={{ color: "#9aa0b5" }}>
                Day {dayNum} of {totalDays}
              </Typography>
            </Box>
          </Stack>

          {/* Scrubber */}
          <Slider
            size="small"
            min={0}
            max={meta.tMax}
            value={Math.min(playhead, meta.tMax)}
            onChange={(_, v) => props.onScrub(v as number)}
            sx={{
              mt: 1,
              color: "#38d0f8",
              "& .MuiSlider-rail": { opacity: 0.3 },
            }}
            aria-label="Timeline position"
          />

          {/* Speed */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ color: "#9aa0b5" }}>
              Speed
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={traverse}
              onChange={(_, v) => v && props.onTraverse(v)}
              sx={{
                "& .MuiToggleButton-root": {
                  color: "#9aa0b5",
                  borderColor: "rgba(255,255,255,0.12)",
                  px: 1,
                  py: 0.2,
                  fontSize: "0.72rem",
                },
                "& .Mui-selected": {
                  color: "#0a0b10 !important",
                  bgcolor: "#38d0f8 !important",
                },
              }}
            >
              {SPEEDS.map((s) => (
                <ToggleButton key={s.traverse} value={s.traverse}>
                  {s.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>

          {/* Color mode */}
          <Typography variant="caption" sx={{ color: "#9aa0b5" }}>
            Color boxes by
          </Typography>
          <Select
            size="small"
            fullWidth
            value={colorMode}
            onChange={(e) => props.onColorMode(e.target.value as ColorMode)}
            sx={{
              mt: 0.5,
              mb: 1.5,
              color: "#e8eaf0",
              bgcolor: "rgba(255,255,255,0.05)",
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.15)" },
              "& .MuiSvgIcon-root": { color: "#e8eaf0" },
            }}
            MenuProps={{
              PaperProps: { sx: { bgcolor: "#14161f", color: "#e8eaf0" } },
            }}
          >
            {COLOR_MODES.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                {m.label}
              </MenuItem>
            ))}
          </Select>

          {/* Legend */}
          {colorMode === "stage" ? (
            <Stack spacing={0.5}>
              {STAGE_LEGEND.map((s) => (
                <Stack key={s.key} direction="row" alignItems="center" spacing={1}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: 0.5,
                      bgcolor: s.color,
                      border: "1px solid rgba(255,255,255,0.15)",
                    }}
                  />
                  <Typography variant="caption" sx={{ flex: 1 }}>
                    {s.label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "#9aa0b5", fontVariantNumeric: "tabular-nums" }}>
                    {counts ? nf.format(counts[s.key]) : "—"}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            legend && (
              <Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {legend.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "#9aa0b5" }}>
                    {legend.note}
                  </Typography>
                </Stack>
                <Box sx={{ height: 12, borderRadius: 1, background: RAMP_CSS }} />
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                  <Typography variant="caption" sx={{ color: "#9aa0b5" }}>
                    {legend.low}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "#9aa0b5" }}>
                    {legend.high}
                  </Typography>
                </Stack>
                {colorMode === "wait" && (
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.75 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: 0.5,
                        bgcolor: rgb(NO_DATA_COLOR),
                        border: "1px solid rgba(255,255,255,0.15)",
                      }}
                    />
                    <Typography variant="caption" sx={{ color: "#9aa0b5" }}>
                      never ran ({nf.format(meta.neverRan)})
                    </Typography>
                  </Stack>
                )}
              </Box>
            )
          )}

          <Typography variant="caption" sx={{ display: "block", mt: 1.5, color: "#6b7089" }}>
            {nf.format(meta.count)} jobs · scroll to zoom · drag to pan
          </Typography>
        </Box>
    </Paper>
  );
}
