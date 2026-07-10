"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";

import {
  computeStageCounts,
  loadJobData,
  type ColorMode,
  type JobData,
  type StageCounts,
} from "./data";
import { COLOR_MODE_INT, type Camera, JobRenderer } from "./renderer";
import ControlPanel from "./ControlPanel";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const MIN_SCALE_FACTOR = 0.5; // relative to fit
const MAX_SCALE = 400; // device px per world unit
const UI_SYNC_MS = 120;
const COUNTS_MS = 250;

export default function JobCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<JobRenderer | null>(null);
  const dataRef = useRef<JobData | null>(null);

  // Rendering source-of-truth lives in refs so the rAF loop never triggers React renders.
  const cameraRef = useRef<Camera>({ scale: 1, panX: 0, panY: 0 });
  const fitScaleRef = useRef(1);
  const colsRef = useRef(1); // grid columns, derived from the window aspect ratio
  const playheadRef = useRef(0);
  const playingRef = useRef(false);
  const traverseRef = useRef(60);
  const colorModeRef = useRef(0);

  // React state drives the UI only (throttled from the refs).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<JobData["meta"] | null>(null);
  const [playing, setPlaying] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [traverse, setTraverse] = useState(60);
  const [colorMode, setColorMode] = useState<ColorMode>("stage");
  const [counts, setCounts] = useState<StageCounts | null>(null);
  const [zoom, setZoom] = useState(1); // multiple of the fit-to-screen scale

  // Lock page scroll while the full-screen canvas is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Fill the viewport: pick a column count whose grid aspect ratio matches the
  // window, then scale so the grid covers the screen edge-to-edge (centered).
  const fitCamera = useCallback((deviceW: number, deviceH: number) => {
    const data = dataRef.current;
    if (!data || deviceW === 0 || deviceH === 0) return;
    const n = data.meta.count;
    const aspect = deviceW / deviceH;
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * aspect))));
    const rows = Math.ceil(n / cols);
    colsRef.current = cols;
    rendererRef.current?.setGridCols(cols);

    const scale = Math.max(deviceW / cols, deviceH / rows); // cover, no letterbox
    fitScaleRef.current = scale;
    cameraRef.current = {
      scale,
      panX: (deviceW - cols * scale) / 2,
      panY: (deviceH - rows * scale) / 2,
    };
  }, []);

  // Load data + set up renderer, render loop, resize + interaction.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: JobRenderer;
    try {
      renderer = new JobRenderer(canvas);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
      return;
    }
    rendererRef.current = renderer;

    let disposed = false;
    let raf = 0;
    let lastTs = 0;
    let lastUi = 0;
    let lastCounts = 0;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    const applyResize = () => {
      const rect = container.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, dpr());
      fitCamera(canvas.width, canvas.height); // re-derive columns from the new aspect
    };

    loadJobData(BASE_PATH)
      .then((data) => {
        if (disposed) return;
        dataRef.current = data;
        renderer.uploadData(data);
        setMeta(data.meta);

        // Start partway through so the wavefront (queued/running/done) is visible.
        const initial = Math.floor(data.meta.tMax * 0.4);
        playheadRef.current = initial;
        setPlayhead(initial);

        applyResize();
        setCounts(computeStageCounts(data, initial));
        setLoading(false);

        const frame = (ts: number) => {
          if (disposed) return;
          const dt = lastTs ? (ts - lastTs) / 1000 : 0;
          lastTs = ts;

          if (playingRef.current) {
            const span = data.meta.tMax;
            playheadRef.current += dt * (span / traverseRef.current);
            if (playheadRef.current >= span) playheadRef.current = 0; // loop
          }

          renderer.render(cameraRef.current, playheadRef.current, colorModeRef.current);

          if (ts - lastUi > UI_SYNC_MS) {
            lastUi = ts;
            setPlayhead(playheadRef.current);
            setZoom(cameraRef.current.scale / fitScaleRef.current);
          }
          if (ts - lastCounts > COUNTS_MS) {
            lastCounts = ts;
            setCounts(computeStageCounts(data, playheadRef.current));
          }
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      })
      .catch((e) => {
        if (disposed) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    const ro = new ResizeObserver(() => applyResize());
    ro.observe(container);

    // --- Interaction: wheel zoom-to-cursor + drag pan --------------------------
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * dpr();
      const my = (e.clientY - rect.top) * dpr();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const min = fitScaleRef.current * MIN_SCALE_FACTOR;
      const newScale = Math.min(Math.max(cam.scale * factor, min), MAX_SCALE);
      const worldX = (mx - cam.panX) / cam.scale;
      const worldY = (my - cam.panY) / cam.scale;
      cameraRef.current = {
        scale: newScale,
        panX: mx - worldX * newScale,
        panY: my - worldY * newScale,
      };
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const d = dpr();
      cameraRef.current.panX += (e.clientX - lastX) * d;
      cameraRef.current.panY += (e.clientY - lastY) * d;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      canvas.style.cursor = "grab";
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.style.cursor = "grab";

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      renderer.dispose();
    };
  }, [fitCamera]);

  // Mirror UI state into the refs the render loop reads.
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    traverseRef.current = traverse;
  }, [traverse]);
  useEffect(() => {
    colorModeRef.current = COLOR_MODE_INT[colorMode];
  }, [colorMode]);

  const onScrub = useCallback(
    (v: number) => {
      playheadRef.current = v;
      setPlayhead(v);
      if (dataRef.current) setCounts(computeStageCounts(dataRef.current, v));
    },
    [],
  );

  const onReset = useCallback(() => {
    playheadRef.current = 0;
    setPlayhead(0);
    if (dataRef.current) setCounts(computeStageCounts(dataRef.current, 0));
  }, []);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: "fixed",
        inset: 0,
        // Above the UW banner/header (AppBar ~1100) but below MUI popovers
        // (Select/Menu ~1300) so dropdowns render on top of the canvas.
        zIndex: 1200,
        bgcolor: "#0a0b10",
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

      {loading && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            color: "#e8eaf0",
          }}
        >
          <CircularProgress sx={{ color: "#38d0f8" }} />
          <Typography variant="body2">Loading ~2M jobs…</Typography>
        </Box>
      )}

      {error && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 4,
            color: "#e8eaf0",
            textAlign: "center",
          }}
        >
          <Typography variant="body1">Could not render the canvas: {error}</Typography>
        </Box>
      )}

      {meta && !error && <ZoomIndicator zoom={zoom} />}

      {meta && !error && (
        <ControlPanel
          meta={meta}
          playing={playing}
          playhead={playhead}
          traverse={traverse}
          colorMode={colorMode}
          counts={counts}
          onTogglePlay={() => setPlaying((p) => !p)}
          onReset={onReset}
          onScrub={onScrub}
          onTraverse={setTraverse}
          onColorMode={setColorMode}
        />
      )}
    </Box>
  );
}

// Vertical zoom gauge on the left. Zoom is expressed as a multiple of the
// fit-to-screen scale (1× = fully zoomed out / filling the window), plotted on
// a log scale with a tick at 1×.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 300;

function ZoomIndicator({ zoom }: { zoom: number }) {
  const lg = (x: number) => Math.log(x);
  const frac = (z: number) =>
    Math.min(1, Math.max(0, (lg(z) - lg(ZOOM_MIN)) / (lg(ZOOM_MAX) - lg(ZOOM_MIN))));
  const fill = frac(zoom);
  const tick = frac(1);
  const label = zoom < 10 ? `${zoom.toFixed(1)}×` : `${Math.round(zoom)}×`;

  return (
    <Box
      sx={{
        position: "absolute",
        left: 16,
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        p: 1,
        borderRadius: 3,
        color: "#e8eaf0",
        bgcolor: "rgba(16, 18, 27, 0.82)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {label}
      </Typography>
      <Box sx={{ position: "relative", width: 6, height: 140 }}>
        {/* track */}
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            borderRadius: 3,
            bgcolor: "rgba(255,255,255,0.12)",
          }}
        />
        {/* fill (grows from the bottom) */}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${fill * 100}%`,
            borderRadius: 3,
            bgcolor: "#38d0f8",
            transition: "height 0.12s linear",
          }}
        />
        {/* 1× (fit) tick */}
        <Box
          sx={{
            position: "absolute",
            left: -3,
            right: -3,
            bottom: `${tick * 100}%`,
            height: "2px",
            bgcolor: "rgba(255,255,255,0.5)",
          }}
        />
      </Box>
      <Typography variant="caption" sx={{ color: "#6b7089", fontSize: "0.6rem" }}>
        zoom
      </Typography>
    </Box>
  );
}
