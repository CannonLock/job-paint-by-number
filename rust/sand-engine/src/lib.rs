//! The JavaScript boundary for the falling-sand pile automaton.
//!
//! Everything of substance lives in [`engine`], which is plain Rust with no
//! `wasm-bindgen` in sight so that `cargo test` can exercise the whole
//! simulation on the host target. This module is only the shim.
//!
//! Design notes for the boundary, which is crossed ~10 times per animation
//! frame and must therefore cost approximately nothing:
//!
//! * NO ALLOCATION PER FRAME. `consume_dirty` latches the rectangle into four
//!   fields and returns a `bool`; the caller reads the fields with four getters.
//!   Returning an `Option<struct>` would mint a JS object every frame, and
//!   writing into a `&mut [u32]` would copy in and out. Four `i32` getter calls
//!   are a handful of nanoseconds and touch no heap. (The TypeScript wrapper
//!   re-assembles a `DirtyRect | null` so the page's frame loop still reads like
//!   the original.)
//! * NO STRINGS. Lanes are addressed by index. Ids and labels stay in
//!   TypeScript, where they came from.
//! * ZERO-COPY PIXELS. [`SandEngine::pixels_ptr`] hands out an offset into
//!   linear memory; the caller wraps it in a `Uint8ClampedArray` and an
//!   `ImageData` that alias Rust's own buffer, so a frame's pixel updates need
//!   no marshalling at all -- just one `putImageData` of the dirty rectangle.
//!
//! MEMORY GROWTH. Views onto `WebAssembly.Memory` detach the moment the memory
//! grows, which would silently break the `ImageData` alias. Two defences, both
//! required:
//!   1. Here: every large buffer is allocated once in the constructor, and the
//!      flier and streak vectors are pre-reserved to capacities the real
//!      workload does not reach (see `FLIER_CAPACITY` / `STREAK_CAPACITY`), so
//!      steady-state frames allocate nothing.
//!   2. On the JS side: `app/sand-wasm/_components/wasmEngine.ts` keeps the
//!      `ArrayBuffer` it built its views from and compares it against
//!      `memory.buffer` each frame -- a grow replaces that object, so the
//!      mismatch is detected and the views plus the `ImageData` are rebuilt
//!      before anything reads them.

mod engine;

use wasm_bindgen::prelude::*;

pub use engine::{
    DirtyRect, LaneGeometry, LaneInput, PileEngine, EMPTY, SAND_ACTIVE, SAND_COMPLETED,
    SAND_PLACED, SAND_REMOVED, WALL,
};

/// Material constants, so the TypeScript side never hard-codes them twice.
#[wasm_bindgen(js_name = materials)]
pub fn materials() -> Vec<u8> {
    vec![EMPTY, WALL, SAND_PLACED, SAND_ACTIVE, SAND_COMPLETED, SAND_REMOVED]
}

#[wasm_bindgen]
pub struct SandEngine {
    inner: PileEngine,
    dirty: [u32; 4],
}

#[wasm_bindgen]
impl SandEngine {
    /// `peaks[i]` is lane i's largest ever grain count, `materials[i]` its sand
    /// material. Extra entries in the longer array are ignored. `seed` seeds the
    /// engine's internal PRNG -- `wasm32-unknown-unknown` has no entropy of its
    /// own, so pass something from `Date.now()` for variety or a constant for a
    /// reproducible run.
    #[wasm_bindgen(constructor)]
    pub fn new(peaks: &[u32], materials: &[u8], seed: u32) -> SandEngine {
        let inputs: Vec<engine::LaneInput> = peaks
            .iter()
            .zip(materials.iter())
            .map(|(&peak_grains, &material)| engine::LaneInput { material, peak_grains })
            .collect();
        SandEngine { inner: PileEngine::new(&inputs, seed), dirty: [0; 4] }
    }

    // --- World geometry -----------------------------------------------------

    #[wasm_bindgen(js_name = width)]
    pub fn width(&self) -> i32 {
        self.inner.width()
    }

    #[wasm_bindgen(js_name = height)]
    pub fn height(&self) -> i32 {
        self.inner.height()
    }

    /// Top row of the ground slab.
    #[wasm_bindgen(js_name = ground_y)]
    pub fn ground_y(&self) -> i32 {
        self.inner.ground_y()
    }

    #[wasm_bindgen(js_name = lane_count)]
    pub fn lane_count(&self) -> u32 {
        self.inner.lanes().len() as u32
    }

    /// Inclusive left interior column of a lane, or -1 for an unknown lane.
    #[wasm_bindgen(js_name = lane_x0)]
    pub fn lane_x0(&self, lane: u32) -> i32 {
        self.inner.lanes().get(lane as usize).map_or(-1, |l| l.x0)
    }

    /// Inclusive right interior column of a lane, or -1 for an unknown lane.
    #[wasm_bindgen(js_name = lane_x1)]
    pub fn lane_x1(&self, lane: u32) -> i32 {
        self.inner.lanes().get(lane as usize).map_or(-1, |l| l.x1)
    }

    #[wasm_bindgen(js_name = lane_material)]
    pub fn lane_material(&self, lane: u32) -> u8 {
        self.inner.lanes().get(lane as usize).map_or(EMPTY, |l| l.material)
    }

    // --- Zero-copy buffers --------------------------------------------------

    /// Byte offset of the RGBA pixel buffer in linear memory. Wrap as
    /// `new Uint8ClampedArray(memory.buffer, ptr, pixel_bytes())`.
    #[wasm_bindgen(js_name = pixels_ptr)]
    pub fn pixels_ptr(&self) -> u32 {
        self.inner.pixels_ptr() as u32
    }

    #[wasm_bindgen(js_name = pixel_bytes)]
    pub fn pixel_bytes(&self) -> u32 {
        (self.inner.width() as u32) * (self.inner.height() as u32) * 4
    }

    /// Byte offset of the cell array; one `u8` material per cell. Exposed for
    /// debugging and parity checks against the TypeScript engine, not needed by
    /// the render path.
    #[wasm_bindgen(js_name = cells_ptr)]
    pub fn cells_ptr(&self) -> u32 {
        self.inner.cells_ptr() as u32
    }

    #[wasm_bindgen(js_name = cell_count)]
    pub fn cell_count(&self) -> u32 {
        (self.inner.width() as u32) * (self.inner.height() as u32)
    }

    // --- Frame --------------------------------------------------------------

    /// One frame of physics, plus every incremental pixel write it implies.
    #[wasm_bindgen(js_name = step)]
    pub fn step(&mut self, tick: u32) {
        self.inner.step(tick);
    }

    /// Latches the pixel rectangle touched since the previous call and returns
    /// whether there was one. Read it with `dirty_x/y/w/h`.
    #[wasm_bindgen(js_name = consume_dirty)]
    pub fn consume_dirty(&mut self) -> bool {
        match self.inner.consume_dirty() {
            Some(rect) => {
                self.dirty = [rect.x, rect.y, rect.w, rect.h];
                true
            }
            None => false,
        }
    }

    #[wasm_bindgen(js_name = dirty_x)]
    pub fn dirty_x(&self) -> u32 {
        self.dirty[0]
    }

    #[wasm_bindgen(js_name = dirty_y)]
    pub fn dirty_y(&self) -> u32 {
        self.dirty[1]
    }

    #[wasm_bindgen(js_name = dirty_w)]
    pub fn dirty_w(&self) -> u32 {
        self.dirty[2]
    }

    #[wasm_bindgen(js_name = dirty_h)]
    pub fn dirty_h(&self) -> u32 {
        self.dirty[3]
    }

    // --- Sand operations ----------------------------------------------------

    /// Vanish up to `count` grains off a pile's summit; returns how many
    /// actually went. Short when the pile has run dry, which the caller carries
    /// as a debt to the next frame.
    #[wasm_bindgen(js_name = remove)]
    pub fn remove(&mut self, lane: u32, count: u32) -> u32 {
        self.inner.remove(lane as usize, count)
    }

    /// Rain `count` grains into a lane from the sky above it.
    #[wasm_bindgen(js_name = drop_grains)]
    pub fn drop_grains(&mut self, lane: u32, count: u32, material: u8) {
        self.inner.drop_grains(lane as usize, count, material);
    }

    /// Lay `count` grains down as an already-settled cone: the instant-seek
    /// path.
    #[wasm_bindgen(js_name = stamp)]
    pub fn stamp(&mut self, lane: u32, count: u32, material: u8) {
        self.inner.stamp(lane as usize, count, material);
    }

    /// Settled grains in a lane, excluding grains still falling toward it. Can
    /// go negative in the same circumstances the TypeScript engine's could --
    /// `remove` is called against a lane whose bookkeeping ran ahead.
    #[wasm_bindgen(js_name = settled_in)]
    pub fn settled_in(&self, lane: u32) -> i32 {
        self.inner.settled_in(lane as usize) as i32
    }

    #[wasm_bindgen(js_name = in_flight)]
    pub fn in_flight(&self) -> u32 {
        self.inner.in_flight()
    }

    /// Automaton cell moves in the most recent step; 0 = every pile is at rest.
    #[wasm_bindgen(js_name = moves_last_step)]
    pub fn moves_last_step(&self) -> u32 {
        self.inner.moves_last_step()
    }

    /// Grains that had nowhere to land; should stay 0 by construction.
    #[wasm_bindgen(js_name = overflow)]
    pub fn overflow(&self) -> u32 {
        self.inner.overflow()
    }

    #[wasm_bindgen(js_name = clear_sand)]
    pub fn clear_sand(&mut self) {
        self.inner.clear_sand();
    }
}
