// The JavaScript half of the Rust/WASM sand engine.
//
// Two jobs, and nothing else:
//
//   1. LOADING. `loadWasmPileEngine()` pulls the wasm-bindgen glue in as a plain
//      static asset from `public/wasm/`, deliberately hidden from the bundler.
//   2. SHAPE. `WasmPileEngine` re-presents the wasm exports with the same API
//      the TypeScript `PileEngine` has -- string lane ids, a `DirtyRect | null`
//      from `consumeDirty()`, `inFlight`/`movesLastStep` as properties -- so the
//      page's frame loop is a line-for-line match with `/sand` and the two are
//      genuinely comparable.
//
// It also owns the one hazard of sharing linear memory with wasm: see
// `refreshViews` below.

import { SAND_ACTIVE, SAND_COMPLETED, SAND_PLACED, SAND_REMOVED } from "./materials";
import type { SandMaterial } from "./materials";

export { SAND_ACTIVE, SAND_COMPLETED, SAND_PLACED, SAND_REMOVED };
export type { SandMaterial };

export interface LaneInput {
  id: string;
  label: string;
  material: SandMaterial;
  /** Largest grain count this lane will ever hold; sizes its territory. */
  peakGrains: number;
}

export interface LaneGeometry extends LaneInput {
  /** Interior column bounds, inclusive. */
  x0: number;
  x1: number;
}

export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The subset of the generated `SandEngine` class this page uses. Declared by
 * hand rather than imported from `public/wasm/sand_engine.d.ts`: the module is
 * fetched at runtime from a path the bundler must not resolve, so there is no
 * import for types to travel along. It mirrors the Rust `#[wasm_bindgen]` impl
 * in `rust/sand-engine/src/lib.rs`.
 */
interface RawSandEngine {
  free(): void;
  width(): number;
  height(): number;
  ground_y(): number;
  lane_count(): number;
  lane_x0(lane: number): number;
  lane_x1(lane: number): number;
  pixels_ptr(): number;
  pixel_bytes(): number;
  step(tick: number): void;
  consume_dirty(): boolean;
  dirty_x(): number;
  dirty_y(): number;
  dirty_w(): number;
  dirty_h(): number;
  remove(lane: number, count: number): number;
  drop_grains(lane: number, count: number, material: number): void;
  stamp(lane: number, count: number, material: number): void;
  settled_in(lane: number): number;
  in_flight(): number;
  moves_last_step(): number;
  overflow(): number;
  clear_sand(): void;
}

/** The loaded wasm module; opaque to the page, which only passes it along. */
export interface SandWasmModule {
  default: (init?: unknown) => Promise<{ memory: WebAssembly.Memory }>;
  SandEngine: new (peaks: Uint32Array, materials: Uint8Array, seed: number) => RawSandEngine;
}

/**
 * Hidden from the bundler on purpose. The specifier is a parameter rather than a
 * literal and carries both ignore pragmas, so neither webpack nor Turbopack
 * tries to resolve `/wasm/sand_engine.js` at build time -- it stays a runtime
 * fetch of a static file, which is the only thing that works under
 * `output: "export"` without touching `next.config.mjs`.
 */
const importRuntime = (specifier: string): Promise<unknown> =>
  import(/* webpackIgnore: true */ /* turbopackIgnore: true */ specifier);

let modulePromise: Promise<SandWasmModule> | null = null;
let memory: WebAssembly.Memory | null = null;

/**
 * Fetch and instantiate the engine module. Cached: the page may mount twice
 * (React strict mode) or re-run its effect on a cluster change, and the wasm
 * instance is reusable -- only the `SandEngine` objects built from it are not.
 *
 * The glue resolves `sand_engine_bg.wasm` relative to its own `import.meta.url`,
 * so the sibling `.wasm` is found automatically and `basePath` needs no help.
 */
export function loadWasmPileEngine(): Promise<SandWasmModule> {
  if (!modulePromise) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    modulePromise = importRuntime(`${base}/wasm/sand_engine.js`)
      .then(async (loaded) => {
        const mod = loaded as SandWasmModule;
        const output = await mod.default();
        memory = output.memory;
        return mod;
      })
      .catch((error: unknown) => {
        // Let the next attempt retry rather than caching the failure forever.
        modulePromise = null;
        throw error;
      });
  }
  return modulePromise;
}

/**
 * Same surface as `app/sand/_components/pileEngine.ts`'s `PileEngine`, backed by
 * the Rust automaton. Lane ids exist only here; across the boundary a lane is
 * its index, so no string is ever marshalled.
 */
export class WasmPileEngine {
  readonly width: number;
  readonly height: number;
  readonly groundY: number;
  readonly lanes: LaneGeometry[];

  /**
   * An `ImageData` aliasing the engine's own pixels in wasm linear memory --
   * nothing is copied on the way to the canvas. Re-created if memory ever grows;
   * read it fresh each frame rather than caching it.
   */
  worldImage: ImageData;

  private readonly raw: RawSandEngine;
  private readonly memory: WebAssembly.Memory;
  private readonly index = new Map<string, number>();
  private readonly pixelsPtr: number;
  private readonly pixelLen: number;
  /**
   * The `ArrayBuffer` the current views were built from.
   *
   * This is the one hazard of aliasing wasm linear memory: classically,
   * `memory.grow()` replaces `memory.buffer` with a NEW object and DETACHES
   * every view onto the old one, which would leave `worldImage` silently
   * pointing at nothing and freeze the canvas. The engine reserves its buffers
   * up front (see FLIER_CAPACITY / STREAK_CAPACITY in the Rust) so growth does
   * not happen for this workload -- but "does not" is not "cannot", and the
   * failure is invisible rather than loud, so it is checked rather than assumed.
   *
   * An identity comparison covers both of the behaviours engines have here: with
   * a classic buffer a grow changes the object and the views are rebuilt; with
   * the newer resizable-ArrayBuffer integration a grow resizes in place, nothing
   * detaches, the identity is unchanged and no rebuild is needed. Either way the
   * views that get read are valid.
   */
  private viewBuffer: ArrayBuffer;

  constructor(mod: SandWasmModule, laneInputs: LaneInput[], seed = 1) {
    if (!memory) throw new Error("wasm module not initialised");
    this.memory = memory;
    const peaks = new Uint32Array(laneInputs.map((l) => Math.max(0, Math.ceil(l.peakGrains))));
    const materials = new Uint8Array(laneInputs.map((l) => l.material));
    this.raw = new mod.SandEngine(peaks, materials, seed >>> 0);

    this.width = this.raw.width();
    this.height = this.raw.height();
    this.groundY = this.raw.ground_y();
    this.lanes = laneInputs.map((input, i) => ({
      ...input,
      x0: this.raw.lane_x0(i),
      x1: this.raw.lane_x1(i),
    }));
    laneInputs.forEach((input, i) => this.index.set(input.id, i));

    this.pixelsPtr = this.raw.pixels_ptr();
    this.pixelLen = this.raw.pixel_bytes();
    this.viewBuffer = this.memory.buffer;
    this.worldImage = this.buildImage();
  }

  private buildImage(): ImageData {
    const view = new Uint8ClampedArray(this.memory.buffer, this.pixelsPtr, this.pixelLen);
    return new ImageData(view, this.width, this.height);
  }

  /**
   * Call after anything that could have allocated in wasm. Returns true if the
   * views were rebuilt, so the caller knows its cached `worldImage` is stale and
   * the whole world needs re-uploading.
   */
  refreshViews(): boolean {
    if (this.memory.buffer === this.viewBuffer) return false;
    this.viewBuffer = this.memory.buffer;
    this.worldImage = this.buildImage();
    return true;
  }

  private laneIndex(id: string): number {
    const found = this.index.get(id);
    if (found === undefined) throw new Error(`Unknown lane "${id}"`);
    return found;
  }

  lane(id: string): LaneGeometry {
    return this.lanes[this.laneIndex(id)];
  }

  /** Settled grains currently in a lane (excludes grains still falling toward it). */
  settledIn(id: string): number {
    return this.raw.settled_in(this.laneIndex(id));
  }

  /** Vanish grains off a pile's summit; returns how many actually went. */
  remove(id: string, count: number): number {
    if (count <= 0) return 0;
    return this.raw.remove(this.laneIndex(id), Math.floor(count));
  }

  /** Rain grains into a lane from the sky above it. */
  drop(id: string, count: number, material: SandMaterial): void {
    if (count <= 0) return;
    this.raw.drop_grains(this.laneIndex(id), Math.floor(count), material);
  }

  /** Lay grains down as an already-settled cone: the instant-seek path. */
  stamp(id: string, count: number, material: SandMaterial): void {
    if (count <= 0) return;
    this.raw.stamp(this.laneIndex(id), Math.floor(count), material);
  }

  step(tick = 0): void {
    this.raw.step(tick >>> 0);
  }

  /** The pixel rectangle touched since the last call, or null if nothing was. */
  consumeDirty(): DirtyRect | null {
    if (!this.raw.consume_dirty()) return null;
    return {
      x: this.raw.dirty_x(),
      y: this.raw.dirty_y(),
      w: this.raw.dirty_w(),
      h: this.raw.dirty_h(),
    };
  }

  get inFlight(): number {
    return this.raw.in_flight();
  }

  /** Automaton cell moves in the most recent step; 0 = every pile is at rest. */
  get movesLastStep(): number {
    return this.raw.moves_last_step();
  }

  /** Grains that had nowhere to land; should stay 0 by construction. */
  get overflow(): number {
    return this.raw.overflow();
  }

  clearSand(): void {
    this.raw.clear_sand();
  }

  /** Release the wasm-side allocation; the world is tens of megabytes. */
  free(): void {
    this.raw.free();
  }
}
