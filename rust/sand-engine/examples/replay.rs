//! Headless replay of the real job timeline through the Rust engine.
//!
//! The Rust counterpart of `scripts/sim-sand.ts`: same lanes, same meters, same
//! pending-debt mechanism, same per-day pacing, run flat out on the host target.
//! The number that matters is DRIFT -- settled grains per lane versus the census
//! the data says the lane should hold. In-flight grains and metering remainders
//! allow a little slack mid-run; at the end, after settling, drift should be
//! zero. This exists so "does the Rust port still equal the census" is answered
//! empirically against production data, not by staring at the code.
//!
//! The schedule comes in as a plain text dump of `app/sand/_components/timeline.ts`
//! (the TypeScript that both sand pages share), so this harness and the browser
//! are provably driven by the same numbers:
//!
//!   line 1: peaks   placed active completed removed
//!   line 2: initial placed active
//!   line n: placedNew placedToActive placedToRemoved placedToCompleted
//!           activeToCompleted activeToRemoved daySeconds
//!
//! Usage: cargo run --release --example replay -- <schedule.txt> [--quiet]

use std::time::Instant;

use sand_engine::{PileEngine, SAND_ACTIVE, SAND_COMPLETED, SAND_PLACED, SAND_REMOVED};

const FPS: f64 = 60.0;
const LANE_NAMES: [&str; 4] = ["placed", "active", "completed", "removed"];
const MATERIALS: [u8; 4] = [SAND_PLACED, SAND_ACTIVE, SAND_COMPLETED, SAND_REMOVED];

#[derive(Clone, Copy, Default)]
struct Day {
    placed_new: f64,
    placed_to_active: f64,
    placed_to_removed: f64,
    placed_to_completed: f64,
    active_to_completed: f64,
    active_to_removed: f64,
    seconds: f64,
}

/// Turns a fractional stream of jobs into whole grains without losing the
/// remainder -- a port of `GrainMeter` at one job per grain.
#[derive(Default)]
struct GrainMeter {
    carry: f64,
}

impl GrainMeter {
    fn take(&mut self, jobs: f64) -> u32 {
        self.carry += jobs;
        let whole = self.carry.floor();
        if whole <= 0.0 {
            return 0;
        }
        self.carry -= whole;
        whole as u32
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("usage: replay <schedule.txt> [--quiet]");
    let quiet = args.any(|a| a == "--quiet");
    let text = std::fs::read_to_string(&path).expect("could not read schedule");
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());

    let peaks: Vec<u32> = lines
        .next()
        .expect("missing peaks line")
        .split_whitespace()
        .map(|v| v.parse().expect("bad peak"))
        .collect();
    let initial: Vec<f64> = lines
        .next()
        .expect("missing initial line")
        .split_whitespace()
        .map(|v| v.parse().expect("bad initial"))
        .collect();
    let days: Vec<Day> = lines
        .map(|line| {
            let f: Vec<f64> = line.split_whitespace().map(|v| v.parse().unwrap()).collect();
            Day {
                placed_new: f[0],
                placed_to_active: f[1],
                placed_to_removed: f[2],
                placed_to_completed: f[3],
                active_to_completed: f[4],
                active_to_removed: f[5],
                seconds: f[6],
            }
        })
        .collect();

    let inputs: Vec<sand_engine::LaneInput> = (0..4)
        .map(|i| sand_engine::LaneInput { material: MATERIALS[i], peak_grains: peaks[i] })
        .collect();
    let mut engine = PileEngine::new(&inputs, 0x2545_f491);
    println!(
        "days={} peaks={} world {}x{} = {} cells",
        days.len(),
        peaks.iter().map(|p| p.to_string()).collect::<Vec<_>>().join("/"),
        engine.width(),
        engine.height(),
        (engine.width() as i64) * (engine.height() as i64),
    );

    // The opening backlog, stamped rather than rained, exactly as the page seeds it.
    let mut census = [initial[0].max(0.0), initial[1].max(0.0), 0.0, 0.0];
    for lane in 0..4 {
        let grains = census[lane].round() as u32;
        if grains > 0 {
            engine.stamp(lane, grains, MATERIALS[lane]);
        }
    }
    println!(
        "stamped opening census: {}",
        (0..4)
            .map(|l| format!("{}={}", LANE_NAMES[l], engine.settled_in(l)))
            .collect::<Vec<_>>()
            .join(" "),
    );

    // Six channels, in the order the page emits them.
    let mut meters: [GrainMeter; 6] = Default::default();
    // Five transition channels: (source lane, dest lane, dest material).
    let channels: [(usize, usize, u8); 5] = [
        (0, 1, SAND_ACTIVE),
        (0, 3, SAND_REMOVED),
        (0, 2, SAND_COMPLETED),
        (1, 2, SAND_COMPLETED),
        (1, 3, SAND_REMOVED),
    ];
    let mut pending = [0i64; 5];

    let mut total_frames = 0u64;
    let mut sim_nanos = 0u128;
    let mut peak_in_flight = 0u32;
    let mut tick = 0u32;

    for (d, day) in days.iter().enumerate() {
        let frames_per_day = ((day.seconds * FPS).round() as i64).max(1);
        let fraction = 1.0 / frames_per_day as f64;
        for _ in 0..frames_per_day {
            let flows = [
                day.placed_to_active,
                day.placed_to_removed,
                day.placed_to_completed,
                day.active_to_completed,
                day.active_to_removed,
            ];
            let pour = meters[0].take(day.placed_new * fraction);
            if pour > 0 {
                engine.drop_grains(0, pour, SAND_PLACED);
            }
            for c in 0..5 {
                pending[c] += i64::from(meters[c + 1].take(flows[c] * fraction));
            }
            for c in 0..5 {
                if pending[c] <= 0 {
                    continue;
                }
                let (from, to, material) = channels[c];
                let taken = engine.remove(from, pending[c] as u32);
                if taken > 0 {
                    engine.drop_grains(to, taken, material);
                    pending[c] -= i64::from(taken);
                }
            }

            let start = Instant::now();
            engine.step(tick);
            sim_nanos += start.elapsed().as_nanos();
            total_frames += 1;
            tick = tick.wrapping_add(1);
            peak_in_flight = peak_in_flight.max(engine.in_flight());
        }

        // apply_day: the census moves by the data's flows, not by grain counts.
        census[0] += day.placed_new - day.placed_to_active - day.placed_to_removed - day.placed_to_completed;
        census[1] += day.placed_to_active - day.active_to_completed - day.active_to_removed;
        census[2] += day.active_to_completed + day.placed_to_completed;
        census[3] += day.active_to_removed + day.placed_to_removed;

        if !quiet {
            let report = (0..4)
                .map(|l| {
                    let settled = engine.settled_in(l);
                    let expected = census[l].max(0.0).round() as i64;
                    let drift = settled - expected;
                    if drift == 0 {
                        format!("{}={}", LANE_NAMES[l], settled)
                    } else {
                        format!("{}={}({drift:+})", LANE_NAMES[l], settled)
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            println!(
                "day {:2}  {report}  inFlight={} overflow={}",
                d + 1,
                engine.in_flight(),
                engine.overflow(),
            );
        }
    }

    // Let everything land and relax, then check the contract one last time.
    for _ in 0..600 {
        let start = Instant::now();
        engine.step(tick);
        sim_nanos += start.elapsed().as_nanos();
        total_frames += 1;
        tick = tick.wrapping_add(1);
    }

    println!("\nFINAL after settling (drift in grains vs census):");
    let mut worst = 0i64;
    for l in 0..4 {
        let settled = engine.settled_in(l);
        let expected = census[l].max(0.0).round() as i64;
        let drift = settled - expected;
        worst = worst.max(drift.abs());
        println!("{}={settled} expected={expected} drift={drift}", LANE_NAMES[l]);
    }
    println!(
        "overflow={} inFlight={} movesLastStep={} peakInFlight={peak_in_flight}",
        engine.overflow(),
        engine.in_flight(),
        engine.moves_last_step(),
    );
    println!(
        "sim {:.3} ms/frame over {total_frames} frames (native, release)",
        sim_nanos as f64 / total_frames as f64 / 1.0e6,
    );
    // A nonzero residue is not automatically a port defect: the emit loop's
    // pending debts can be left unpayable when the window closes, and the
    // TypeScript engine leaves exactly the same residue on the same schedule.
    // The check that matters is equality with `scripts/sim-sand.ts`, so print the
    // number to compare rather than a pass/fail that would cry wolf.
    println!("max |drift| = {worst} grains (compare with scripts/sim-sand.ts on the same schedule)");
}
