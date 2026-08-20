/* tslint:disable */
/* eslint-disable */

export class SandEngine {
    free(): void;
    [Symbol.dispose](): void;
    cell_count(): number;
    /**
     * Byte offset of the cell array; one `u8` material per cell. Exposed for
     * debugging and parity checks against the TypeScript engine, not needed by
     * the render path.
     */
    cells_ptr(): number;
    clear_sand(): void;
    /**
     * Latches the pixel rectangle touched since the previous call and returns
     * whether there was one. Read it with `dirty_x/y/w/h`.
     */
    consume_dirty(): boolean;
    dirty_h(): number;
    dirty_w(): number;
    dirty_x(): number;
    dirty_y(): number;
    /**
     * Rain `count` grains into a lane from the sky above it.
     */
    drop_grains(lane: number, count: number, material: number): void;
    /**
     * Top row of the ground slab.
     */
    ground_y(): number;
    height(): number;
    in_flight(): number;
    lane_count(): number;
    lane_material(lane: number): number;
    /**
     * Inclusive left interior column of a lane, or -1 for an unknown lane.
     */
    lane_x0(lane: number): number;
    /**
     * Inclusive right interior column of a lane, or -1 for an unknown lane.
     */
    lane_x1(lane: number): number;
    /**
     * Automaton cell moves in the most recent step; 0 = every pile is at rest.
     */
    moves_last_step(): number;
    /**
     * `peaks[i]` is lane i's largest ever grain count, `materials[i]` its sand
     * material. Extra entries in the longer array are ignored. `seed` seeds the
     * engine's internal PRNG -- `wasm32-unknown-unknown` has no entropy of its
     * own, so pass something from `Date.now()` for variety or a constant for a
     * reproducible run.
     */
    constructor(peaks: Uint32Array, materials: Uint8Array, seed: number);
    /**
     * Grains that had nowhere to land; should stay 0 by construction.
     */
    overflow(): number;
    pixel_bytes(): number;
    /**
     * Byte offset of the RGBA pixel buffer in linear memory. Wrap as
     * `new Uint8ClampedArray(memory.buffer, ptr, pixel_bytes())`.
     */
    pixels_ptr(): number;
    /**
     * Vanish up to `count` grains off a pile's summit; returns how many
     * actually went. Short when the pile has run dry, which the caller carries
     * as a debt to the next frame.
     */
    remove(lane: number, count: number): number;
    /**
     * Settled grains in a lane, excluding grains still falling toward it. Can
     * go negative in the same circumstances the TypeScript engine's could --
     * `remove` is called against a lane whose bookkeeping ran ahead.
     */
    settled_in(lane: number): number;
    /**
     * Lay `count` grains down as an already-settled cone: the instant-seek
     * path.
     */
    stamp(lane: number, count: number, material: number): void;
    /**
     * One frame of physics, plus every incremental pixel write it implies.
     */
    step(tick: number): void;
    width(): number;
}

/**
 * Material constants, so the TypeScript side never hard-codes them twice.
 */
export function materials(): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_sandengine_free: (a: number, b: number) => void;
    readonly materials: () => [number, number];
    readonly sandengine_cell_count: (a: number) => number;
    readonly sandengine_cells_ptr: (a: number) => number;
    readonly sandengine_clear_sand: (a: number) => void;
    readonly sandengine_consume_dirty: (a: number) => number;
    readonly sandengine_dirty_h: (a: number) => number;
    readonly sandengine_dirty_w: (a: number) => number;
    readonly sandengine_dirty_x: (a: number) => number;
    readonly sandengine_dirty_y: (a: number) => number;
    readonly sandengine_drop_grains: (a: number, b: number, c: number, d: number) => void;
    readonly sandengine_ground_y: (a: number) => number;
    readonly sandengine_height: (a: number) => number;
    readonly sandengine_in_flight: (a: number) => number;
    readonly sandengine_lane_count: (a: number) => number;
    readonly sandengine_lane_material: (a: number, b: number) => number;
    readonly sandengine_lane_x0: (a: number, b: number) => number;
    readonly sandengine_lane_x1: (a: number, b: number) => number;
    readonly sandengine_moves_last_step: (a: number) => number;
    readonly sandengine_new: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly sandengine_overflow: (a: number) => number;
    readonly sandengine_pixel_bytes: (a: number) => number;
    readonly sandengine_pixels_ptr: (a: number) => number;
    readonly sandengine_remove: (a: number, b: number, c: number) => number;
    readonly sandengine_settled_in: (a: number, b: number) => number;
    readonly sandengine_stamp: (a: number, b: number, c: number, d: number) => void;
    readonly sandengine_step: (a: number, b: number) => void;
    readonly sandengine_width: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
