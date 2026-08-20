"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { buildTimeline, censusAt, type Census } from "../sand/_components/timeline";
import type { CameraState, MainMessage, WorkerMessage } from "./_components/protocol";

const CANVAS_HEIGHT = 560;
const SPEEDS = [0.5, 1, 2, 4];
const MAX_ZOOM = 12;
/**
 * How long teardown waits before killing the worker. A canvas element can hand
 * over control to an OffscreenCanvas exactly once, so the worker cannot be
 * rebuilt for an element that already transferred; React StrictMode's
 * development unmount/remount must therefore be able to reclaim the same worker.
 */
const TEARDOWN_DELAY_MS = 400;

const ZERO_CENSUS: Census = { placed: 0, active: 0, completed: 0, removed: 0 };

interface SandWorkerViewProps {
  data: DayData;
}

/**
 * The /sand visualization with the simulation and all of its drawing moved into a
 * Web Worker. The main thread keeps the DOM half of the job -- pointer and wheel
 * input, camera arithmetic, the React chrome -- and hands the canvas itself over
 * with transferControlToOffscreen(), so painting a frame never touches it.
 *
 * The page exists to be compared with /sand side by side, which is why it reports
 * two numbers: what a frame costs the worker (the same measurement /sand prints)
 * and how the main thread's own animation clock is doing while that happens.
 */
export default function SandWorkerView({ data }: SandWorkerViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spinnerRef = useRef<HTMLDivElement | null>(null);
  const [cluster, setCluster] = useState<string>(ALL_CLUSTERS);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [dayIndex, setDayIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [totals, setTotals] = useState<Census>(ZERO_CENSUS);
  /** Worker-side automaton + pixel work per frame, smoothed. Same metric as /sand. */
  const [simMs, setSimMs] = useState(0);
  /** The worker's whole frame, including day emission, smoothed. */
  const [workerFrameMs, setWorkerFrameMs] = useState(0);
  /** Main-thread animation-frame interval, smoothed: the responsiveness number. */
  const [mainFrameMs, setMainFrameMs] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);

  const timeline = useMemo(() => buildTimeline(data, cluster), [data, cluster]);
  const peakActivity = useMemo(
    () => Math.max(1, ...timeline.days.map((d) => d.placedNew + d.transitions)),
    [timeline],
  );

  const workerRef = useRef<Worker | null>(null);
  const teardownRef = useRef<number | null>(null);
  /**
   * Bumped whenever the main thread changes what the worker should be showing (a
   * new timeline, or a seek). The worker echoes the newest generation it has acted
   * on, so UI packets that were already in flight across a seek are dropped rather
   * than flicking the day readout backwards.
   */
  const genRef = useRef(0);
  const cameraRef = useRef<CameraState>({ cx: 0, cy: 0, zoom: 1 });
  /** Camera actions the toolbar buttons call into; owned by the canvas effect. */
  const cameraControlsRef = useRef<{ zoomBy: (f: number) => void; fit: () => void } | null>(null);

  const post = useCallback((message: MainMessage) => {
    workerRef.current?.postMessage(message);
  }, []);

  const seekTo = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(target, timeline.days.length - 1));
      genRef.current += 1;
      post({ type: "seek", gen: genRef.current, dayIndex: clamped });
      // Show the destination immediately; the worker's next packet confirms it.
      setDayIndex(clamped);
      setDone(false);
      setTotals(censusAt(timeline, clamped));
    },
    [post, timeline],
  );

  const reset = useCallback(() => seekTo(0), [seekTo]);

  // --- Worker, canvas transfer and camera input ------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // A remount inside the teardown window reclaims the existing worker.
    if (teardownRef.current !== null) {
      window.clearTimeout(teardownRef.current);
      teardownRef.current = null;
    }

    if (typeof Worker === "undefined" || typeof canvas.transferControlToOffscreen !== "function") {
      setFatal(
        "This browser does not support OffscreenCanvas transfer to a Web Worker, so the " +
          "off-thread variant cannot run. The main-thread version at /sand shows the same scene.",
      );
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    let cssW = canvas.clientWidth || 800;
    const cssH = CANVAS_HEIGHT;

    let worker = workerRef.current;
    if (!worker) {
      let created: Worker;
      try {
        created = new Worker(new URL("./_components/sand.worker.ts", import.meta.url), {
          type: "module",
        });
      } catch {
        setFatal("The simulation worker could not be started.");
        return;
      }
      worker = created;
      workerRef.current = created;
      const offscreen = canvas.transferControlToOffscreen();
      const init: MainMessage = { type: "init", canvas: offscreen, cssW, cssH, dpr };
      created.postMessage(init, [offscreen]);
    }
    const send = (message: MainMessage) => worker.postMessage(message);

    // --- Camera -------------------------------------------------------------
    // World geometry is not known until the worker has built the engine; until
    // then the camera maths is harmlessly clamped against a 1x1 world.
    const dims = { w: 1, h: 1 };
    const camera = cameraRef.current;
    const fitZoom = () => Math.min(cssW / dims.w, cssH / dims.h);
    const pushCamera = () => send({ type: "camera", camera: { ...camera } });

    const clampCamera = () => {
      camera.zoom = Math.max(fitZoom() * 0.9, Math.min(MAX_ZOOM, camera.zoom));
      camera.cx = Math.max(0, Math.min(dims.w, camera.cx));
      camera.cy = Math.max(0, Math.min(dims.h, camera.cy));
    };
    const fit = () => {
      camera.zoom = fitZoom();
      camera.cx = dims.w / 2;
      camera.cy = dims.h / 2;
      pushCamera();
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
      pushCamera();
    };
    cameraControlsRef.current = {
      zoomBy: (f) => zoomAt(f, cssW / 2, cssH / 2),
      fit,
    };

    const onMessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "error") {
        setFatal(message.message);
        return;
      }
      if (message.type === "world") {
        dims.w = message.worldW;
        dims.h = message.worldH;
        fit();
        return;
      }
      if (message.gen !== genRef.current) return;
      setDayIndex(message.dayIndex);
      setDone(message.done);
      setTotals(message.census);
      setSimMs(message.simMs);
      setWorkerFrameMs(message.frameMs);
    };
    worker.addEventListener("message", onMessage);

    // The bitmap belongs to the worker now: only it may resize the canvas, so a
    // layout change is reported rather than applied here.
    const resize = () => {
      cssW = canvas.clientWidth || cssW;
      send({ type: "resize", cssW, cssH, dpr });
      // ResizeObserver fires once on observe, which can beat the worker's world
      // message; clamping against the placeholder 1x1 world would push a nonsense
      // camera. The world message fits the camera itself once it lands.
      if (dims.w > 1) {
        clampCamera();
        pushCamera();
      }
    };
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
      pushCamera();
    };
    const onPointerUp = () => {
      dragging = false;
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      worker.removeEventListener("message", onMessage);
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      cameraControlsRef.current = null;
      teardownRef.current = window.setTimeout(() => {
        teardownRef.current = null;
        const dying = workerRef.current;
        workerRef.current = null;
        if (dying) {
          dying.postMessage({ type: "stop" } satisfies MainMessage);
          dying.terminate();
        }
      }, TEARDOWN_DELAY_MS);
    };
  }, []);

  // A new timeline (cluster change) rebuilds the world inside the same worker.
  useEffect(() => {
    genRef.current += 1;
    post({ type: "timeline", gen: genRef.current, timeline });
    setDayIndex(0);
    setDone(false);
    setTotals(censusAt(timeline, 0));
  }, [post, timeline]);

  useEffect(() => {
    post({ type: "playing", playing });
  }, [playing, post]);

  useEffect(() => {
    post({ type: "speed", speed });
  }, [post, speed]);

  // --- Main-thread responsiveness -------------------------------------------
  // The point of the page. This loop does nothing but time itself and nudge a
  // spinner, so its frame interval is a direct read on how much room the main
  // thread has left. On /sand the same loop would be sharing that thread with the
  // whole simulation.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let smoothed = 1000 / 60;
    let sinceReport = 0;
    let angle = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const delta = now - last;
      last = now;
      if (delta > 0 && delta < 1000) smoothed = smoothed * 0.9 + delta * 0.1;
      angle = (angle + delta * 0.18) % 360;
      const spinner = spinnerRef.current;
      if (spinner) spinner.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      sinceReport += delta;
      if (sinceReport > 250) {
        sinceReport = 0;
        setMainFrameMs(smoothed);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const currentDay = timeline.days[Math.min(dayIndex, timeline.days.length - 1)];
  const totalFinished = totals.completed + totals.removed;
  const completedShare = totalFinished > 0 ? (totals.completed / totalFinished) * 100 : 0;
  const mainFps = mainFrameMs > 0 ? 1000 / mainFrameMs : 0;

  return (
    <Box component="main" sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 }, maxWidth: 1180, mx: "auto" }}>
      <Stack spacing={0.5} sx={{ mb: 2.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            {data.owner}&apos;s jobs, as sand
          </Typography>
          <Chip label="Web Worker variant" color="primary" size="small" />
        </Stack>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          Four piles, one per state, and <strong>every grain is one job</strong> — a pile holds
          exactly the jobs in that state right now. When a job changes state its grain vanishes
          from the old pile and drops into the new one. Scroll to zoom, drag to pan, click the
          strip below to jump to a day.
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Same scene as <strong>/sand</strong>, but the simulation and every pixel of it run inside
          a Web Worker that owns the canvas outright. Compare the two readouts in the corner with
          the ones on that page: the worker&apos;s cost per frame should be about the same, while
          the main thread here stays near 60 fps instead of being spent on sand.
        </Typography>
      </Stack>

      {fatal && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {fatal}
        </Alert>
      )}

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

        {/*
          The two measurements, top left. The worker number is the same one /sand
          prints; the main-thread number is what moving the work bought. The square
          is spun by the main thread's own animation frames, so it stutters exactly
          when that thread is busy -- the readout, visible.
        */}
        <Paper
          elevation={0}
          sx={{
            position: "absolute",
            left: 12,
            top: 12,
            px: 1.25,
            py: 0.75,
            backgroundColor: "rgba(255,255,255,0.82)",
            border: "1px solid rgba(0,0,0,0.08)",
            pointerEvents: "none",
          }}
        >
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box
              ref={spinnerRef}
              sx={{ width: 12, height: 12, backgroundColor: "primary.main", borderRadius: "2px" }}
            />
            <Box>
              <Typography
                sx={{ fontSize: "0.7rem", lineHeight: 1.35, fontVariantNumeric: "tabular-nums" }}
              >
                worker sim <strong>{simMs.toFixed(1)} ms/frame</strong>
                <Box component="span" sx={{ color: "text.disabled" }}>
                  {" "}
                  (whole worker frame {workerFrameMs.toFixed(1)} ms)
                </Box>
              </Typography>
              <Typography
                sx={{ fontSize: "0.7rem", lineHeight: 1.35, fontVariantNumeric: "tabular-nums" }}
              >
                main thread{" "}
                <strong>
                  {mainFps.toFixed(0)} fps ({mainFrameMs.toFixed(1)} ms/frame)
                </strong>
              </Typography>
            </Box>
          </Stack>
        </Paper>

        {/* The clock, bottom right. */}
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
        </Box>

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
        Same falling-sand automaton as <strong>/sand</strong> — one job per grain, every grain
        simulated, no binning and no culling — but the engine, the world&apos;s pixel buffer, the
        camera blit and the lane labels all live in a Web Worker drawing into a canvas whose
        control this page transferred to it. The main thread only translates pointers into camera
        state and paints the chrome, which is why its frame clock stays clear while several
        million grains are in play. Nothing is shared memory: the site is a static export, so the
        headers that would allow it are not available, and the only per-frame traffic in either
        direction is a handful of small messages.
      </Typography>
    </Box>
  );
}
