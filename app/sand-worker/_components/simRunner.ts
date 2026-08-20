/**
 * The /sand playback loop with the DOM taken out of it.
 *
 * This is the same physics contract as app/sand/view.tsx -- one grain is one job,
 * a pile's grain count IS that state's census, transitions vanish off the source
 * summit and drop into the destination -- lifted out of the React component so it
 * can run inside a Web Worker (and headlessly in Node, which is how it is
 * checked). It owns the engine, the grain meters, the pending-debt carry, the
 * day cursor and the live census; it knows nothing about canvases or messages.
 *
 * The engine and timeline maths are IMPORTED from app/sand/_components, not
 * copied: neither module touches the DOM, so both are already worker-safe.
 */

import {
  PileEngine,
  SAND_ACTIVE,
  SAND_COMPLETED,
  SAND_PLACED,
  SAND_REMOVED,
  type LaneInput,
  type SandMaterial,
} from "../../sand/_components/pileEngine";
import {
  GrainMeter,
  applyDay,
  censusAt,
  daySeconds,
  peakCensus,
  type Census,
  type Timeline,
} from "../../sand/_components/timeline";

/** Lifecycle order, left to right; most transitions read as rightward moves. */
export const LANES: { id: keyof Census; label: string; material: SandMaterial }[] = [
  { id: "placed", label: "Placed", material: SAND_PLACED },
  { id: "active", label: "Active", material: SAND_ACTIVE },
  { id: "completed", label: "Completed", material: SAND_COMPLETED },
  { id: "removed", label: "Removed", material: SAND_REMOVED },
];

/** Every flow channel that needs a meter; the transition ones also need a debt slot. */
const TRANSITIONS: {
  channel: string;
  from: string;
  to: string;
  material: SandMaterial;
}[] = [
  { channel: "placedToActive", from: "placed", to: "active", material: SAND_ACTIVE },
  { channel: "placedToRemoved", from: "placed", to: "removed", material: SAND_REMOVED },
  { channel: "placedToCompleted", from: "placed", to: "completed", material: SAND_COMPLETED },
  { channel: "activeToCompleted", from: "active", to: "completed", material: SAND_COMPLETED },
  { channel: "activeToRemoved", from: "active", to: "removed", material: SAND_REMOVED },
];

const METER_KEYS = ["placedNew", ...TRANSITIONS.map((t) => t.channel)];

export class SimRunner {
  readonly engine: PileEngine;

  private meters: Record<string, GrainMeter> = {};
  /**
   * Grains owed to a destination but not yet moved: remove() can only vanish sand
   * that has actually settled, and Active is a pass-through whose grains are often
   * still mid-air when the data says they finish. The shortfall is carried to the
   * next frame and paid off as sand lands.
   */
  private pending: Record<string, number> = {};
  private progress = 0;
  private day = 0;
  /**
   * The live job census, advanced by the same flow numbers that drive the sand.
   * This -- not grain arithmetic -- is what the labels print, so a pile's number
   * is exact even though its height is quantised.
   */
  private live: Census = { placed: 0, active: 0, completed: 0, removed: 0 };

  constructor(private readonly timeline: Timeline) {
    const peaks = peakCensus(timeline);
    const laneInputs: LaneInput[] = LANES.map((lane) => ({
      ...lane,
      peakGrains: Math.ceil(peaks[lane.id]),
    }));
    this.engine = new PileEngine(laneInputs);
    this.seek(0);
  }

  get dayCount(): number {
    return this.timeline.days.length;
  }

  /** Clamped for display: the cursor runs one past the end when the run finishes. */
  get dayIndex(): number {
    return Math.min(this.day, Math.max(0, this.dayCount - 1));
  }

  get census(): Census {
    return this.live;
  }

  get done(): boolean {
    return this.day >= this.dayCount && this.engine.inFlight === 0;
  }

  /**
   * Jump to the start of a day: each pile's census is stamped as an already-
   * settled cone and playback resumes from there. Day 0's census is the opening
   * backlog, so restart is just seek(0) -- the scene opens with the piles the data
   * says already existed.
   */
  seek(target: number): void {
    const clamped = Math.max(0, Math.min(target, this.dayCount - 1));
    const census = censusAt(this.timeline, clamped);
    this.engine.clearSand();
    for (const lane of LANES) {
      // One grain per job: the stamped pile IS the census.
      const grains = Math.round(census[lane.id]);
      if (grains > 0) this.engine.stamp(lane.id, grains, lane.material);
    }
    this.meters = Object.fromEntries(METER_KEYS.map((key) => [key, new GrainMeter(1)]));
    this.pending = Object.fromEntries(TRANSITIONS.map((t) => [t.channel, 0]));
    this.progress = 0;
    this.day = clamped;
    this.live = { ...census };
  }

  /** Emit `fraction` of the current day's flows as sand, and advance the census. */
  private emitFor(fraction: number): void {
    const day = this.timeline.days[this.day];
    if (!day) return;
    const engine = this.engine;

    // New work rains into Placed.
    const pour = this.meters.placedNew.take(day.placedNew * fraction);
    if (pour > 0) engine.drop("placed", pour, SAND_PLACED);

    // Transitions: queue what this frame owes, then pay down what the source can
    // supply -- vanish off the source summit, drop into the destination.
    for (const t of TRANSITIONS) {
      const owed = day[t.channel as keyof typeof day] as number;
      this.pending[t.channel] += this.meters[t.channel].take(owed * fraction);
    }
    for (const t of TRANSITIONS) {
      if (this.pending[t.channel] <= 0) continue;
      const taken = engine.remove(t.from, this.pending[t.channel]);
      if (taken > 0) {
        engine.drop(t.to, taken, t.material);
        this.pending[t.channel] -= taken;
      }
    }

    // Job counts come from the data, not grain counts, so the readout stays exact
    // even though the sand is quantised.
    applyDay(this.live, day, fraction);
  }

  /**
   * Move the calendar on by `dt` seconds of wall clock at `speed`x, emitting sand
   * as it goes. Activity-paced: a dead day flicks past, a million-job day lingers.
   */
  advance(dt: number, speed: number): void {
    if (this.day >= this.dayCount) return;
    const perDay = daySeconds(this.timeline.days[this.day]) / speed;
    const chunk = Math.min(dt / perDay, 1 - this.progress);
    if (chunk > 0) this.emitFor(chunk);
    this.progress += chunk;
    // The calendar waits for the physics: a day ends only once its last grain has
    // landed AND every pile has stopped moving. Pending debts are deliberately not
    // part of the gate -- with nothing falling and nothing moving they are
    // momentarily unpayable, and the next day's arrivals are what pays them.
    if (this.progress >= 1 && this.engine.inFlight === 0 && this.engine.movesLastStep === 0) {
      this.progress = 0;
      this.day++;
    }
  }

  /** One physics frame. Kept separate from advance() so the two can be timed apart. */
  step(tick: number): void {
    this.engine.step(tick);
  }
}
