/**
 * The whole visualization, off the main thread.
 *
 * This worker owns an OffscreenCanvas handed over by the page with
 * canvas.transferControlToOffscreen(), so it does every per-frame job itself:
 * the falling-sand automaton, the world pixel buffer, the camera blit and the
 * lane labels. The page's rendering of a frame costs the main thread nothing --
 * no ImageData upload, no drawImage, not even a rAF callback.
 *
 * What still crosses the wire is only what cannot be done here: camera and
 * playback intent coming in (the DOM lives on the main thread), and a throttled
 * ~8/s UI packet going out for the React chrome around the canvas.
 *
 * Scheduling note: requestAnimationFrame is not exposed to dedicated workers in
 * any shipping browser, so the loop is a self-rescheduling timer that aims at the
 * frame budget. The 2D context auto-commits to the placeholder canvas at the end
 * of every task, so one draw per timer callback is one visible frame.
 */

import type { CameraState, MainMessage, WorkerMessage } from "./protocol";
import { SimRunner } from "./simRunner";
import type { Census } from "../../sand/_components/timeline";

/**
 * DedicatedWorkerGlobalScope is declared in TypeScript's "webworker" lib, which
 * this project's tsconfig does not include (it is a DOM app with one worker in
 * it). Rather than widen the project's libs, the handful of scope members this
 * file needs are declared here and reached through globalThis.
 */
interface WorkerScope {
  postMessage(message: WorkerMessage): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<MainMessage>) => void,
  ): void;
}
const scope = globalThis as unknown as WorkerScope;

/** Target frame budget for the timer loop, in ms (~60fps). */
const FRAME_BUDGET = 1000 / 60;
const BACKGROUND_COLOUR = "#eceae4";

// --- State -------------------------------------------------------------------

let visible: OffscreenCanvas | null = null;
let vctx: OffscreenCanvasRenderingContext2D | null = null;
let cssW = 800;
let cssH = 560;
let dpr = 1;

let runner: SimRunner | null = null;
/** The world at 1 cell = 1 pixel; the visible canvas is a camera onto it. */
let world: OffscreenCanvas | null = null;
let wctx: OffscreenCanvasRenderingContext2D | null = null;
/** Shares the engine's own pixel memory; only dirty rectangles are uploaded. */
let worldImage: ImageData | null = null;

let camera: CameraState = { cx: 0, cy: 0, zoom: 1 };
let playing = true;
let speed = 1;
let gen = 0;

let running = false;
let stopped = false;
let tick = 0;
let last = 0;
let uiClock = 0;
let simCost = 0;
let frameCost = 0;

function fail(message: string): void {
  stopped = true;
  running = false;
  scope.postMessage({ type: "error", message });
}

// --- World -------------------------------------------------------------------

function buildWorld(): boolean {
  if (!runner) return false;
  const w = runner.engine.width;
  const h = runner.engine.height;
  try {
    world = new OffscreenCanvas(w, h);
  } catch {
    fail("This browser could not allocate the offscreen world canvas.");
    return false;
  }
  const ctx = world.getContext("2d", { alpha: false });
  if (!ctx) {
    fail("This browser does not support 2D drawing inside a worker (OffscreenCanvas).");
    return false;
  }
  wctx = ctx;
  worldImage = new ImageData(runner.engine.pixelBytes, w, h);
  return true;
}

function fitZoom(): number {
  if (!runner) return 1;
  return Math.min(cssW / runner.engine.width, cssH / runner.engine.height);
}

/** Only used for the very first frames, before the main thread's camera arrives. */
function fitCamera(): void {
  if (!runner) return;
  camera = {
    zoom: fitZoom(),
    cx: runner.engine.width / 2,
    cy: runner.engine.height / 2,
  };
}

function applyViewport(): void {
  if (!visible) return;
  visible.width = Math.max(1, Math.round(cssW * dpr));
  visible.height = Math.max(1, Math.round(cssH * dpr));
}

// --- Render ------------------------------------------------------------------

function render(): void {
  if (!vctx || !runner || !world || !wctx || !worldImage) return;
  const engine = runner.engine;
  const worldW = engine.width;
  const worldH = engine.height;

  const dirty = engine.consumeDirty();
  if (dirty) {
    wctx.putImageData(worldImage, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h);
  }

  // Viewport blit: nearest-neighbour so grains stay hard squares at any zoom.
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vctx.fillStyle = BACKGROUND_COLOUR;
  vctx.fillRect(0, 0, cssW, cssH);
  vctx.imageSmoothingEnabled = false;
  const { cx, cy, zoom } = camera;
  const sx = cx - cssW / (2 * zoom);
  const sy = cy - cssH / (2 * zoom);
  const vx0 = Math.max(0, sx);
  const vy0 = Math.max(0, sy);
  const vx1 = Math.min(worldW, sx + cssW / zoom);
  const vy1 = Math.min(worldH, sy + cssH / zoom);
  if (vx1 > vx0 && vy1 > vy0) {
    vctx.drawImage(
      world,
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
  const census = runner.census;
  vctx.textAlign = "center";
  for (const lane of engine.lanes) {
    const screenX = ((lane.x0 + lane.x1) / 2 - sx) * zoom;
    if (screenX < -60 || screenX > cssW + 60) continue;
    const screenY = Math.min((engine.groundY - sy) * zoom + 16, cssH - 22);
    vctx.fillStyle = "#3d3a33";
    vctx.font = "700 12px system-ui, sans-serif";
    vctx.fillText(lane.label, screenX, screenY);
    vctx.fillStyle = "#6e6a60";
    vctx.font = "11px system-ui, sans-serif";
    vctx.fillText(
      Math.max(0, Math.round(census[lane.id as keyof Census])).toLocaleString(),
      screenX,
      screenY + 14,
    );
  }
}

// --- Frame loop --------------------------------------------------------------

/**
 * Prefer the animation clock if a browser ever exposes it to workers; otherwise
 * self-schedule on a timer aimed at the frame budget. `typeof` on a possibly
 * undeclared global is safe, which is the point of writing the check this way.
 */
const hasRaf = typeof requestAnimationFrame === "function";

function schedule(work: number): void {
  if (!running) return;
  if (hasRaf) {
    requestAnimationFrame(frame);
    return;
  }
  setTimeout(frame, Math.max(0, FRAME_BUDGET - work));
}

function frame(): void {
  if (!running) return;
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick++;

  if (runner) {
    if (playing) runner.advance(dt, speed);

    // Timed from here so the number means the same thing as /sand's readout:
    // automaton step, dirty-rectangle upload, blit and labels.
    const simStart = performance.now();
    runner.step(tick);
    render();
    const simEnd = performance.now();

    // Exponentially smoothed, like the baseline's, so the readouts compare.
    simCost = simCost * 0.9 + (simEnd - simStart) * 0.1;
    frameCost = frameCost * 0.9 + (simEnd - now) * 0.1;

    // Throttle UI packets to ~8/s; the canvas is already current without them.
    uiClock += dt;
    if (uiClock > 0.12) {
      uiClock = 0;
      scope.postMessage({
        type: "ui",
        gen,
        dayIndex: runner.dayIndex,
        census: { ...runner.census },
        done: runner.done,
        simMs: simCost,
        frameMs: frameCost,
      });
    }
  }

  schedule(performance.now() - now);
}

function start(): void {
  if (running || stopped) return;
  running = true;
  last = performance.now();
  schedule(0);
}

// --- Messages ----------------------------------------------------------------

scope.addEventListener("message", (event: MessageEvent<MainMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init": {
      if (visible) return;
      visible = message.canvas;
      cssW = message.cssW;
      cssH = message.cssH;
      dpr = message.dpr;
      applyViewport();
      const ctx = visible.getContext("2d", { alpha: false });
      if (!ctx) {
        fail("This browser does not support 2D drawing inside a worker (OffscreenCanvas).");
        return;
      }
      vctx = ctx;
      if (runner) start();
      break;
    }

    case "timeline": {
      // A cluster change rebuilds the world from scratch; the same worker and the
      // same transferred canvas are reused, because a canvas element can only
      // hand over control once.
      gen = message.gen;
      runner = new SimRunner(message.timeline);
      if (!buildWorld()) return;
      fitCamera();
      scope.postMessage({
        type: "world",
        gen,
        worldW: runner.engine.width,
        worldH: runner.engine.height,
      });
      simCost = 0;
      frameCost = 0;
      if (vctx) start();
      break;
    }

    case "resize": {
      cssW = message.cssW;
      cssH = message.cssH;
      dpr = message.dpr;
      applyViewport();
      break;
    }

    case "camera":
      camera = message.camera;
      break;

    case "playing":
      playing = message.playing;
      break;

    case "speed":
      speed = message.speed;
      break;

    case "seek": {
      gen = message.gen;
      runner?.seek(message.dayIndex);
      break;
    }

    case "stop": {
      stopped = true;
      running = false;
      break;
    }
  }
});
