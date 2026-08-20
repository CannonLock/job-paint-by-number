"use client";

// The Rust/WebAssembly variant of /sand.
//
// Deliberately a near-copy of `app/sand/view.tsx`: same lanes, same camera, same
// settle gate, same labels, same scrubber, same ms/frame readout. The ONLY
// difference is which engine runs the cells -- `WasmPileEngine` (Rust compiled to
// wasm, owning the cell array and the RGBA buffer in linear memory) instead of
// `PileEngine` (TypeScript, owning the same two arrays on the JS heap). Anything
// else that diverged would make the two numbers incomparable.
//
// The census math is not duplicated: this page imports the very same
// `app/sand/_components/timeline.ts` the original uses, so both pages are driven
// by identical job flows and only the cell-level physics differs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import Replay from "@mui/icons-material/Replay";
import RestartAlt from "@mui/icons-material/RestartAlt";
import ZoomIn from "@mui/icons-material/ZoomIn";
import ZoomOut from "@mui/icons-material/ZoomOut";
import FitScreen from "@mui/icons-material/FitScreen";

import type { DayData } from "../sankey/types";
import { ALL_CLUSTERS, formatDayLong, formatDayShort } from "../sankey/_components/dayModel";
import {
  GrainMeter,
  applyDay,
  buildTimeline,
  censusAt,
  daySeconds,
  peakCensus,
  type Census,
} from "../sand/_components/timeline";
import { SAND_ACTIVE, SAND_COMPLETED, SAND_PLACED, SAND_REMOVED } from "./_components/materials";
import type { SandMaterial } from "./_components/materials";
import {
  WasmPileEngine,
  loadWasmPileEngine,
  type LaneInput,
  type SandWasmModule,
} from "./_components/wasmEngine";

/** Lifecycle order, left to right; most transitions read as rightward moves. */
const LANES: { id: keyof Census; label: string; material: SandMaterial }[] = [
  { id: "placed", label: "Placed", material: SAND_PLACED },
  { id: "active", label: "Active", material: SAND_ACTIVE },
  { id: "completed", label: "Completed", material: SAND_COMPLETED },
  { id: "removed", label: "Removed", material: SAND_REMOVED },
];

const CANVAS_HEIGHT = 560;
const SPEEDS = [0.5, 1, 2, 4];
const MAX_ZOOM = 12;

interface Camera {
  /** World coordinates at the viewport centre. */
  cx: number;
  cy: number;
  /** Screen pixels per world cell. */
  zoom: number;
}

interface SandWasmViewProps {
  data: DayData;
}

export default function SandWasmView({ data }: SandWasmViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cluster, setCluster] = useState<string>(ALL_CLUSTERS);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [dayIndex, setDayIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [totals, setTotals] = useState<Census>({ placed: 0, active: 0, completed: 0, removed: 0 });
  /** Smoothed simulation+render cost per frame, for judging fidelity trade-offs. */
  const [frameMs, setFrameMs] = useState(0);

  // The engine has to be fetched over the network before anything can run, which
  // the TypeScript page never has to think about.
  const [wasm, setWasm] = useState<SandWasmModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadWasmPileEngine()
      .then((mod) => {
        if (alive) setWasm(mod);
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, []);

  const timeline = useMemo(() => buildTimeline(data, cluster), [data, cluster]);
  const peaks = useMemo(() => peakCensus(timeline), [timeline]);
  const peakActivity = useMemo(
    () => Math.max(1, ...timeline.days.map((d) => d.placedNew + d.transitions)),
    [timeline],
  );

  // Everything the animation loop mutates lives in refs: re-rendering React 60
  // times a second to move sand would cost more than the simulation itself.
  const engineRef = useRef<WasmPileEngine | null>(null);
  const metersRef = useRef<Record<string, GrainMeter>>({});
  /**
   * Grains owed to a destination but not yet moved: remove() can only vanish
   * sand that has actually settled, and Active is a pass-through whose grains
   * are often still mid-air when the data says they finish. The shortfall is
   * carried to the next frame and paid off as sand lands.
   */
  const pendingRef = useRef<Record<string, number>>({});
  const progressRef = useRef(0);
  const dayRef = useRef(0);
  /**
   * The live job census, advanced by the same flow numbers that drive the sand.
   * This -- not grain arithmetic -- is what the labels print, so a pile's number
   * is exact even though its height is quantised.
   */
  const censusRef = useRef<Census>({ placed: 0, active: 0, completed: 0, removed: 0 });
  const cameraRef = useRef<Camera>({ cx: 0, cy: 0, zoom: 1 });
  /** Camera actions the toolbar buttons call into; owned by the canvas effect. */
  const cameraControlsRef = useRef<{ zoomBy: (f: number) => void; fit: () => void } | null>(null);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  playingRef.current = playing;
  speedRef.current = speed;

  /**
   * Jump to the start of a day: each pile's census is stamped as an already-
   * settled cone and playback resumes from there. Day 0's census is the opening
   * backlog, so reset is just seekTo(0) -- the scene opens with the piles the
   * data says already existed.
   */
  const seekTo = useCallback(
    (target: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const clamped = Math.max(0, Math.min(target, timeline.days.length - 1));
      const census = censusAt(timeline, clamped);
      engine.clearSand();
      for (const lane of LANES) {
        // One grain per job: the stamped pile IS the census.
        const grains = Math.round(census[lane.id]);
        if (grains > 0) engine.stamp(lane.id, grains, lane.material);
      }
      metersRef.current = Object.fromEntries(
        ["placedNew", "placedToActive", "placedToRemoved", "placedToCompleted", "activeToCompleted", "activeToRemoved"].map(
          (key) => [key, new GrainMeter(1)],
        ),
      );
      pendingRef.current = {
        placedToActive: 0,
        placedToRemoved: 0,
        placedToCompleted: 0,
        activeToCompleted: 0,
        activeToRemoved: 0,
      };
      progressRef.current = 0;
      dayRef.current = clamped;
      censusRef.current = { ...census };
      setDayIndex(clamped);
      setDone(false);
      setTotals({ ...census });
    },
    [timeline],
  );

  const reset = useCallback(() => seekTo(0), [seekTo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !wasm) return;

    // --- World -----------------------------------------------------------
    const laneInputs: LaneInput[] = LANES.map((lane) => ({
      ...lane,
      peakGrains: Math.ceil(peaks[lane.id]),
    }));
    // The Rust side has no entropy source of its own, so the jitter seed comes
    // from here. A wall-clock seed keeps successive runs from being identical.
    //
    // Building the world allocates tens of megabytes of wasm linear memory and
    // then aliases it into an ImageData; both can fail on a device that is out of
    // room. Report that in the same place as a load failure rather than throwing
    // out of an effect and blanking the page.
    let engine: WasmPileEngine;
    try {
      engine = new WasmPileEngine(wasm, laneInputs, (Date.now() & 0x7fffffff) || 1);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : String(error));
      return;
    }
    engineRef.current = engine;

    const worldW = engine.width;
    const worldH = engine.height;
    const worldCanvas = document.createElement("canvas");
    worldCanvas.width = worldW;
    worldCanvas.height = worldH;
    const worldCtx = worldCanvas.getContext("2d", { alpha: false });
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!worldCtx || !ctx) {
      engine.free();
      setLoadError("This browser did not give us a 2D canvas context.");
      return;
    }

    // --- Camera ------------------------------------------------------------
    const dpr = window.devicePixelRatio || 1;
    let cssW = canvas.clientWidth || 800;
    const cssH = CANVAS_HEIGHT;
    const fitZoom = () => Math.min(cssW / worldW, cssH / worldH);
    const camera = cameraRef.current;

    const clampCamera = () => {
      camera.zoom = Math.max(fitZoom() * 0.9, Math.min(MAX_ZOOM, camera.zoom));
      camera.cx = Math.max(0, Math.min(worldW, camera.cx));
      camera.cy = Math.max(0, Math.min(worldH, camera.cy));
    };
    const fit = () => {
      camera.zoom = fitZoom();
      camera.cx = worldW / 2;
      camera.cy = worldH / 2;
    };
    const zoomAt = (factor: number, screenX: number, screenY: number) => {
      const before = camera.zoom;
      camera.zoom = Math.max(fitZoom() * 0.9, Math.min(MAX_ZOOM, camera.zoom * factor));
      const scale = camera.zoom / before;
      // Keep the world point under the cursor fixed while the scale changes.
      const wx = camera.cx + (screenX - cssW / 2) / before;
      const wy = camera.cy + (screenY - cssH / 2) / before;
      camera.cx = wx - (screenX - cssW / 2) / (before * scale);
      camera.cy = wy - (screenY - cssH / 2) / (before * scale);
      clampCamera();
    };
    cameraControlsRef.current = {
      zoomBy: (f) => zoomAt(f, cssW / 2, cssH / 2),
      fit,
    };

    const resize = () => {
      cssW = canvas.clientWidth || cssW;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      clampCamera();
    };
    resize();
    fit();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let dragging = false;
    let lastPointer = { x: 0, y: 0 };
    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      camera.cx -= (event.clientX - lastPointer.x) / camera.zoom;
      camera.cy -= (event.clientY - lastPointer.y) / camera.zoom;
      lastPointer = { x: event.clientX, y: event.clientY };
      clampCamera();
    };
    const onPointerUp = () => {
      dragging = false;
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    // --- Playback ----------------------------------------------------------
    seekTo(0);

    let raf = 0;
    let last = performance.now();
    let uiClock = 0;
    let tick = 0;
    let frameCost = 0;

    const emitFor = (fraction: number) => {
      const day = timeline.days[dayRef.current];
      if (!day) return;
      const meters = metersRef.current;
      const pending = pendingRef.current;

      // New work rains into Placed.
      const pour = meters.placedNew.take(day.placedNew * fraction);
      if (pour > 0) engine.drop("placed", pour, SAND_PLACED);

      // Transitions: vanish off the source summit, drop into the destination.
      // Queue what this frame owes, then pay down what the source can supply.
      const owe = (channel: string, jobs: number) => {
        pending[channel] += meters[channel].take(jobs);
      };
      const pay = (channel: string, from: string, to: string, material: SandMaterial) => {
        if (pending[channel] <= 0) return;
        const taken = engine.remove(from, pending[channel]);
        if (taken > 0) {
          engine.drop(to, taken, material);
          pending[channel] -= taken;
        }
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

      // Job counts come from the data, not grain counts, so the readout stays
      // exact even though the sand is quantised.
      applyDay(censusRef.current, day, fraction);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tick++;

      if (playingRef.current && dayRef.current < timeline.days.length) {
        // Activity-paced: a dead day flicks past, a million-job day lingers.
        const perDay = daySeconds(timeline.days[dayRef.current]) / speedRef.current;
        const chunk = Math.min(dt / perDay, 1 - progressRef.current);
        if (chunk > 0) emitFor(chunk);
        progressRef.current += chunk;
        // The calendar waits for the physics: a day ends only once its last
        // grain has landed AND every pile has stopped moving. Pending debts are
        // deliberately not part of the gate -- with nothing falling and nothing
        // moving they are momentarily unpayable, and the next day's arrivals
        // are what pays them.
        if (
          progressRef.current >= 1 &&
          engine.inFlight === 0 &&
          engine.movesLastStep === 0
        ) {
          progressRef.current = 0;
          dayRef.current++;
        }
      }

      const simStart = performance.now();
      engine.step(tick);
      // A wasm `memory.grow` would have detached the ImageData aliasing linear
      // memory. The engine pre-reserves so this should never fire; if it does,
      // the views have just been rebuilt and the whole world must be re-sent.
      if (engine.refreshViews()) {
        engine.consumeDirty();
        worldCtx.putImageData(engine.worldImage, 0, 0);
      } else {
        const dirtyRect = engine.consumeDirty();
        if (dirtyRect) {
          worldCtx.putImageData(
            engine.worldImage,
            0,
            0,
            dirtyRect.x,
            dirtyRect.y,
            dirtyRect.w,
            dirtyRect.h,
          );
        }
      }

      // Viewport blit: nearest-neighbour so grains stay hard squares at any zoom.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#eceae4";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.imageSmoothingEnabled = false;
      const { cx, cy, zoom } = camera;
      const sx = cx - cssW / (2 * zoom);
      const sy = cy - cssH / (2 * zoom);
      const vx0 = Math.max(0, sx);
      const vy0 = Math.max(0, sy);
      const vx1 = Math.min(worldW, sx + cssW / zoom);
      const vy1 = Math.min(worldH, sy + cssH / zoom);
      if (vx1 > vx0 && vy1 > vy0) {
        ctx.drawImage(
          worldCanvas,
          vx0,
          vy0,
          vx1 - vx0,
          vy1 - vy0,
          (vx0 - sx) * zoom,
          (vy0 - sy) * zoom,
          (vx1 - vx0) * zoom,
          (vy1 - vy0) * zoom,
        );
      }

      // Lane labels on the screen layer: crisp at any zoom, tracking their pile.
      const census = censusRef.current;
      ctx.textAlign = "center";
      for (const lane of engine.lanes) {
        const screenX = ((lane.x0 + lane.x1) / 2 - sx) * zoom;
        if (screenX < -60 || screenX > cssW + 60) continue;
        const screenY = Math.min((engine.groundY - sy) * zoom + 16, cssH - 22);
        ctx.fillStyle = "#3d3a33";
        ctx.font = "700 12px system-ui, sans-serif";
        ctx.fillText(lane.label, screenX, screenY);
        ctx.fillStyle = "#6e6a60";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(
          Math.max(0, Math.round(census[lane.id as keyof Census])).toLocaleString(),
          screenX,
          screenY + 14,
        );
      }

      // Exponentially smoothed frame cost: the number to look at when deciding
      // which fidelity compromises are worth making.
      frameCost = frameCost * 0.9 + (performance.now() - simStart) * 0.1;

      // Throttle React updates to ~8/s; the canvas is already current.
      uiClock += dt;
      if (uiClock > 0.12) {
        uiClock = 0;
        setDayIndex(Math.min(dayRef.current, timeline.days.length - 1));
        setDone(dayRef.current >= timeline.days.length && engine.inFlight === 0);
        setTotals({ ...censusRef.current });
        setFrameMs(frameCost);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      engineRef.current = null;
      cameraControlsRef.current = null;
      // The world is tens of megabytes of wasm linear memory; hand it back so a
      // cluster change does not stack another one on top.
      engine.free();
    };
  }, [wasm, timeline, peaks, seekTo]);

  const currentDay = timeline.days[Math.min(dayIndex, timeline.days.length - 1)];
  const totalFinished = totals.completed + totals.removed;
  const completedShare = totalFinished > 0 ? (totals.completed / totalFinished) * 100 : 0;

  return (
    <Box component="main" sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 }, maxWidth: 1180, mx: "auto" }}>
      <Stack spacing={0.5} sx={{ mb: 2.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            {data.owner}&apos;s jobs, as sand
          </Typography>
          <Chip label="Rust / WebAssembly" color="primary" size="small" variant="outlined" />
        </Stack>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          Four piles, one per state, and <strong>every grain is one job</strong> — a pile holds
          exactly the jobs in that state right now. When a job changes state its grain vanishes
          from the old pile and drops into the new one. Scroll to zoom, drag to pan, click the
          strip below to jump to a day.
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          This is the <strong>Rust/WebAssembly variant</strong> of the sand page. The cell-level
          automaton — the cells, the pixels, the fliers — is a Rust port compiled to wasm that owns
          both the cell array and the RGBA buffer in its own linear memory, so a frame&apos;s pixels
          reach the canvas with no copy at all. Everything above the cells is unchanged and shared
          with <code>/sand</code>: the same census math, the same day pacing, the same controls.
          Compare the ms/frame readouts.
        </Typography>
      </Stack>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the WebAssembly engine: {loadError}. The build output is expected at{" "}
          <code>public/wasm/sand_engine.js</code> — rebuild it with{" "}
          <code>wasm-pack build --release --target web --no-pack --out-dir ../../public/wasm</code>{" "}
          from <code>rust/sand-engine</code>.
        </Alert>
      )}

      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <IconButton
          onClick={() => setPlaying((p) => !p)}
          color="primary"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!wasm}
        >
          {playing ? <Pause /> : <PlayArrow />}
        </IconButton>
        <Button startIcon={<RestartAlt />} onClick={reset} size="small" disabled={!wasm}>
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

        <Box sx={{ ml: "auto" }}>
          <IconButton
            size="small"
            aria-label="Zoom in"
            onClick={() => cameraControlsRef.current?.zoomBy(1.5)}
          >
            <ZoomIn />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Zoom out"
            onClick={() => cameraControlsRef.current?.zoomBy(1 / 1.5)}
          >
            <ZoomOut />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Fit all piles"
            onClick={() => cameraControlsRef.current?.fit()}
          >
            <FitScreen />
          </IconButton>
        </Box>
      </Stack>

      <Paper variant="outlined" sx={{ position: "relative", overflow: "hidden", lineHeight: 0 }}>
        <Box
          component="canvas"
          ref={canvasRef}
          sx={{
            display: "block",
            width: "100%",
            height: CANVAS_HEIGHT,
            cursor: "grab",
            "&:active": { cursor: "grabbing" },
            touchAction: "none",
            backgroundColor: "#eceae4",
          }}
        />

        {/* Nothing can run until the wasm arrives; say so rather than showing a void. */}
        {!wasm && !loadError && (
          <Stack
            spacing={1.5}
            alignItems="center"
            justifyContent="center"
            sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            <CircularProgress size={28} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Loading the WebAssembly engine…
            </Typography>
          </Stack>
        )}

        {loadError && (
          <Stack
            alignItems="center"
            justifyContent="center"
            sx={{ position: "absolute", inset: 0, px: 4, textAlign: "center" }}
          >
            <Typography variant="body2" sx={{ color: "error.main", fontWeight: 700 }}>
              The WebAssembly engine failed to load, so there is nothing to simulate.
            </Typography>
          </Stack>
        )}

        {/* The clock, bottom right. */}
        {wasm && !loadError && (
          <Box sx={{ position: "absolute", right: 16, bottom: 14, textAlign: "right", pointerEvents: "none" }}>
            <Typography sx={{ fontSize: "0.7rem", color: "text.secondary", lineHeight: 1.2 }}>
              {done ? "Finished" : `Day ${dayIndex + 1} of ${timeline.days.length}`}
            </Typography>
            <Typography
              sx={{ fontSize: "1.35rem", fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}
            >
              {currentDay ? formatDayLong(currentDay.day) : ""}
            </Typography>
            {currentDay && !done && (
              <Typography sx={{ fontSize: "0.72rem", color: "text.secondary", lineHeight: 1.2 }}>
                {currentDay.transitions.toLocaleString()} changing state
              </Typography>
            )}
            <Typography sx={{ fontSize: "0.66rem", color: "text.disabled", lineHeight: 1.2 }}>
              sim {frameMs.toFixed(1)} ms/frame · rust/wasm
            </Typography>
          </Box>
        )}

        {/* The payoff: once the last grain lands, say what the window amounted to. */}
        {done && (
          <Paper
            elevation={3}
            sx={{
              position: "absolute",
              left: "50%",
              top: 18,
              transform: "translateX(-50%)",
              px: 2.5,
              py: 1.5,
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {Math.round(totalFinished).toLocaleString()} jobs finished:{" "}
              {completedShare.toFixed(1)}% completed, {(100 - completedShare).toFixed(1)}% removed
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {Math.round(totals.placed + totals.active).toLocaleString()} still in the queue or
              running when the window closed
            </Typography>
            <Button size="small" startIcon={<Replay />} onClick={reset} sx={{ mt: 0.5 }}>
              Replay
            </Button>
          </Paper>
        )}
      </Paper>

      {/*
        The scrubber: one segment per day, sized by the log of its activity — the
        same pacing signal the playback uses, so a tall segment is a day the movie
        lingers on. Clicking stamps that day's census as settled piles and resumes
        from there.
      */}
      <Box
        sx={{ display: "flex", alignItems: "flex-end", gap: "2px", mt: 1.5, height: 40 }}
        role="group"
        aria-label="Jump to a day"
      >
        {timeline.days.map((d, i) => {
          const activity = d.placedNew + d.transitions;
          const h =
            activity > 0 ? 8 + 30 * (Math.log10(1 + activity) / Math.log10(1 + peakActivity)) : 3;
          return (
            <Box
              key={d.day}
              component="button"
              onClick={() => seekTo(i)}
              title={`${formatDayShort(d.day)} — ${activity.toLocaleString()} placed or changed`}
              aria-label={`Jump to ${formatDayShort(d.day)}`}
              sx={{
                flex: 1,
                height: h,
                p: 0,
                border: "none",
                cursor: "pointer",
                borderRadius: "1px",
                backgroundColor:
                  i === dayIndex
                    ? "primary.main"
                    : i < dayIndex
                      ? "primary.light"
                      : "action.disabledBackground",
                "&:hover": { backgroundColor: "primary.main" },
              }}
            />
          );
        })}
      </Box>

      <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 2, display: "block" }}>
        Falling-sand cellular automaton at one job per grain, every grain simulated — no binning,
        no culling. Each lane is sized up front for the largest census its state ever reaches, so
        a pile&apos;s bulk is proportional to its job count for the whole run. A cone&apos;s
        height grows with the square root of its count — compare piles by area, or trust the
        numbers. Active sand shimmers because that work is executing; terminal sand lies still.
        The ms/frame readout in the corner is the honest cost of full fidelity — here paid in Rust
        rather than JavaScript, over the identical scene.
      </Typography>
    </Box>
  );
}
