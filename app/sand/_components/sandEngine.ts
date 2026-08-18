/**
 * Falling-sand simulation where one grain stands for a fixed number of HTCondor jobs.
 *
 * Two cooperating layers:
 *
 *   1. A cellular automaton for settled sand. Every cell is one byte in a flat
 *      Uint8Array; each step walks the grid bottom-up and lets a grain fall down,
 *      then diagonally. That is what produces piling, the angle of repose, and the
 *      collapse of a heap when it drains from underneath. It is O(cells) with no
 *      allocation, so ~85k cells run comfortably inside a frame budget.
 *
 *   2. A short list of ballistic grains for sand in transit between buckets. These
 *      are floats with velocity, solved to land exactly on the destination inlet,
 *      and they rejoin the automaton on arrival.
 *
 * Rigid-body physics was the alternative and would not survive the job counts here;
 * a CA gives the same read at four orders of magnitude more grains.
 */

export const EMPTY = 0;
export const WALL = 1;
/** Sand materials. Index into MATERIAL_SHADES. */
export const SAND_PLACED = 2;
export const SAND_ACTIVE = 3;
export const SAND_COMPLETED = 4;
export const SAND_REMOVED = 5;

export type SandMaterial =
  | typeof SAND_PLACED
  | typeof SAND_ACTIVE
  | typeof SAND_COMPLETED
  | typeof SAND_REMOVED;

export interface BucketSpec {
  id: string;
  label: string;
  material: SandMaterial;
  /** Interior bounds in cells, inclusive. Walls are drawn just outside these. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /**
   * Height of the side walls, in cells, measured up from the floor. Left undefined
   * the sides run the bucket's full height and sand fills it like a box; a small
   * lip instead lets the sand heap above the shelf into a cone with its natural
   * angle of repose, which is what makes it read as a pile.
   */
  lip?: number;
}

export interface EngineOptions {
  width: number;
  height: number;
  buckets: BucketSpec[];
  /** Cells per second of downward acceleration for in-flight grains. */
  gravity?: number;
}

interface FlyingGrain {
  x: number;
  y: number;
  /** Position last frame, so the render can join the two and avoid strobing. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  material: SandMaterial;
  /** Frames remaining before it settles. */
  ttl: number;
  targetX: number;
  targetY: number;
  /** Destination bucket, for the settled-count bookkeeping behind apex targeting. */
  bucket: string;
}

const WALL_THICKNESS = 4;

/**
 * Three shades per material, picked per-cell from its coordinates. Uniform colour
 * reads as a flat blob at this scale; the variation is what makes a heap look
 * granular. Hues are the validated job-state palette.
 */
const MATERIAL_SHADES: Record<number, string[]> = {
  [WALL]: ["#8e897e", "#847f75", "#989388"],
  [SAND_PLACED]: ["#eda100", "#d9930a", "#f7b02a"],
  [SAND_ACTIVE]: ["#3b5bdb", "#3450c4", "#5470e6"],
  [SAND_COMPLETED]: ["#2a9d8f", "#248b7f", "#37b3a3"],
  [SAND_REMOVED]: ["#ae2012", "#991c10", "#c62d1d"],
};

/** 0xAABBGGRR for direct writes through a Uint32Array view of the pixel buffer. */
function toAbgr(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

export class SandEngine {
  readonly width: number;
  readonly height: number;
  readonly buckets: BucketSpec[];
  readonly cells: Uint8Array;

  private readonly bucketById = new Map<string, BucketSpec>();
  private readonly palette: Uint32Array;
  private readonly gravity: number;
  private readonly bgRows: Uint32Array;
  private flying: FlyingGrain[] = [];
  /** Settled grains per bucket, kept incrementally so apex targeting needs no scan. */
  private settled = new Map<string, number>();

  /** Grains that had nowhere to land because their bucket was full. */
  overflow = 0;

  constructor(options: EngineOptions) {
    this.width = options.width;
    this.height = options.height;
    this.buckets = options.buckets;
    this.gravity = options.gravity ?? 0.22;
    this.cells = new Uint8Array(this.width * this.height);
    for (const bucket of options.buckets) this.bucketById.set(bucket.id, bucket);

    // Flatten the shade table into one lookup indexed by material*3 + variant.
    this.palette = new Uint32Array(6 * 3);
    for (const [material, shades] of Object.entries(MATERIAL_SHADES)) {
      shades.forEach((hex, i) => {
        this.palette[Number(material) * 3 + i] = toAbgr(hex);
      });
    }

    // Subtle vertical gradient so the scene reads as a lit space rather than a void.
    this.bgRows = new Uint32Array(this.height);
    const top = { r: 0xfa, g: 0xf9, b: 0xf6 };
    const bottom = { r: 0xe6, g: 0xe3, b: 0xda };
    for (let y = 0; y < this.height; y++) {
      const t = y / Math.max(1, this.height - 1);
      const r = Math.round(top.r + (bottom.r - top.r) * t);
      const g = Math.round(top.g + (bottom.g - top.g) * t);
      const b = Math.round(top.b + (bottom.b - top.b) * t);
      this.bgRows[y] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }

    this.buildWalls();
  }

  /**
   * A floor slab under each bucket, and side walls only as high as the bucket's
   * `lip` (full height when no lip is given). With a stub lip the sand is free to
   * heap above the shelf into a cone; the lip just stops the base creeping off the
   * terrace edge.
   */
  private buildWalls(): void {
    const { cells, width } = this;
    const put = (x: number, y: number) => {
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) cells[y * width + x] = WALL;
    };
    for (const b of this.buckets) {
      const sideTop = b.lip === undefined ? b.y0 : Math.max(b.y0, b.y1 - b.lip);
      for (let y = sideTop; y <= b.y1 + WALL_THICKNESS; y++) {
        for (let t = 1; t <= WALL_THICKNESS; t++) {
          put(b.x0 - t, y);
          put(b.x1 + t, y);
        }
      }
      for (let x = b.x0 - WALL_THICKNESS; x <= b.x1 + WALL_THICKNESS; x++) {
        for (let t = 1; t <= WALL_THICKNESS; t++) put(x, b.y1 + t);
      }
    }
  }

  /**
   * Where arriving sand should aim: just above the pile's current apex. A cone at
   * this automaton's 45-degree repose holding N grains stands about sqrt(N) tall,
   * so the apex height is derivable from the running count without scanning cells.
   * Targeting it keeps arcs ending on top of the pile — aiming at a fixed inlet
   * either left grains settling in mid-air early on or buried them once the pile
   * had grown past the inlet.
   */
  private inletY(b: BucketSpec): number {
    const pileHeight = Math.sqrt(this.settled.get(b.id) ?? 0);
    return Math.max(b.y0, b.y1 - 2 - Math.round(pileHeight));
  }

  bucket(id: string): BucketSpec {
    const found = this.bucketById.get(id);
    if (!found) throw new Error(`Unknown bucket "${id}"`);
    return found;
  }

  /** Settled grains currently inside a bucket. */
  countIn(id: string): number {
    const b = this.bucket(id);
    let total = 0;
    for (let y = b.y0; y <= b.y1; y++) {
      const row = y * this.width;
      for (let x = b.x0; x <= b.x1; x++) if (this.cells[row + x] > WALL) total++;
    }
    return total;
  }

  /**
   * Launch grains onto a bucket from above, as if poured from a hopper.
   * Used for jobs entering the system rather than moving between states.
   */
  pour(bucketId: string, count: number, material: SandMaterial, fromY = 4): void {
    const b = this.bucket(bucketId);
    const cx = (b.x0 + b.x1) / 2;
    for (let i = 0; i < count; i++) {
      // Narrow spread from a narrow mouth: the cone shape comes from the automaton
      // spreading the base, not from scattering the drops.
      const targetX = cx + (Math.random() - 0.5) * (b.x1 - b.x0) * 0.35;
      this.launch(cx + (Math.random() - 0.5) * 4, fromY, targetX, this.inletY(b), material, b.id);
    }
  }

  /**
   * Take grains out of the bottom of one bucket and throw them at another.
   *
   * Draining from the lowest rows is what makes the heap above slump inward, which
   * is the whole visual point: a bucket empties from underneath, like a real hopper,
   * rather than grains politely vanishing off the top.
   *
   * Returns how many it actually moved, which can be short if the source has run dry.
   */
  transfer(fromId: string, toId: string, count: number, material: SandMaterial): number {
    if (count <= 0) return 0;
    const from = this.bucket(fromId);
    const to = this.bucket(toId);
    const cxTo = (to.x0 + to.x1) / 2;
    let moved = 0;

    for (let y = from.y1; y >= from.y0 && moved < count; y--) {
      const row = y * this.width;
      // Alternate scan direction per row so drainage does not favour one side.
      const leftFirst = (y & 1) === 0;
      for (let i = 0; i <= from.x1 - from.x0 && moved < count; i++) {
        const x = leftFirst ? from.x0 + i : from.x1 - i;
        const idx = row + x;
        if (this.cells[idx] <= WALL) continue;
        this.cells[idx] = EMPTY;
        this.settled.set(fromId, (this.settled.get(fromId) ?? 0) - 1);
        // Aim near the destination apex so the stream feeds the cone's peak.
        const targetX = cxTo + (Math.random() - 0.5) * (to.x1 - to.x0) * 0.3;
        this.launch(x, y, targetX, this.inletY(to), material, to.id);
        moved++;
      }
    }
    return moved;
  }

  /**
   * Ballistic solve for a grain thrown from one bucket to another.
   *
   * Flight time comes from the vertical drop alone -- t = sqrt(2·dy/g), the time a
   * grain takes to fall that far from rest -- and the horizontal speed is then
   * whatever covers the gap in that time. That yields a clean parabola launched with
   * zero vertical velocity, so sand always leaves a bucket falling.
   *
   * Deriving the time from the *total* distance instead is wrong and looks absurd:
   * a long sideways hop then needs a large negative vy to stay airborne, and grains
   * fire upward out of the scene before curving back.
   */
  private launch(
    x: number,
    y: number,
    targetX: number,
    targetY: number,
    material: SandMaterial,
    bucket: string,
  ): void {
    const dx = targetX - x;
    const dy = Math.max(targetY - y, 1);
    const ttl = Math.max(6, Math.round(Math.sqrt((2 * dy) / this.gravity)));
    this.flying.push({
      x,
      y,
      px: x,
      py: y,
      vx: dx / ttl,
      // Zero, up to the rounding of ttl: solved so the fall alone covers the drop.
      vy: dy / ttl - 0.5 * this.gravity * ttl,
      material,
      ttl,
      targetX,
      targetY,
      bucket,
    });
  }

  /**
   * Place an arriving grain, walking up its column for the first free cell and
   * spreading sideways if that column is packed.
   *
   * Nothing here caps a pile at the bucket rim: the side walls only span the
   * bucket's own height, so a full bucket keeps heaping above them and spills over
   * naturally. Sand is discarded only if a wide search finds nowhere at all, which
   * would mean the scene itself is full.
   */
  private settle(x: number, y: number, material: SandMaterial, bucket: string): void {
    const startX = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const startY = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    // Bounded, but generous enough to clear the tallest cone the layout allows.
    const reach = 220;

    for (let dx = 0; dx <= 8; dx++) {
      const columns = dx === 0 ? [startX] : [startX - dx, startX + dx];
      for (const cx of columns) {
        if (cx < 0 || cx >= this.width) continue;
        for (let yi = startY; yi >= Math.max(0, startY - reach); yi--) {
          const idx = yi * this.width + cx;
          const cell = this.cells[idx];
          if (cell === EMPTY) {
            this.cells[idx] = material;
            this.settled.set(bucket, (this.settled.get(bucket) ?? 0) + 1);
            return;
          }
          if (cell === WALL) break;
        }
      }
    }
    this.overflow++;
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
        this.settle(grain.targetX, grain.targetY, grain.material, grain.bucket);
      } else {
        next.push(grain);
      }
    }
    this.flying = next;
  }

  /**
   * One automaton tick. Rows are walked bottom-up so a grain that falls lands in a
   * row already processed and cannot move twice in a frame; the scan direction
   * within a row alternates randomly, otherwise heaps lean consistently one way.
   */
  private stepCells(): void {
    const { cells, width, height } = this;
    for (let y = height - 2; y >= 0; y--) {
      const row = y * width;
      const below = row + width;
      const leftFirst = Math.random() < 0.5;
      for (let i = 0; i < width; i++) {
        const x = leftFirst ? i : width - 1 - i;
        const idx = row + x;
        const material = cells[idx];
        if (material <= WALL) continue;

        if (cells[below + x] === EMPTY) {
          cells[below + x] = material;
          cells[idx] = EMPTY;
          continue;
        }
        // Diagonal slide gives the pile its slope and lets a drained heap collapse.
        const dir = Math.random() < 0.5 ? 1 : -1;
        const a = x + dir;
        const b = x - dir;
        if (a >= 0 && a < width && cells[below + a] === EMPTY) {
          cells[below + a] = material;
          cells[idx] = EMPTY;
        } else if (b >= 0 && b < width && cells[below + b] === EMPTY) {
          cells[below + b] = material;
          cells[idx] = EMPTY;
        }
      }
    }
  }

  step(): void {
    this.stepFlying();
    this.stepCells();
  }

  /** True once nothing is in flight and the automaton has gone quiet enough to skip. */
  get inFlight(): number {
    return this.flying.length;
  }

  clearSand(): void {
    const { cells } = this;
    for (let i = 0; i < cells.length; i++) if (cells[i] > WALL) cells[i] = EMPTY;
    this.flying = [];
    this.settled.clear();
    this.overflow = 0;
  }

  /**
   * Paint the whole grid into a 32-bit view of an ImageData buffer. One pass, no
   * per-pixel function calls; in-flight grains are stamped on top so a stream is
   * visible between buckets.
   */
  render(buf32: Uint32Array): void {
    const { cells, width, height, palette, bgRows } = this;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const bg = bgRows[y];
      for (let x = 0; x < width; x++) {
        const i = row + x;
        const material = cells[i];
        if (material === EMPTY) {
          buf32[i] = bg;
        } else {
          // Hash-speckled shade, stable per cell so heaps look granular but do not
          // shimmer between frames. The old (i + row*2) % 3 formula produced
          // diagonal banding rather than grain.
          const variant = (Math.imul(i, 2654435761) >>> 0) % 3;
          buf32[i] = palette[material * 3 + variant];
        }
      }
    }
    // Grains between buckets can cross ten cells in a frame. Stamping only the
    // current position leaves a dotted line that strobes; walking the segment from
    // last frame draws a continuous stream, which is the whole point of the arcs.
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
          // Never paint over settled sand or a wall; the stream passes behind them.
          if (cells[idx] === EMPTY) buf32[idx] = colour;
        }
      }
    }
  }
}
