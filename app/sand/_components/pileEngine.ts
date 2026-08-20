/**
 * Four free-standing sand piles, one per job state, on a shared ground line.
 * One grain is one job -- no binning.
 *
 * The contract that makes this a visualization rather than a toy: a pile's grain
 * count IS the state's census at the current playback instant. Grains enter a
 * pile by falling from the sky above its lane; they leave by vanishing off the
 * summit. A state transition is therefore exactly what it looks like -- the
 * grain disappears from the old pile and drops into the new one.
 *
 * Performance model (visually identical to the naive full-pass version):
 *
 *   1. DIRTY-ROW AUTOMATON. Settled sand costs nothing: only rows flagged by
 *      last frame's activity are stepped, and a move re-flags its neighbouring
 *      rows. A scene at rest performs zero cell work.
 *   2. INCREMENTAL PIXELS. The engine owns the world's pixel buffer and writes
 *      a cell's colour only when that cell changes, accumulating a dirty
 *      rectangle the caller uploads with one putImageData. Fliers are drawn as
 *      erase-and-repaint streaks; the Active shimmer explicitly repaints its
 *      (small) lane box each frame.
 *
 * The world is sized from the timeline's PEAK census per state, known before
 * playback starts -- every lane is wide enough for its biggest day, so nothing
 * can ever overflow and the pile-equals-census contract holds for the whole run.
 */

export const EMPTY = 0;
export const WALL = 1;
export const SAND_PLACED = 2;
export const SAND_ACTIVE = 3;
export const SAND_COMPLETED = 4;
export const SAND_REMOVED = 5;

export type SandMaterial =
  | typeof SAND_PLACED
  | typeof SAND_ACTIVE
  | typeof SAND_COMPLETED
  | typeof SAND_REMOVED;

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

interface FlyingGrain {
  x: number;
  y: number;
  /** Position last frame, so the streak render joins the two. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  material: SandMaterial;
  ttl: number;
  lane: string;
}

/** Sky reserved above the tallest possible pile, so drops have room to fall. */
const HEADROOM = 110;
const GROUND_THICKNESS = 4;
/** Gap each side of a lane's peak cone, so a slightly ragged base still fits. */
const LANE_MARGIN = 12;
/** A lane that never holds sand still gets a visible territory. */
const MIN_HALF_WIDTH = 26;
/** Divider wall between lanes, in cells. */
const DIVIDER = 2;

const MATERIAL_SHADES: Record<number, string[]> = {
  [WALL]: ["#c9c4b8", "#c2bdb1", "#d0cbbf"],
  [SAND_PLACED]: ["#eda100", "#d9930a", "#f7b02a"],
  [SAND_ACTIVE]: ["#3b5bdb", "#3450c4", "#5470e6"],
  [SAND_COMPLETED]: ["#2a9d8f", "#248b7f", "#37b3a3"],
  [SAND_REMOVED]: ["#ae2012", "#991c10", "#c62d1d"],
};

/** 0xAABBGGRR for direct writes through a Uint32Array view of the pixel buffer. */
function toAbgr(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0xff << 24) | ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff);
}

export class PileEngine {
  readonly width: number;
  readonly height: number;
  readonly lanes: LaneGeometry[];
  /** Top row of the ground slab. */
  readonly groundY: number;
  readonly cells: Uint8Array;
  /**
   * The world's pixels, engine-maintained: a cell's colour is written when the
   * cell changes, never in a bulk pass. Wrap `pixelBytes` in an ImageData that
   * shares this memory and upload consumeDirty()'s rectangle each frame.
   */
  readonly pixels32: Uint32Array;
  readonly pixelBytes: Uint8ClampedArray<ArrayBuffer>;

  /** Automaton cell moves in the most recent step; 0 = every pile is at rest. */
  movesLastStep = 0;
  /** Grains that had nowhere to land; should stay 0 by construction. */
  overflow = 0;

  private readonly laneById = new Map<string, LaneGeometry>();
  private readonly palette: Uint32Array;
  private readonly gravity = 0.3;
  private readonly bgRows: Uint32Array;
  private flying: FlyingGrain[] = [];
  private settled = new Map<string, number>();
  /**
   * Highest (smallest y) cell each lane has ever settled since the last clear.
   * Only ever moved up, so it is always at or above the true summit -- a safe,
   * cheap starting row for the summit scan in remove().
   */
  private topY = new Map<string, number>();

  /** Rows the automaton must process this step / next step. */
  private rowActive: Uint8Array;
  private rowNext: Uint8Array;

  /** Pixel indices holding a flier streak, to erase before the next frame. */
  private streakPixels: number[] = [];

  /** Accumulated dirty pixel rectangle since the last consumeDirty(). */
  private dx0 = 0;
  private dy0 = 0;
  private dx1 = 0;
  private dy1 = 0;
  private dirtyAny = false;

  constructor(laneInputs: LaneInput[]) {
    // --- Geometry from the peaks -------------------------------------------
    // A cone at 45-degree repose holding N grains is ~sqrt(N) tall on a base of
    // ~2*sqrt(N); the lane is that base plus margin.
    let tallest = 0;
    let cursor = DIVIDER;
    const lanes: LaneGeometry[] = [];
    for (const input of laneInputs) {
      const coneHeight = Math.ceil(Math.sqrt(Math.max(0, input.peakGrains)));
      tallest = Math.max(tallest, coneHeight);
      const half = Math.max(coneHeight + LANE_MARGIN, MIN_HALF_WIDTH);
      lanes.push({ ...input, x0: cursor, x1: cursor + half * 2 });
      cursor += half * 2 + 1 + DIVIDER;
    }
    this.width = cursor;
    this.height = tallest + HEADROOM + GROUND_THICKNESS;
    this.groundY = this.height - GROUND_THICKNESS;
    this.lanes = lanes;
    for (const lane of lanes) this.laneById.set(lane.id, lane);

    this.cells = new Uint8Array(this.width * this.height);
    this.rowActive = new Uint8Array(this.height);
    this.rowNext = new Uint8Array(this.height);

    this.palette = new Uint32Array(6 * 3);
    for (const [material, shades] of Object.entries(MATERIAL_SHADES)) {
      shades.forEach((hex, i) => {
        this.palette[Number(material) * 3 + i] = toAbgr(hex);
      });
    }

    // Subtle vertical gradient so the scene reads as a lit space rather than a void.
    this.bgRows = new Uint32Array(this.height);
    const top = { r: 0xfa, g: 0xf9, b: 0xf6 };
    const bottom = { r: 0xe8, g: 0xe5, b: 0xdc };
    for (let y = 0; y < this.height; y++) {
      const t = y / Math.max(1, this.height - 1);
      this.bgRows[y] =
        (0xff << 24) |
        (Math.round(top.b + (bottom.b - top.b) * t) << 16) |
        (Math.round(top.g + (bottom.g - top.g) * t) << 8) |
        Math.round(top.r + (bottom.r - top.r) * t);
    }

    this.buildWalls(tallest);

    for (const lane of lanes) {
      this.settled.set(lane.id, 0);
      this.topY.set(lane.id, this.groundY);
    }

    // Paint the whole initial world once; everything after is incremental.
    const buffer = new ArrayBuffer(this.width * this.height * 4);
    this.pixels32 = new Uint32Array(buffer);
    this.pixelBytes = new Uint8ClampedArray(buffer);
    for (let y = 0; y < this.height; y++) {
      const row = y * this.width;
      for (let x = 0; x < this.width; x++) this.paint(row + x, y);
    }
    this.markDirty(0, 0);
    this.markDirty(this.width - 1, this.height - 1);
  }

  private buildWalls(tallest: number): void {
    const { cells, width } = this;
    for (let y = this.groundY; y < this.height; y++) {
      for (let x = 0; x < width; x++) cells[y * width + x] = WALL;
    }
    const dividerTop = Math.max(0, this.groundY - tallest - 14);
    const putColumn = (x: number) => {
      if (x < 0 || x >= width) return;
      for (let y = dividerTop; y < this.groundY; y++) cells[y * width + x] = WALL;
    };
    for (const lane of this.lanes) {
      for (let t = 1; t <= DIVIDER; t++) {
        putColumn(lane.x0 - t);
        putColumn(lane.x1 + t);
      }
    }
  }

  // --- Incremental pixels ---------------------------------------------------

  /** The colour a cell should show, from its material and a stable per-cell hash. */
  private colourOf(idx: number, y: number, phase = 0): number {
    const material = this.cells[idx];
    if (material === EMPTY) return this.bgRows[y];
    const seed = material === SAND_ACTIVE ? idx + phase * 7349 : idx;
    const variant = (Math.imul(seed, 2654435761) >>> 0) % 3;
    return this.palette[material * 3 + variant];
  }

  private paint(idx: number, y: number, phase = 0): void {
    this.pixels32[idx] = this.colourOf(idx, y, phase);
  }

  private markDirty(x: number, y: number): void {
    if (!this.dirtyAny) {
      this.dirtyAny = true;
      this.dx0 = x;
      this.dx1 = x;
      this.dy0 = y;
      this.dy1 = y;
      return;
    }
    if (x < this.dx0) this.dx0 = x;
    if (x > this.dx1) this.dx1 = x;
    if (y < this.dy0) this.dy0 = y;
    if (y > this.dy1) this.dy1 = y;
  }

  /** The pixel rectangle touched since the last call, or null if nothing was. */
  consumeDirty(): DirtyRect | null {
    if (!this.dirtyAny) return null;
    const rect = {
      x: this.dx0,
      y: this.dy0,
      w: this.dx1 - this.dx0 + 1,
      h: this.dy1 - this.dy0 + 1,
    };
    this.dirtyAny = false;
    return rect;
  }

  /** Every cell mutation funnels through these two, keeping pixels in lockstep. */
  private setCell(idx: number, y: number, material: number): void {
    this.cells[idx] = material;
    this.paint(idx, y);
    this.markDirty(idx - y * this.width, y);
  }

  /** Wake the automaton around a row: it and both neighbours run next step. */
  private wake(y: number): void {
    if (y > 0) this.rowNext[y - 1] = 1;
    this.rowNext[y] = 1;
    if (y + 1 < this.height) this.rowNext[y + 1] = 1;
  }

  // --- Sand operations --------------------------------------------------------

  lane(id: string): LaneGeometry {
    const found = this.laneById.get(id);
    if (!found) throw new Error(`Unknown lane "${id}"`);
    return found;
  }

  /** Settled grains currently in a lane (excludes grains still falling toward it). */
  settledIn(id: string): number {
    return this.settled.get(id) ?? 0;
  }

  /**
   * Vanish grains off a pile's summit. Scanning rows top-down from the tracked
   * summit means the highest sand goes first, so the pile visibly shrinks from
   * the top. Returns how many were actually removed; short when the pile has run
   * dry (e.g. the matching grains are still mid-air), which the caller carries
   * as a debt to the next frame.
   */
  remove(laneId: string, count: number): number {
    if (count <= 0) return 0;
    const lane = this.lane(laneId);
    const { cells, width } = this;
    let removed = 0;
    for (let y = this.topY.get(laneId) ?? 0; y < this.groundY && removed < count; y++) {
      const row = y * width;
      const leftFirst = (y & 1) === 0;
      let touched = false;
      for (let i = 0; i <= lane.x1 - lane.x0 && removed < count; i++) {
        const x = leftFirst ? lane.x0 + i : lane.x1 - i;
        const idx = row + x;
        if (cells[idx] > WALL) {
          this.setCell(idx, y, EMPTY);
          removed++;
          touched = true;
        }
      }
      if (touched) this.wake(y);
    }
    this.settled.set(laneId, (this.settled.get(laneId) ?? 0) - removed);
    return removed;
  }

  /**
   * Drop grains from the sky into a lane: how transitions arrive, and how newly
   * placed work arrives. Spawn height rides just above the current summit so the
   * fall is quick but always visible.
   */
  drop(laneId: string, count: number, material: SandMaterial): void {
    if (count <= 0) return;
    const lane = this.lane(laneId);
    const cx = (lane.x0 + lane.x1) / 2;
    const summit = this.topY.get(laneId) ?? this.groundY;
    const spawnY = Math.max(2, summit - 90);
    for (let i = 0; i < count; i++) {
      const x = cx + (Math.random() - 0.5) * (lane.x1 - lane.x0) * 0.3;
      const dy = Math.max(4, summit - 2 - spawnY);
      const ttl = Math.max(4, Math.round(Math.sqrt((2 * dy) / this.gravity)));
      this.flying.push({
        x,
        y: spawnY,
        px: x,
        py: spawnY,
        vx: (Math.random() - 0.5) * 0.15,
        vy: 0,
        material,
        ttl,
        lane: laneId,
      });
    }
  }

  /**
   * Lay `count` grains down as an already-settled cone: the instant-seek path.
   * Rows go floor-up, each one two cells narrower -- the automaton's own stable
   * shape; anything slightly off relaxes with a brief avalanche.
   */
  stamp(laneId: string, count: number, material: SandMaterial): void {
    if (count <= 0) return;
    const lane = this.lane(laneId);
    const cx = (lane.x0 + lane.x1) / 2;
    const halfMax = (lane.x1 - lane.x0) / 2;
    let remaining = count;
    let placed = 0;

    for (let level = 0; remaining > 0; level++) {
      const y = this.groundY - 1 - level;
      if (y < 0) break;
      const half = Math.min(halfMax, Math.ceil(Math.sqrt(count)) - level);
      if (half < 0.5) break;
      const x0 = Math.max(lane.x0, Math.ceil(cx - half));
      const x1 = Math.min(lane.x1, Math.floor(cx + half));
      const rowWidth = x1 - x0 + 1;
      if (rowWidth <= 0) break;

      const n = Math.min(remaining, rowWidth);
      const start = Math.max(x0, Math.min(x1 - n + 1, Math.round(cx - n / 2)));
      const row = y * this.width;
      for (let k = 0; k < n; k++) {
        const idx = row + start + k;
        if (this.cells[idx] === EMPTY) {
          this.setCell(idx, y, material);
          placed++;
        }
      }
      remaining -= n;
      this.wake(y);
      this.topY.set(laneId, Math.min(this.topY.get(laneId) ?? this.groundY, y));
    }
    this.settled.set(laneId, (this.settled.get(laneId) ?? 0) + placed);
    if (remaining > 0) this.overflow += remaining;
  }

  /**
   * Land an arriving grain: first free cell at or above the impact point,
   * spreading a few columns if that one is packed. A grain that "settles" in
   * open air is fine -- it becomes an automaton grain and keeps falling.
   */
  private settle(x: number, y: number, material: SandMaterial, laneId: string): void {
    const lane = this.lane(laneId);
    const startX = Math.max(lane.x0, Math.min(lane.x1, Math.round(x)));
    const startY = Math.max(0, Math.min(this.groundY - 1, Math.round(y)));

    for (let dx = 0; dx <= 8; dx++) {
      const columns = dx === 0 ? [startX] : [startX - dx, startX + dx];
      for (const cx of columns) {
        if (cx < lane.x0 || cx > lane.x1) continue;
        for (let yi = startY; yi >= 0; yi--) {
          const idx = yi * this.width + cx;
          const cell = this.cells[idx];
          if (cell === EMPTY) {
            this.setCell(idx, yi, material);
            this.wake(yi);
            this.settled.set(laneId, (this.settled.get(laneId) ?? 0) + 1);
            if (yi < (this.topY.get(laneId) ?? this.groundY)) this.topY.set(laneId, yi);
            return;
          }
          if (cell === WALL) break;
        }
      }
    }
    this.overflow++;
  }

  // --- Frame ------------------------------------------------------------------

  private eraseStreaks(): void {
    const { cells, width } = this;
    for (const idx of this.streakPixels) {
      // Streaks were only ever painted over empty cells; a cell that has since
      // gained sand already repainted itself through setCell.
      if (cells[idx] === EMPTY) {
        const y = (idx / width) | 0;
        this.paint(idx, y);
        this.markDirty(idx - y * width, y);
      }
    }
    this.streakPixels.length = 0;
  }

  private paintStreaks(): void {
    const { cells, width, height, palette } = this;
    for (const grain of this.flying) {
      const dx = grain.x - grain.px;
      const dy = grain.y - grain.py;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      const colour = palette[grain.material * 3];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const xi = (grain.px + dx * t) | 0;
        const yi = (grain.py + dy * t) | 0;
        if (xi >= 0 && xi < width && yi >= 0 && yi < height) {
          const idx = yi * width + xi;
          if (cells[idx] === EMPTY) {
            this.pixels32[idx] = colour;
            this.streakPixels.push(idx);
            this.markDirty(xi, yi);
          }
        }
      }
    }
  }

  private stepFlying(): void {
    const next: FlyingGrain[] = [];
    for (const grain of this.flying) {
      grain.px = grain.x;
      grain.py = grain.y;
      grain.vy += this.gravity;
      grain.x += grain.vx;
      grain.y += grain.vy;
      grain.ttl--;
      if (grain.ttl <= 0) {
        this.settle(grain.x, grain.y, grain.material, grain.lane);
      } else {
        next.push(grain);
      }
    }
    this.flying = next;
  }

  /**
   * One automaton tick over the ACTIVE rows only. Rows are walked bottom-up so a
   * grain that falls lands in a row already processed and cannot move twice in a
   * frame; a move wakes its neighbourhood for the next step, so activity chases
   * itself and a scene at rest costs nothing.
   */
  private stepCells(): void {
    const { cells, width, height, rowActive } = this;
    let moves = 0;
    for (let y = height - 2; y >= 0; y--) {
      if (!rowActive[y]) continue;
      const row = y * width;
      const below = row + width;
      const leftFirst = Math.random() < 0.5;
      for (let i = 0; i < width; i++) {
        const x = leftFirst ? i : width - 1 - i;
        const idx = row + x;
        const material = cells[idx];
        if (material <= WALL) continue;

        if (cells[below + x] === EMPTY) {
          this.setCell(idx, y, EMPTY);
          this.setCell(below + x, y + 1, material);
          this.wake(y);
          this.wake(y + 1);
          moves++;
          continue;
        }
        const dir = Math.random() < 0.5 ? 1 : -1;
        const a = x + dir;
        const b = x - dir;
        if (a >= 0 && a < width && cells[below + a] === EMPTY) {
          this.setCell(idx, y, EMPTY);
          this.setCell(below + a, y + 1, material);
          this.wake(y);
          this.wake(y + 1);
          moves++;
        } else if (b >= 0 && b < width && cells[below + b] === EMPTY) {
          this.setCell(idx, y, EMPTY);
          this.setCell(below + b, y + 1, material);
          this.wake(y);
          this.wake(y + 1);
          moves++;
        }
      }
    }
    this.movesLastStep = moves;
  }

  /**
   * Re-hash the Active lane's speckle: running work shimmers, terminal sand lies
   * still. Cheap by construction -- the Active pile is bounded by its own peak,
   * which the job data keeps small relative to the terminal piles.
   */
  private shimmer(tick: number): void {
    const phase = tick >> 3;
    if (phase === this.lastShimmerPhase) return;
    this.lastShimmerPhase = phase;
    for (const lane of this.lanes) {
      if (lane.material !== SAND_ACTIVE) continue;
      const top = this.topY.get(lane.id) ?? this.groundY;
      if (top >= this.groundY) continue;
      for (let y = top; y < this.groundY; y++) {
        const row = y * this.width;
        for (let x = lane.x0; x <= lane.x1; x++) {
          const idx = row + x;
          if (this.cells[idx] === SAND_ACTIVE) this.paint(idx, y, phase);
        }
      }
      this.markDirty(lane.x0, top);
      this.markDirty(lane.x1, this.groundY - 1);
    }
  }
  private lastShimmerPhase = -1;

  /** One frame: physics plus every incremental pixel update it implies. */
  step(tick = 0): void {
    this.eraseStreaks();
    // Swap activity buffers: what last frame woke is what this frame runs.
    const active = this.rowNext;
    this.rowNext = this.rowActive;
    this.rowNext.fill(0);
    this.rowActive = active;

    this.stepFlying();
    this.stepCells();
    this.paintStreaks();
    this.shimmer(tick);
  }

  get inFlight(): number {
    return this.flying.length;
  }

  clearSand(): void {
    const { cells, width } = this;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] > WALL) {
        const y = (i / width) | 0;
        this.setCell(i, y, EMPTY);
      }
    }
    this.flying = [];
    this.streakPixels.length = 0;
    this.overflow = 0;
    this.rowNext.fill(0);
    this.rowActive.fill(0);
    for (const lane of this.lanes) {
      this.settled.set(lane.id, 0);
      this.topY.set(lane.id, this.groundY);
    }
  }
}
