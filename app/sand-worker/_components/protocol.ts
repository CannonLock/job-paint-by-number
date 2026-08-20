/**
 * The wire protocol between the /sand-worker page and its simulation worker.
 *
 * Everything here is structured-clone-safe plain data. There is deliberately NO
 * SharedArrayBuffer anywhere: this site is a static export served from GitHub
 * Pages, where the COOP/COEP headers that would make shared memory available
 * cannot be set. The only transferable object that ever crosses is the
 * OffscreenCanvas handed over once at init.
 *
 * Division of labour:
 *   MAIN   owns the DOM: pointer/wheel/button input, camera arithmetic, React.
 *   WORKER owns the pixels: the automaton, the world pixel buffer, the camera
 *          blit and the lane labels, drawn straight into the transferred canvas.
 *
 * `gen` is a generation counter the main thread bumps whenever it changes what
 * the worker should be showing (a new timeline, or a seek). The worker echoes
 * the newest `gen` it has acted on with every UI packet, so the main thread can
 * drop packets that were already in flight when it seeked and would otherwise
 * flick the day readout backwards for a frame.
 */

import type { Census, Timeline } from "../../sand/_components/timeline";

export interface CameraState {
  /** World coordinates at the viewport centre. */
  cx: number;
  cy: number;
  /** Screen pixels (CSS px) per world cell. */
  zoom: number;
}

export interface ViewportState {
  /** Canvas size in CSS pixels, and the backing-store scale to draw at. */
  cssW: number;
  cssH: number;
  dpr: number;
}

export type MainMessage =
  | ({ type: "init"; canvas: OffscreenCanvas } & ViewportState)
  | { type: "timeline"; gen: number; timeline: Timeline }
  | ({ type: "resize" } & ViewportState)
  | { type: "camera"; camera: CameraState }
  | { type: "playing"; playing: boolean }
  | { type: "speed"; speed: number }
  | { type: "seek"; gen: number; dayIndex: number }
  /** Stop the frame loop; sent just before the worker is discarded. */
  | { type: "stop" };

export type WorkerMessage =
  /** World geometry, once per timeline: the main thread needs it to clamp the camera. */
  | { type: "world"; gen: number; worldW: number; worldH: number }
  | {
      type: "ui";
      gen: number;
      dayIndex: number;
      census: Census;
      done: boolean;
      /** Automaton step + pixel upload + blit + labels, smoothed. Comparable to /sand. */
      simMs: number;
      /** The whole worker frame including emission bookkeeping, smoothed. */
      frameMs: number;
    }
  | { type: "error"; message: string };
