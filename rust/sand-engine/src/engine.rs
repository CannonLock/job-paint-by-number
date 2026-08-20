//! Four free-standing sand piles, one per job state, on a shared ground line.
//! One grain is one job -- no binning.
//!
//! This is a line-for-line port of `app/sand/_components/pileEngine.ts`. The
//! contract it exists to uphold is unchanged: a pile's grain count IS that
//! state's census at the current playback instant. Grains enter a pile by
//! falling from the sky above its lane; they leave by vanishing off the summit.
//! A state transition is therefore exactly what it looks like -- the grain
//! disappears from the old pile and drops into the new one.
//!
//! Performance model, also unchanged from the TypeScript original:
//!
//!   1. DIRTY-ROW AUTOMATON. Settled sand costs nothing: only rows flagged by
//!      last frame's activity are stepped, and a move re-flags its neighbouring
//!      rows. A scene at rest performs zero cell work.
//!   2. INCREMENTAL PIXELS. The engine owns the world's RGBA buffer in linear
//!      memory and writes a cell's colour only when that cell changes,
//!      accumulating a dirty rectangle the caller uploads with one
//!      putImageData. Fliers are drawn as erase-and-repaint streaks; the Active
//!      shimmer explicitly repaints its (small) lane box each frame.
//!
//! Deliberate divergences from the TypeScript engine, all cosmetic:
//!
//!   * `Math.random()` is replaced by an internal xorshift32. `wasm32-unknown-
//!     unknown` has no entropy source and `getrandom` would drag in a JS
//!     shim, so the jitter is seeded deterministically instead. Same statistics,
//!     reproducible runs.
//!   * Flier kinematics use `f32` rather than `f64`. Purely decorative motion
//!     over a ~100 cell fall; halves the per-flier footprint.
//!   * Lanes are addressed by index instead of by string id, so no strings ever
//!     cross the wasm boundary. The TypeScript wrapper keeps the id/label map.
//!
//! There is no `wasm_bindgen` in this module on purpose: the whole simulation is
//! plain Rust and is unit-tested on the host target.

pub const EMPTY: u8 = 0;
pub const WALL: u8 = 1;
pub const SAND_PLACED: u8 = 2;
pub const SAND_ACTIVE: u8 = 3;
pub const SAND_COMPLETED: u8 = 4;
pub const SAND_REMOVED: u8 = 5;
pub const MATERIAL_COUNT: usize = 6;

/// Sky reserved above the tallest possible pile, so drops have room to fall.
const HEADROOM: i32 = 110;
const GROUND_THICKNESS: i32 = 4;
/// Gap each side of a lane's peak cone, so a slightly ragged base still fits.
const LANE_MARGIN: i32 = 12;
/// A lane that never holds sand still gets a visible territory.
const MIN_HALF_WIDTH: i32 = 26;
/// Divider wall between lanes, in cells.
const DIVIDER: i32 = 2;

const GRAVITY: f32 = 0.3;

/// Three shades per material, as 0xRRGGBB. Index 0 (EMPTY) is never read.
const SHADES: [[u32; 3]; MATERIAL_COUNT] = [
    [0x000000, 0x000000, 0x000000],
    [0xc9c4b8, 0xc2bdb1, 0xd0cbbf], // WALL
    [0xeda100, 0xd9930a, 0xf7b02a], // SAND_PLACED
    [0x3b5bdb, 0x3450c4, 0x5470e6], // SAND_ACTIVE
    [0x2a9d8f, 0x248b7f, 0x37b3a3], // SAND_COMPLETED
    [0xae2012, 0x991c10, 0xc62d1d], // SAND_REMOVED
];

/// 0xAABBGGRR, matching the little-endian byte order an `ImageData` expects, so
/// a whole pixel is one `u32` store.
const fn to_abgr(rgb: u32) -> u32 {
    0xff00_0000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
}

/// Generous up-front capacities. Every allocation the engine performs after
/// construction risks a `memory.grow`, which detaches the JavaScript views onto
/// linear memory; reserving here means growth does not happen at all for the
/// workload this page actually runs. (The JS side still re-acquires its views if
/// it ever does -- see `app/sand-wasm/_components/wasmEngine.ts`.)
///
/// Sized from the real data rather than guessed: replaying the full all-clusters
/// timeline, the busiest day pours ~7.3k grains per frame with a ~24 frame fall,
/// peaking near 175k grains in flight, each carrying two or three streak pixels.
/// Together these two reservations are ~13 MB against a ~56 MB world.
const FLIER_CAPACITY: usize = 1 << 18;
const STREAK_CAPACITY: usize = 1 << 20;

#[derive(Clone, Copy, Debug)]
pub struct LaneInput {
    pub material: u8,
    /// Largest grain count this lane will ever hold; sizes its territory.
    pub peak_grains: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct LaneGeometry {
    pub material: u8,
    pub peak_grains: u32,
    /// Interior column bounds, inclusive.
    pub x0: i32,
    pub x1: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DirtyRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Copy)]
struct FlyingGrain {
    x: f32,
    y: f32,
    /// Position last frame, so the streak render joins the two.
    px: f32,
    py: f32,
    vx: f32,
    vy: f32,
    material: u8,
    ttl: i32,
    lane: u32,
}

pub struct PileEngine {
    width: i32,
    height: i32,
    /// Top row of the ground slab.
    ground_y: i32,
    lanes: Vec<LaneGeometry>,

    cells: Vec<u8>,
    /// The world's pixels, engine-maintained: a cell's colour is written when
    /// the cell changes, never in a bulk pass.
    pixels: Vec<u32>,

    /// Automaton cell moves in the most recent step; 0 = every pile is at rest.
    moves_last_step: u32,
    /// Grains that had nowhere to land; should stay 0 by construction.
    overflow: u32,

    palette: [u32; MATERIAL_COUNT * 3],
    bg_rows: Vec<u32>,
    flying: Vec<FlyingGrain>,
    settled: Vec<i64>,
    /// Highest (smallest y) cell each lane has ever settled since the last
    /// clear. Only ever moved up, so it is always at or above the true summit --
    /// a safe, cheap starting row for the summit scan in `remove`.
    top_y: Vec<i32>,

    /// Rows the automaton must process this step / next step.
    row_active: Vec<u8>,
    row_next: Vec<u8>,

    /// Pixel indices holding a flier streak, to erase before the next frame.
    streak_pixels: Vec<u32>,

    /// Accumulated dirty pixel rectangle since the last `consume_dirty`.
    dx0: i32,
    dy0: i32,
    dx1: i32,
    dy1: i32,
    dirty_any: bool,

    last_shimmer_phase: i64,
    rng: u32,
}

impl PileEngine {
    pub fn new(lane_inputs: &[LaneInput], seed: u32) -> Self {
        // --- Geometry from the peaks ---------------------------------------
        // A cone at 45-degree repose holding N grains is ~sqrt(N) tall on a base
        // of ~2*sqrt(N); the lane is that base plus margin.
        let mut tallest = 0i32;
        let mut cursor = DIVIDER;
        let mut lanes: Vec<LaneGeometry> = Vec::with_capacity(lane_inputs.len());
        for input in lane_inputs {
            let cone_height = (f64::from(input.peak_grains)).sqrt().ceil() as i32;
            tallest = tallest.max(cone_height);
            let half = (cone_height + LANE_MARGIN).max(MIN_HALF_WIDTH);
            lanes.push(LaneGeometry {
                material: input.material,
                peak_grains: input.peak_grains,
                x0: cursor,
                x1: cursor + half * 2,
            });
            cursor += half * 2 + 1 + DIVIDER;
        }
        let width = cursor;
        let height = tallest + HEADROOM + GROUND_THICKNESS;
        let ground_y = height - GROUND_THICKNESS;
        let cell_count = (width as usize) * (height as usize);

        let mut palette = [0u32; MATERIAL_COUNT * 3];
        for (material, shades) in SHADES.iter().enumerate() {
            for (i, &rgb) in shades.iter().enumerate() {
                palette[material * 3 + i] = to_abgr(rgb);
            }
        }

        // Subtle vertical gradient so the scene reads as a lit space rather
        // than a void.
        let mut bg_rows = vec![0u32; height as usize];
        // #faf9f6 at the top fading to #e8e5dc at the ground.
        let (tr, tg, tb) = (250.0f64, 249.0f64, 246.0f64);
        let (br, bg, bb) = (232.0f64, 229.0f64, 220.0f64);
        for y in 0..height {
            let t = f64::from(y) / f64::from((height - 1).max(1));
            let r = (tr + (br - tr) * t).round() as u32;
            let g = (tg + (bg - tg) * t).round() as u32;
            let b = (tb + (bb - tb) * t).round() as u32;
            bg_rows[y as usize] = 0xff00_0000 | (b << 16) | (g << 8) | r;
        }

        let lane_count = lanes.len();
        let mut engine = PileEngine {
            width,
            height,
            ground_y,
            lanes,
            cells: vec![EMPTY; cell_count],
            pixels: vec![0u32; cell_count],
            moves_last_step: 0,
            overflow: 0,
            palette,
            bg_rows,
            flying: Vec::with_capacity(FLIER_CAPACITY),
            settled: vec![0; lane_count],
            top_y: vec![ground_y; lane_count],
            row_active: vec![0; height as usize],
            row_next: vec![0; height as usize],
            streak_pixels: Vec::with_capacity(STREAK_CAPACITY),
            dx0: 0,
            dy0: 0,
            dx1: 0,
            dy1: 0,
            dirty_any: false,
            last_shimmer_phase: -1,
            // A zero xorshift state is a fixed point; keep it away from zero.
            rng: if seed == 0 { 0x9e37_79b9 } else { seed },
        };

        engine.build_walls(tallest);

        // Paint the whole initial world once; everything after is incremental.
        for y in 0..height {
            let row = (y * width) as usize;
            for x in 0..width as usize {
                engine.paint(row + x, y, 0);
            }
        }
        engine.mark_dirty(0, 0);
        engine.mark_dirty(width - 1, height - 1);
        engine
    }

    fn build_walls(&mut self, tallest: i32) {
        let width = self.width;
        for y in self.ground_y..self.height {
            for x in 0..width {
                self.cells[(y * width + x) as usize] = WALL;
            }
        }
        let divider_top = (self.ground_y - tallest - 14).max(0);
        let columns: Vec<i32> = self
            .lanes
            .iter()
            .flat_map(|lane| (1..=DIVIDER).flat_map(move |t| [lane.x0 - t, lane.x1 + t]))
            .collect();
        for x in columns {
            if x < 0 || x >= width {
                continue;
            }
            for y in divider_top..self.ground_y {
                self.cells[(y * width + x) as usize] = WALL;
            }
        }
    }

    // --- Deterministic jitter ----------------------------------------------

    #[inline]
    fn next_u32(&mut self) -> u32 {
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.rng = x;
        x
    }

    /// Uniform in [0, 1). Drops the low bits, whose quality in xorshift32 is
    /// the poorest.
    #[inline]
    fn next_unit(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / 16_777_216.0
    }

    #[inline]
    fn coin(&mut self) -> bool {
        self.next_u32() < 0x8000_0000
    }

    // --- Incremental pixels -------------------------------------------------

    /// The colour a cell should show, from its material and a stable per-cell
    /// hash.
    #[inline]
    fn colour_of(&self, idx: usize, y: i32, phase: i64) -> u32 {
        let material = self.cells[idx];
        if material == EMPTY {
            return self.bg_rows[y as usize];
        }
        // Mirrors the JS `Math.imul(seed, 2654435761) >>> 0 % 3` exactly: the
        // multiply is 32-bit wrapping, the result read as unsigned.
        let seed = if material == SAND_ACTIVE {
            (idx as i64 + phase * 7349) as i32 as u32
        } else {
            idx as u32
        };
        let variant = seed.wrapping_mul(2_654_435_761) % 3;
        self.palette[material as usize * 3 + variant as usize]
    }

    #[inline]
    fn paint(&mut self, idx: usize, y: i32, phase: i64) {
        self.pixels[idx] = self.colour_of(idx, y, phase);
    }

    #[inline]
    fn mark_dirty(&mut self, x: i32, y: i32) {
        if !self.dirty_any {
            self.dirty_any = true;
            self.dx0 = x;
            self.dx1 = x;
            self.dy0 = y;
            self.dy1 = y;
            return;
        }
        if x < self.dx0 {
            self.dx0 = x;
        }
        if x > self.dx1 {
            self.dx1 = x;
        }
        if y < self.dy0 {
            self.dy0 = y;
        }
        if y > self.dy1 {
            self.dy1 = y;
        }
    }

    /// The pixel rectangle touched since the last call, or `None` if nothing
    /// was.
    pub fn consume_dirty(&mut self) -> Option<DirtyRect> {
        if !self.dirty_any {
            return None;
        }
        self.dirty_any = false;
        Some(DirtyRect {
            x: self.dx0 as u32,
            y: self.dy0 as u32,
            w: (self.dx1 - self.dx0 + 1) as u32,
            h: (self.dy1 - self.dy0 + 1) as u32,
        })
    }

    /// Every cell mutation funnels through this, keeping pixels in lockstep.
    #[inline]
    fn set_cell(&mut self, idx: usize, y: i32, material: u8) {
        self.cells[idx] = material;
        self.paint(idx, y, 0);
        self.mark_dirty(idx as i32 - y * self.width, y);
    }

    /// Wake the automaton around a row: it and both neighbours run next step.
    #[inline]
    fn wake(&mut self, y: i32) {
        if y > 0 {
            self.row_next[(y - 1) as usize] = 1;
        }
        self.row_next[y as usize] = 1;
        if y + 1 < self.height {
            self.row_next[(y + 1) as usize] = 1;
        }
    }

    // --- Geometry accessors -------------------------------------------------

    #[inline]
    pub fn width(&self) -> i32 {
        self.width
    }
    #[inline]
    pub fn height(&self) -> i32 {
        self.height
    }
    #[inline]
    pub fn ground_y(&self) -> i32 {
        self.ground_y
    }
    #[inline]
    pub fn lanes(&self) -> &[LaneGeometry] {
        &self.lanes
    }
    #[inline]
    pub fn cells(&self) -> &[u8] {
        &self.cells
    }
    #[inline]
    pub fn pixels(&self) -> &[u32] {
        &self.pixels
    }
    #[inline]
    pub fn pixels_ptr(&self) -> *const u32 {
        self.pixels.as_ptr()
    }
    #[inline]
    pub fn cells_ptr(&self) -> *const u8 {
        self.cells.as_ptr()
    }
    #[inline]
    pub fn moves_last_step(&self) -> u32 {
        self.moves_last_step
    }
    #[inline]
    pub fn overflow(&self) -> u32 {
        self.overflow
    }
    #[inline]
    pub fn in_flight(&self) -> u32 {
        self.flying.len() as u32
    }

    /// Settled grains currently in a lane (excludes grains still falling toward
    /// it).
    #[inline]
    pub fn settled_in(&self, lane: usize) -> i64 {
        self.settled.get(lane).copied().unwrap_or(0)
    }

    // --- Sand operations ----------------------------------------------------

    /// Vanish grains off a pile's summit. Scanning rows top-down from the
    /// tracked summit means the highest sand goes first, so the pile visibly
    /// shrinks from the top. Returns how many were actually removed; short when
    /// the pile has run dry (e.g. the matching grains are still mid-air), which
    /// the caller carries as a debt to the next frame.
    pub fn remove(&mut self, lane: usize, count: u32) -> u32 {
        if count == 0 || lane >= self.lanes.len() {
            return 0;
        }
        let (x0, x1) = (self.lanes[lane].x0, self.lanes[lane].x1);
        let width = self.width;
        let mut removed = 0u32;
        let mut y = self.top_y[lane];
        while y < self.ground_y && removed < count {
            let row = (y * width) as usize;
            let left_first = (y & 1) == 0;
            let mut touched = false;
            let span = x1 - x0;
            let mut i = 0;
            while i <= span && removed < count {
                let x = if left_first { x0 + i } else { x1 - i };
                let idx = row + x as usize;
                if self.cells[idx] > WALL {
                    self.set_cell(idx, y, EMPTY);
                    removed += 1;
                    touched = true;
                }
                i += 1;
            }
            if touched {
                self.wake(y);
            }
            y += 1;
        }
        self.settled[lane] -= i64::from(removed);
        removed
    }

    /// Drop grains from the sky into a lane: how transitions arrive, and how
    /// newly placed work arrives. Spawn height rides just above the current
    /// summit so the fall is quick but always visible.
    pub fn drop_grains(&mut self, lane: usize, count: u32, material: u8) {
        if count == 0 || lane >= self.lanes.len() {
            return;
        }
        let (x0, x1) = (self.lanes[lane].x0, self.lanes[lane].x1);
        let cx = (x0 + x1) as f32 / 2.0;
        let spread = (x1 - x0) as f32 * 0.3;
        let summit = self.top_y[lane];
        let spawn_y = (summit - 90).max(2);
        let dy = (summit - 2 - spawn_y).max(4);
        let ttl = ((2.0 * dy as f32 / GRAVITY).sqrt().round() as i32).max(4);
        self.flying.reserve(count as usize);
        for _ in 0..count {
            let x = cx + (self.next_unit() - 0.5) * spread;
            let vx = (self.next_unit() - 0.5) * 0.15;
            self.flying.push(FlyingGrain {
                x,
                y: spawn_y as f32,
                px: x,
                py: spawn_y as f32,
                vx,
                vy: 0.0,
                material,
                ttl,
                lane: lane as u32,
            });
        }
    }

    /// Lay `count` grains down as an already-settled cone: the instant-seek
    /// path. Rows go floor-up, each one two cells narrower -- the automaton's
    /// own stable shape; anything slightly off relaxes with a brief avalanche.
    pub fn stamp(&mut self, lane: usize, count: u32, material: u8) {
        if count == 0 || lane >= self.lanes.len() {
            return;
        }
        let (lx0, lx1) = (self.lanes[lane].x0, self.lanes[lane].x1);
        let cx = f64::from(lx0 + lx1) / 2.0;
        let half_max = f64::from(lx1 - lx0) / 2.0;
        let cone = f64::from(count).sqrt().ceil();
        let mut remaining = i64::from(count);
        let mut placed = 0i64;

        let mut level = 0i32;
        while remaining > 0 {
            let y = self.ground_y - 1 - level;
            if y < 0 {
                break;
            }
            let half = half_max.min(cone - f64::from(level));
            if half < 0.5 {
                break;
            }
            let x0 = f64::from(lx0).max((cx - half).ceil()) as i64;
            let x1 = f64::from(lx1).min((cx + half).floor()) as i64;
            let row_width = x1 - x0 + 1;
            if row_width <= 0 {
                break;
            }

            let n = remaining.min(row_width);
            let centred = (cx - n as f64 / 2.0).round();
            let start = (x0 as f64).max(((x1 - n + 1) as f64).min(centred)) as i64;
            let row = (y * self.width) as usize;
            for k in 0..n {
                let idx = row + (start + k) as usize;
                if self.cells[idx] == EMPTY {
                    self.set_cell(idx, y, material);
                    placed += 1;
                }
            }
            remaining -= n;
            self.wake(y);
            if y < self.top_y[lane] {
                self.top_y[lane] = y;
            }
            level += 1;
        }
        self.settled[lane] += placed;
        if remaining > 0 {
            self.overflow += remaining as u32;
        }
    }

    /// Land an arriving grain: first free cell at or above the impact point,
    /// spreading a few columns if that one is packed. A grain that "settles" in
    /// open air is fine -- it becomes an automaton grain and keeps falling.
    fn settle(&mut self, x: f32, y: f32, material: u8, lane: usize) {
        let (lx0, lx1) = (self.lanes[lane].x0, self.lanes[lane].x1);
        let start_x = round_half_up(x).clamp(lx0, lx1);
        let start_y = round_half_up(y).clamp(0, self.ground_y - 1);

        for dx in 0..=8i32 {
            let columns: [i32; 2] = if dx == 0 {
                [start_x, i32::MIN]
            } else {
                [start_x - dx, start_x + dx]
            };
            for &cx in &columns {
                if cx == i32::MIN || cx < lx0 || cx > lx1 {
                    continue;
                }
                let mut yi = start_y;
                while yi >= 0 {
                    let idx = (yi * self.width + cx) as usize;
                    let cell = self.cells[idx];
                    if cell == EMPTY {
                        self.set_cell(idx, yi, material);
                        self.wake(yi);
                        self.settled[lane] += 1;
                        if yi < self.top_y[lane] {
                            self.top_y[lane] = yi;
                        }
                        return;
                    }
                    if cell == WALL {
                        break;
                    }
                    yi -= 1;
                }
            }
        }
        self.overflow += 1;
    }

    // --- Frame --------------------------------------------------------------

    fn erase_streaks(&mut self) {
        let mut streaks = std::mem::take(&mut self.streak_pixels);
        let width = self.width;
        for &idx in streaks.iter() {
            let idx = idx as usize;
            // Streaks were only ever painted over empty cells; a cell that has
            // since gained sand already repainted itself through set_cell.
            if self.cells[idx] == EMPTY {
                let y = idx as i32 / width;
                self.paint(idx, y, 0);
                self.mark_dirty(idx as i32 - y * width, y);
            }
        }
        streaks.clear();
        self.streak_pixels = streaks;
    }

    fn paint_streaks(&mut self) {
        let flying = std::mem::take(&mut self.flying);
        let (width, height) = (self.width, self.height);
        for grain in flying.iter() {
            let dx = grain.x - grain.px;
            let dy = grain.y - grain.py;
            let steps = (dx.abs().max(dy.abs()).ceil() as i32).max(1);
            let colour = self.palette[grain.material as usize * 3];
            for s in 0..=steps {
                let t = s as f32 / steps as f32;
                let xi = (grain.px + dx * t) as i32;
                let yi = (grain.py + dy * t) as i32;
                if xi >= 0 && xi < width && yi >= 0 && yi < height {
                    let idx = (yi * width + xi) as usize;
                    if self.cells[idx] == EMPTY {
                        self.pixels[idx] = colour;
                        self.streak_pixels.push(idx as u32);
                        self.mark_dirty(xi, yi);
                    }
                }
            }
        }
        self.flying = flying;
    }

    fn step_flying(&mut self) {
        let mut flying = std::mem::take(&mut self.flying);
        let mut keep = 0usize;
        for i in 0..flying.len() {
            let mut grain = flying[i];
            grain.px = grain.x;
            grain.py = grain.y;
            grain.vy += GRAVITY;
            grain.x += grain.vx;
            grain.y += grain.vy;
            grain.ttl -= 1;
            if grain.ttl <= 0 {
                self.settle(grain.x, grain.y, grain.material, grain.lane as usize);
            } else {
                flying[keep] = grain;
                keep += 1;
            }
        }
        flying.truncate(keep);
        self.flying = flying;
    }

    /// One automaton tick over the ACTIVE rows only. Rows are walked bottom-up
    /// so a grain that falls lands in a row already processed and cannot move
    /// twice in a frame; a move wakes its neighbourhood for the next step, so
    /// activity chases itself and a scene at rest costs nothing.
    fn step_cells(&mut self) {
        let (width, height) = (self.width, self.height);
        let mut moves = 0u32;
        for y in (0..height - 1).rev() {
            if self.row_active[y as usize] == 0 {
                continue;
            }
            let row = (y * width) as usize;
            let below = row + width as usize;
            let left_first = self.coin();
            for i in 0..width {
                let x = if left_first { i } else { width - 1 - i };
                let idx = row + x as usize;
                let material = self.cells[idx];
                if material <= WALL {
                    continue;
                }

                if self.cells[below + x as usize] == EMPTY {
                    self.set_cell(idx, y, EMPTY);
                    self.set_cell(below + x as usize, y + 1, material);
                    self.wake(y);
                    self.wake(y + 1);
                    moves += 1;
                    continue;
                }
                let dir = if self.coin() { 1 } else { -1 };
                let a = x + dir;
                let b = x - dir;
                if a >= 0 && a < width && self.cells[below + a as usize] == EMPTY {
                    self.set_cell(idx, y, EMPTY);
                    self.set_cell(below + a as usize, y + 1, material);
                    self.wake(y);
                    self.wake(y + 1);
                    moves += 1;
                } else if b >= 0 && b < width && self.cells[below + b as usize] == EMPTY {
                    self.set_cell(idx, y, EMPTY);
                    self.set_cell(below + b as usize, y + 1, material);
                    self.wake(y);
                    self.wake(y + 1);
                    moves += 1;
                }
            }
        }
        self.moves_last_step = moves;
    }

    /// Re-hash the Active lane's speckle: running work shimmers, terminal sand
    /// lies still. Cheap by construction -- the Active pile is bounded by its
    /// own peak, which the job data keeps small relative to the terminal piles.
    fn shimmer(&mut self, tick: u32) {
        let phase = i64::from(tick >> 3);
        if phase == self.last_shimmer_phase {
            return;
        }
        self.last_shimmer_phase = phase;
        for lane in 0..self.lanes.len() {
            let geom = self.lanes[lane];
            if geom.material != SAND_ACTIVE {
                continue;
            }
            let top = self.top_y[lane];
            if top >= self.ground_y {
                continue;
            }
            for y in top..self.ground_y {
                let row = (y * self.width) as usize;
                for x in geom.x0..=geom.x1 {
                    let idx = row + x as usize;
                    if self.cells[idx] == SAND_ACTIVE {
                        self.paint(idx, y, phase);
                    }
                }
            }
            self.mark_dirty(geom.x0, top);
            self.mark_dirty(geom.x1, self.ground_y - 1);
        }
    }

    /// One frame: physics plus every incremental pixel update it implies.
    pub fn step(&mut self, tick: u32) {
        self.erase_streaks();
        // Swap activity buffers: what last frame woke is what this frame runs.
        std::mem::swap(&mut self.row_active, &mut self.row_next);
        self.row_next.fill(0);

        self.step_flying();
        self.step_cells();
        self.paint_streaks();
        self.shimmer(tick);
    }

    pub fn clear_sand(&mut self) {
        let width = self.width;
        for i in 0..self.cells.len() {
            if self.cells[i] > WALL {
                let y = i as i32 / width;
                self.set_cell(i, y, EMPTY);
            }
        }
        self.flying.clear();
        self.streak_pixels.clear();
        self.overflow = 0;
        self.row_next.fill(0);
        self.row_active.fill(0);
        for lane in 0..self.lanes.len() {
            self.settled[lane] = 0;
            self.top_y[lane] = self.ground_y;
        }
    }
}

/// JavaScript's `Math.round`: halves go up, not away from zero. The distinction
/// only bites for negative coordinates, which `settle` can see when a flier
/// drifts off the left edge of the world.
#[inline]
fn round_half_up(v: f32) -> i32 {
    (v + 0.5).floor() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lanes() -> Vec<LaneInput> {
        vec![
            LaneInput { material: SAND_PLACED, peak_grains: 4_000 },
            LaneInput { material: SAND_ACTIVE, peak_grains: 900 },
            LaneInput { material: SAND_COMPLETED, peak_grains: 12_000 },
            LaneInput { material: SAND_REMOVED, peak_grains: 2_500 },
        ]
    }

    fn engine() -> PileEngine {
        PileEngine::new(&lanes(), 12345)
    }

    /// Grains of a given material actually present in the cell array.
    fn count_material(e: &PileEngine, material: u8) -> i64 {
        e.cells().iter().filter(|&&c| c == material).count() as i64
    }

    #[test]
    fn geometry_is_sized_from_the_peaks() {
        let e = engine();
        assert!(e.width() > 0 && e.height() > 0);
        assert_eq!(e.ground_y(), e.height() - 4);
        // Lanes are ordered left to right and never overlap.
        let ls = e.lanes();
        assert_eq!(ls.len(), 4);
        for pair in ls.windows(2) {
            assert!(pair[0].x1 < pair[1].x0);
        }
        // The tallest lane's cone must fit under the sky.
        assert!(e.height() > (12_000f64).sqrt().ceil() as i32);
        // Pixel buffer covers the world exactly.
        assert_eq!(e.pixels().len(), (e.width() * e.height()) as usize);
    }

    #[test]
    fn stamping_n_grains_yields_settled_n() {
        let mut e = engine();
        e.stamp(0, 1_500, SAND_PLACED);
        assert_eq!(e.settled_in(0), 1_500);
        assert_eq!(count_material(&e, SAND_PLACED), 1_500);
        assert_eq!(e.overflow(), 0);
    }

    #[test]
    fn stamping_every_lane_at_its_peak_never_overflows() {
        let mut e = engine();
        for (i, lane) in lanes().iter().enumerate() {
            e.stamp(i, lane.peak_grains, lane.material);
            assert_eq!(e.settled_in(i), i64::from(lane.peak_grains), "lane {i}");
        }
        assert_eq!(e.overflow(), 0);
    }

    #[test]
    fn a_stamped_cone_is_stable() {
        let mut e = engine();
        e.stamp(2, 8_000, SAND_COMPLETED);
        // The stamp wakes its rows, so a few steps of relaxation are expected;
        // after that the pile must be completely at rest.
        for tick in 0..400 {
            e.step(tick);
        }
        assert_eq!(e.moves_last_step(), 0, "stable scene still moving");
        assert_eq!(e.in_flight(), 0);
        assert_eq!(e.settled_in(2), 8_000, "relaxation must conserve grains");
        assert_eq!(count_material(&e, SAND_COMPLETED), 8_000);
        // Nothing changed, so nothing is dirty.
        e.consume_dirty();
        e.step(401);
        assert_eq!(e.consume_dirty(), None, "at-rest frame reported dirty pixels");
    }

    #[test]
    fn remove_shaves_from_the_top() {
        let mut e = engine();
        e.stamp(0, 2_000, SAND_PLACED);
        for tick in 0..200 {
            e.step(tick);
        }
        let summit_before = summit_row(&e, 0);
        let taken = e.remove(0, 500);
        assert_eq!(taken, 500);
        assert_eq!(e.settled_in(0), 1_500);
        assert_eq!(count_material(&e, SAND_PLACED), 1_500);
        let summit_after = summit_row(&e, 0);
        assert!(
            summit_after > summit_before,
            "summit {summit_before} -> {summit_after}: pile did not shrink from the top",
        );
    }

    fn summit_row(e: &PileEngine, lane: usize) -> i32 {
        let geom = e.lanes()[lane];
        for y in 0..e.ground_y() {
            let row = (y * e.width()) as usize;
            for x in geom.x0..=geom.x1 {
                if e.cells()[row + x as usize] > WALL {
                    return y;
                }
            }
        }
        e.ground_y()
    }

    #[test]
    fn remove_is_short_when_the_pile_runs_dry() {
        let mut e = engine();
        e.stamp(1, 100, SAND_ACTIVE);
        let taken = e.remove(1, 250);
        assert_eq!(taken, 100, "remove invented grains that were not there");
        assert_eq!(e.settled_in(1), 0);
        assert_eq!(e.remove(1, 10), 0);
    }

    #[test]
    fn a_dropped_grain_settles() {
        let mut e = engine();
        e.drop_grains(3, 40, SAND_REMOVED);
        assert_eq!(e.in_flight(), 40);
        assert_eq!(e.settled_in(3), 0, "fliers must not count as settled");
        let mut tick = 0;
        while e.in_flight() > 0 && tick < 1_000 {
            e.step(tick);
            tick += 1;
        }
        assert_eq!(e.in_flight(), 0, "grains never landed");
        assert_eq!(e.settled_in(3), 40);
        // And they come to rest on the ground, in their own lane.
        while e.moves_last_step() > 0 && tick < 3_000 {
            e.step(tick);
            tick += 1;
        }
        assert_eq!(e.moves_last_step(), 0);
        assert_eq!(count_material(&e, SAND_REMOVED), 40);
        let geom = e.lanes()[3];
        for (i, &c) in e.cells().iter().enumerate() {
            if c == SAND_REMOVED {
                let x = i as i32 % e.width();
                assert!(x >= geom.x0 && x <= geom.x1, "grain escaped its lane at x={x}");
            }
        }
        assert_eq!(e.overflow(), 0);
    }

    #[test]
    fn transition_conserves_grains_across_lanes() {
        // The invariant that makes this a visualization: a grain vanishes from
        // the source summit and reappears in the destination pile. Total grains
        // settled + in flight must not change.
        let mut e = engine();
        e.stamp(0, 1_000, SAND_PLACED);
        let total = |e: &PileEngine| {
            (0..4).map(|l| e.settled_in(l)).sum::<i64>() + i64::from(e.in_flight())
        };
        assert_eq!(total(&e), 1_000);
        let taken = e.remove(0, 300);
        e.drop_grains(1, taken, SAND_ACTIVE);
        assert_eq!(total(&e), 1_000, "grains lost in transit");
        let mut tick = 0;
        while (e.in_flight() > 0 || e.moves_last_step() > 0) && tick < 3_000 {
            e.step(tick);
            tick += 1;
        }
        assert_eq!(total(&e), 1_000);
        assert_eq!(e.settled_in(0), 700);
        assert_eq!(e.settled_in(1), 300);
        assert_eq!(count_material(&e, SAND_PLACED), 700);
        assert_eq!(count_material(&e, SAND_ACTIVE), 300);
        assert_eq!(e.overflow(), 0);
    }

    #[test]
    fn clear_sand_resets_everything_but_the_walls() {
        let mut e = engine();
        let walls = count_material(&e, WALL);
        e.stamp(0, 500, SAND_PLACED);
        e.drop_grains(2, 20, SAND_COMPLETED);
        e.step(0);
        e.clear_sand();
        assert_eq!(e.in_flight(), 0);
        assert_eq!(e.overflow(), 0);
        for lane in 0..4 {
            assert_eq!(e.settled_in(lane), 0);
        }
        for material in [SAND_PLACED, SAND_ACTIVE, SAND_COMPLETED, SAND_REMOVED] {
            assert_eq!(count_material(&e, material), 0);
        }
        assert_eq!(count_material(&e, WALL), walls, "clear_sand ate the walls");
        e.step(1);
        assert_eq!(e.moves_last_step(), 0);
    }

    #[test]
    fn dirty_rect_covers_the_cells_that_changed() {
        let mut e = engine();
        e.consume_dirty(); // discard the constructor's full-world rect
        e.stamp(2, 300, SAND_COMPLETED);
        let rect = e.consume_dirty().expect("stamp reported no dirty pixels");
        let geom = e.lanes()[2];
        // Every changed cell must lie inside the reported rectangle.
        for (i, &c) in e.cells().iter().enumerate() {
            if c == SAND_COMPLETED {
                let x = i as i32 % e.width();
                let y = i as i32 / e.width();
                assert!(x >= rect.x as i32 && x < (rect.x + rect.w) as i32);
                assert!(y >= rect.y as i32 && y < (rect.y + rect.h) as i32);
            }
        }
        assert!(rect.x as i32 >= geom.x0);
        assert_eq!(e.consume_dirty(), None, "dirty rect was not consumed");
    }

    #[test]
    fn pixels_track_cell_materials() {
        let mut e = engine();
        e.stamp(0, 400, SAND_PLACED);
        let placed_shades: Vec<u32> =
            SHADES[SAND_PLACED as usize].iter().map(|&c| to_abgr(c)).collect();
        let mut checked = 0;
        for (i, &c) in e.cells().iter().enumerate() {
            if c == SAND_PLACED {
                assert!(
                    placed_shades.contains(&e.pixels()[i]),
                    "cell {i} is sand but its pixel is not a sand shade",
                );
                checked += 1;
            }
        }
        assert_eq!(checked, 400);
    }

    #[test]
    fn a_long_mixed_run_stays_conserved_and_overflow_free() {
        // Miniature of the real playback loop: pour into placed, shave off the
        // summit into active, then out to the terminal lanes.
        let mut e = engine();
        e.stamp(0, 600, SAND_PLACED);
        let mut in_lane = [600i64, 0, 0, 0];
        for tick in 0..1_500u32 {
            if tick % 5 == 0 {
                e.drop_grains(0, 3, SAND_PLACED);
                in_lane[0] += 3;
            }
            if tick % 7 == 0 {
                let n = e.remove(0, 4);
                in_lane[0] -= i64::from(n);
                e.drop_grains(1, n, SAND_ACTIVE);
                in_lane[1] += i64::from(n);
            }
            if tick % 11 == 0 {
                let n = e.remove(1, 3);
                in_lane[1] -= i64::from(n);
                e.drop_grains(2, n, SAND_COMPLETED);
                in_lane[2] += i64::from(n);
            }
            if tick % 23 == 0 {
                let n = e.remove(1, 1);
                in_lane[1] -= i64::from(n);
                e.drop_grains(3, n, SAND_REMOVED);
                in_lane[3] += i64::from(n);
            }
            e.step(tick);
        }
        let mut tick = 1_500u32;
        while (e.in_flight() > 0 || e.moves_last_step() > 0) && tick < 6_000 {
            e.step(tick);
            tick += 1;
        }
        assert_eq!(e.in_flight(), 0);
        assert_eq!(e.moves_last_step(), 0);
        assert_eq!(e.overflow(), 0, "grains had nowhere to land");
        for (lane, &expected) in in_lane.iter().enumerate() {
            assert_eq!(
                e.settled_in(lane),
                expected,
                "lane {lane}: settled grains drifted from the bookkeeping",
            );
        }
        let materials = [SAND_PLACED, SAND_ACTIVE, SAND_COMPLETED, SAND_REMOVED];
        for (&material, &expected) in materials.iter().zip(in_lane.iter()) {
            assert_eq!(count_material(&e, material), expected);
        }
    }

    #[test]
    fn runs_are_reproducible_for_a_given_seed() {
        let run = |seed: u32| {
            let mut e = PileEngine::new(&lanes(), seed);
            e.drop_grains(0, 200, SAND_PLACED);
            for tick in 0..300 {
                e.step(tick);
            }
            e.cells().to_vec()
        };
        assert_eq!(run(7), run(7));
        assert_ne!(run(7), run(8), "seed had no effect on the jitter");
    }
}
