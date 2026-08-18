"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import PlayArrow from "@mui/icons-material/PlayArrow";
import Pause from "@mui/icons-material/Pause";
import RestartAlt from "@mui/icons-material/RestartAlt";

import type { DayData } from "../sankey/types";
import { ALL_CLUSTERS, formatDayLong } from "../sankey/_components/dayModel";
import {
  SAND_ACTIVE,
  SAND_COMPLETED,
  SAND_PLACED,
  SAND_REMOVED,
  SandEngine,
  type BucketSpec,
  type SandMaterial,
} from "./_components/sandEngine";
import { GrainMeter, buildTimeline, daySeconds, jobsPerGrain } from "./_components/timeline";

// Doubled from the first pass so each grain covers a quarter of the area and the
// sand reads as fine rather than chunky. 339k cells is still a cheap frame: the
// automaton is one typed-array pass with no allocation.
const GRID_W = 652;
const GRID_H = 520;
const SCALE = 1.5;

/**
 * A terraced cascade rather than boxes. Placed heaps on a high shelf, Active on a
 * lower one, Completed and Removed on the ground, so every transfer is a genuine
 * fall. The `lip` keeps side walls to a stub: with full walls each state filled
 * into a rectangle of sand, where a stub lets the heap rise as a cone with its
 * natural angle of repose — which is what makes it read as a pile.
 */
const BUCKETS: BucketSpec[] = [
  { id: "placed", label: "Placed", material: SAND_PLACED, x0: 16, x1: 254, y0: 36, y1: 200, lip: 6 },
  { id: "active", label: "Active", material: SAND_ACTIVE, x0: 270, x1: 430, y0: 216, y1: 320, lip: 6 },
  { id: "removed", label: "Removed", material: SAND_REMOVED, x0: 16, x1: 300, y0: 352, y1: 482, lip: 6 },
  // The terminal heap: widest, because it accumulates every finished job and never
  // drains. Its floor slab abuts Removed's so the ground reads as one surface.
  { id: "completed", label: "Completed", material: SAND_COMPLETED, x0: 305, x1: 640, y0: 330, y1: 482, lip: 6 },
];

/**
 * A cone at the automaton's 45-degree repose on a shelf of width w holds w²/4
 * grains before its base reaches the shelf edges — capacity is quadratic in shelf
 * width, not width×height as it was when walls made each bucket a box.
 */
const pileCapacity = (id: string) => {
  const b = BUCKETS.find((bucket) => bucket.id === id)!;
  const w = b.x1 - b.x0;
  return (w * w) / 4;
};
const CAPACITY = {
  completed: pileCapacity("completed"),
  placed: pileCapacity("placed"),
  removed: pileCapacity("removed"),
};

const SPEEDS = [0.5, 1, 2, 4];

interface SandViewProps {
  data: DayData;
}

interface Totals {
  placed: number;
  active: number;
  completed: number;
  removed: number;
}

export default function SandView({ data }: SandViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cluster, setCluster] = useState<string>(ALL_CLUSTERS);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [dayIndex, setDayIndex] = useState(0);
  const [totals, setTotals] = useState<Totals>({ placed: 0, active: 0, completed: 0, removed: 0 });

  const timeline = useMemo(() => buildTimeline(data, cluster), [data, cluster]);
  const perGrain = useMemo(() => jobsPerGrain(timeline, CAPACITY), [timeline]);

  // Everything the animation loop mutates lives in refs: re-rendering React 60
  // times a second to move sand would cost more than the simulation itself.
  const engineRef = useRef<SandEngine | null>(null);
  const metersRef = useRef<Record<string, GrainMeter>>({});
  /**
   * Grains owed to a destination but not yet moved.
   *
   * transfer() can only take sand that has actually settled in the source bucket,
   * and Active is a pass-through holding a few dozen grains while hundreds are still
   * in flight toward it. Asking for 400 and getting 12 used to drop the difference,
   * so Completed received a small fraction of what actually finished. The shortfall
   * is now carried to the next frame and paid off as sand lands.
   */
  const pendingRef = useRef<Record<string, number>>({});
  const progressRef = useRef(0);
  const dayRef = useRef(0);
  const totalsRef = useRef<Totals>({ placed: 0, active: 0, completed: 0, removed: 0 });
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  playingRef.current = playing;
  speedRef.current = speed;

  /**
   * Drop the window-opening backlog from just above the shelves, so the scene
   * starts with the piles the data says already existed rather than empty air.
   */
  const seed = useCallback(
    (engine: SandEngine) => {
      // Defensive against a stale memoized timeline from a previous compile (Fast
      // Refresh keeps useMemo values): missing `initial` must mean "no seed", not a
      // TypeError that kills the effect before the canvas ever paints -- an
      // alpha:false canvas that is never drawn displays as solid black.
      const initial = timeline.initial ?? { placed: 0, active: 0 };
      const placedSeed = Math.round(initial.placed / perGrain);
      const activeSeed = Math.round(initial.active / perGrain);
      if (placedSeed > 0) engine.pour("placed", placedSeed, SAND_PLACED, 20);
      if (activeSeed > 0) engine.pour("active", activeSeed, SAND_ACTIVE, 200);
    },
    [timeline, perGrain],
  );

  const reset = useCallback(() => {
    engineRef.current?.clearSand();
    if (engineRef.current) seed(engineRef.current);
    metersRef.current = {
      placedNew: new GrainMeter(perGrain),
      placedToActive: new GrainMeter(perGrain),
      placedToRemoved: new GrainMeter(perGrain),
      placedToCompleted: new GrainMeter(perGrain),
      activeToCompleted: new GrainMeter(perGrain),
      activeToRemoved: new GrainMeter(perGrain),
    };
    pendingRef.current = {
      placedToActive: 0,
      placedToRemoved: 0,
      placedToCompleted: 0,
      activeToCompleted: 0,
      activeToRemoved: 0,
    };
    progressRef.current = 0;
    dayRef.current = 0;
    totalsRef.current = { placed: 0, active: 0, completed: 0, removed: 0 };
    setDayIndex(0);
    setTotals({ placed: 0, active: 0, completed: 0, removed: 0 });
  }, [perGrain, seed]);

  useEffect(() => {
    reset();
  }, [reset, cluster]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new SandEngine({ width: GRID_W, height: GRID_H, buckets: BUCKETS });
    engineRef.current = engine;
    seed(engine);

    // Grid-resolution backing buffer, then one scaled blit with smoothing off. Far
    // cheaper than drawing thousands of rects, and it keeps grains crisply square.
    const offscreen = document.createElement("canvas");
    offscreen.width = GRID_W;
    offscreen.height = GRID_H;
    const offCtx = offscreen.getContext("2d", { alpha: false });
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!offCtx || !ctx) return;

    const image = offCtx.createImageData(GRID_W, GRID_H);
    const buf32 = new Uint32Array(image.data.buffer);
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    let last = performance.now();
    let uiClock = 0;

    const emitFor = (fraction: number) => {
      const day = timeline.days[dayRef.current];
      if (!day) return;
      const meters = metersRef.current;
      const running = totalsRef.current;

      // Each channel's share of this frame, metered so fractional grains accumulate
      // instead of rounding away on quiet days.
      const pour = meters.placedNew.take(day.placedNew * fraction);
      if (pour > 0) engine.pour("placed", pour, SAND_PLACED);

      // Queue what this frame owes, then pay down as much of the backlog as the
      // source bucket can actually supply this tick.
      const pending = pendingRef.current;
      const owe = (channel: string, jobs: number) => {
        pending[channel] += meters[channel].take(jobs);
      };
      const pay = (channel: string, from: string, to: string, material: SandMaterial) => {
        if (pending[channel] <= 0) return;
        pending[channel] -= engine.transfer(from, to, pending[channel], material);
      };

      owe("placedToActive", day.placedToActive * fraction);
      owe("placedToRemoved", day.placedToRemoved * fraction);
      owe("placedToCompleted", day.placedToCompleted * fraction);
      owe("activeToCompleted", day.activeToCompleted * fraction);
      owe("activeToRemoved", day.activeToRemoved * fraction);

      pay("placedToActive", "placed", "active", SAND_ACTIVE);
      pay("placedToRemoved", "placed", "removed", SAND_REMOVED);
      pay("placedToCompleted", "placed", "completed", SAND_COMPLETED);
      pay("activeToCompleted", "active", "completed", SAND_COMPLETED);
      pay("activeToRemoved", "active", "removed", SAND_REMOVED);

      // Job counts come from the data, not from grain counts, so the readout stays
      // exact even though the sand is quantised.
      running.placed += day.placedNew * fraction;
      running.active += day.placedToActive * fraction;
      running.completed += (day.activeToCompleted + day.placedToCompleted) * fraction;
      running.removed += (day.activeToRemoved + day.placedToRemoved) * fraction;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (playingRef.current && dayRef.current < timeline.days.length) {
        // Activity-paced: a dead day flicks past, a million-job day lingers.
        const perDay = daySeconds(timeline.days[dayRef.current]) / speedRef.current;
        const advance = dt / perDay;
        const remaining = 1 - progressRef.current;
        const chunk = Math.min(advance, remaining);
        emitFor(chunk);
        progressRef.current += chunk;
        if (progressRef.current >= 1) {
          progressRef.current = 0;
          dayRef.current++;
        }
      }

      engine.step();
      engine.render(buf32);
      offCtx.putImageData(image, 0, 0);
      ctx.drawImage(offscreen, 0, 0, GRID_W * SCALE, GRID_H * SCALE);

      // Throttle React updates to ~8/s; the canvas is already current.
      uiClock += dt;
      if (uiClock > 0.12) {
        uiClock = 0;
        setDayIndex(Math.min(dayRef.current, timeline.days.length - 1));
        setTotals({ ...totalsRef.current });
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      engineRef.current = null;
    };
  }, [timeline, seed]);

  const currentDay = timeline.days[Math.min(dayIndex, timeline.days.length - 1)];
  const finished = dayIndex >= timeline.days.length - 1;

  return (
    <Box component="main" sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 }, maxWidth: 1180, mx: "auto" }}>
      <Stack spacing={0.5} sx={{ mb: 2.5 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {data.owner}&apos;s jobs, as sand
        </Typography>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          Every grain is {perGrain.toLocaleString()} jobs. Sand pours onto the Placed shelf as
          work is submitted, streams off a pile when jobs change state, and heaps up for good in
          Completed and Removed. {timeline.totals.placed.toLocaleString()} jobs over{" "}
          {timeline.days.length} days.
        </Typography>
      </Stack>

      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <IconButton
          onClick={() => setPlaying((p) => !p)}
          color="primary"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause /> : <PlayArrow />}
        </IconButton>
        <Button startIcon={<RestartAlt />} onClick={reset} size="small">
          Restart
        </Button>

        <Box sx={{ minWidth: 160 }}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Speed
          </Typography>
          <Slider
            size="small"
            value={SPEEDS.indexOf(speed)}
            min={0}
            max={SPEEDS.length - 1}
            step={1}
            marks
            onChange={(_, v) => setSpeed(SPEEDS[v as number])}
            valueLabelDisplay="off"
            aria-label="Playback speed"
          />
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 32 }}>
          {speed}x
        </Typography>

        <Select
          size="small"
          value={cluster}
          onChange={(e) => setCluster(String(e.target.value))}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value={ALL_CLUSTERS}>All clusters ({data.clusters.length})</MenuItem>
          {data.clusters.map((c) => (
            <MenuItem key={c.id} value={String(c.id)}>
              Cluster {c.id} · {c.total.toLocaleString()} jobs
            </MenuItem>
          ))}
        </Select>
      </Stack>

      <Paper variant="outlined" sx={{ position: "relative", overflow: "hidden", lineHeight: 0 }}>
        <Box
          component="canvas"
          ref={canvasRef}
          width={GRID_W * SCALE}
          height={GRID_H * SCALE}
          sx={{
            display: "block",
            width: "100%",
            height: "auto",
            // Keeps grains as hard squares instead of blurring them on upscale.
            imageRendering: "pixelated",
            backgroundColor: "#f4f3f0",
          }}
        />

        {/* Labels are HTML positioned over the canvas, so they stay sharp at any
            scale rather than being drawn into the pixel grid. */}
        {BUCKETS.map((b) => {
          const value =
            b.id === "placed"
              ? totals.placed - totals.active - totals.removed
              : b.id === "active"
                ? totals.active - totals.completed - totals.removed
                : b.id === "completed"
                  ? totals.completed
                  : totals.removed;
          return (
            <Box
              key={b.id}
              sx={{
                position: "absolute",
                left: `${(b.x0 / GRID_W) * 100}%`,
                top: `${((b.y1 + 8) / GRID_H) * 100}%`,
                width: `${((b.x1 - b.x0) / GRID_W) * 100}%`,
                textAlign: "center",
                pointerEvents: "none",
              }}
            >
              <Typography sx={{ fontSize: "0.72rem", fontWeight: 800, lineHeight: 1.2 }}>
                {b.label}
              </Typography>
              <Typography sx={{ fontSize: "0.68rem", color: "text.secondary", lineHeight: 1.2 }}>
                {Math.max(0, Math.round(value)).toLocaleString()}
              </Typography>
            </Box>
          );
        })}

        {/* The clock, bottom right as asked. */}
        <Box sx={{ position: "absolute", right: 16, bottom: 14, textAlign: "right", pointerEvents: "none" }}>
          <Typography sx={{ fontSize: "0.7rem", color: "text.secondary", lineHeight: 1.2 }}>
            {finished ? "Finished" : `Day ${dayIndex + 1} of ${timeline.days.length}`}
          </Typography>
          <Typography
            sx={{ fontSize: "1.35rem", fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}
          >
            {currentDay ? formatDayLong(currentDay.day) : ""}
          </Typography>
          {currentDay && (
            <Typography sx={{ fontSize: "0.72rem", color: "text.secondary", lineHeight: 1.2 }}>
              {currentDay.transitions.toLocaleString()} changing state
            </Typography>
          )}
        </Box>
      </Paper>

      <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 2, display: "block" }}>
        Falling-sand cellular automaton over a {GRID_W}×{GRID_H} grid, with ballistic grains in
        transit between buckets. Counts shown are real job numbers from the baked data; the sand is
        quantised at {perGrain.toLocaleString()} jobs per grain, so a bucket&apos;s height is
        approximate where its count is not.
      </Typography>
    </Box>
  );
}
