// Loading + light CPU-side analysis of the preprocessed job binary.
//
// Binary layout (see scripts/build-canvas-data.mjs), all sorted by submit:
//   submit : Uint32 * count   seconds from t0
//   disk   : Uint32 * count   RequestDisk (KB)
//   wait   : Uint16 * count    queue seconds; 65535 = never ran
//   dur    : Uint16 * count    run seconds;  65535 = no completion
//   mem    : Uint16 * count    RequestMemory (MB)

export const SENTINEL = 65535;

export type ColorMode = "stage" | "mem" | "disk" | "wait" | "dur";

export interface JobMeta {
  count: number;
  t0: number; // unix seconds of earliest submit
  tMax: number; // seconds from t0 to last completion
  maxWait: number;
  maxDur: number;
  maxMem: number;
  maxDisk: number;
  gridCols: number;
  neverRan: number;
}

export interface JobData {
  meta: JobMeta;
  submit: Float32Array; // seconds from t0
  wait: Float32Array; // seconds, or SENTINEL
  dur: Float32Array; // seconds, or SENTINEL
  mem: Float32Array; // MB
  disk: Float32Array; // KB
}

export interface StageCounts {
  unsubmitted: number;
  queued: number;
  running: number;
  completed: number;
}

export async function loadJobData(basePath = ""): Promise<JobData> {
  const metaRes = await fetch(`${basePath}/data/jobs-meta.json`, { cache: "force-cache" });
  if (!metaRes.ok) throw new Error(`Failed to load job metadata (${metaRes.status})`);
  const meta = (await metaRes.json()) as JobMeta;

  const binRes = await fetch(`${basePath}/data/jobs.bin`, { cache: "force-cache" });
  if (!binRes.ok) throw new Error(`Failed to load job data (${binRes.status})`);
  const buf = await binRes.arrayBuffer();

  const n = meta.count;
  const submitU32 = new Uint32Array(buf, 0, n);
  const diskU32 = new Uint32Array(buf, n * 4, n);
  const waitU16 = new Uint16Array(buf, n * 8, n);
  const durU16 = new Uint16Array(buf, n * 8 + n * 2, n);
  const memU16 = new Uint16Array(buf, n * 8 + n * 4, n);

  // GPU attributes want floats; convert once.
  const submit = new Float32Array(n);
  const wait = new Float32Array(n);
  const dur = new Float32Array(n);
  const mem = new Float32Array(n);
  const disk = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    submit[i] = submitU32[i];
    wait[i] = waitU16[i];
    dur[i] = durU16[i];
    mem[i] = memU16[i];
    disk[i] = diskU32[i];
  }

  return { meta, submit, wait, dur, mem, disk };
}

// Count how many jobs are in each stage at the given playhead time (seconds
// from t0). Runs over ~2M entries; cheap (a few ms) but call throttled.
export function computeStageCounts(data: JobData, playhead: number): StageCounts {
  const { submit, wait, dur } = data;
  const n = submit.length;
  let unsubmitted = 0;
  let queued = 0;
  let running = 0;
  let completed = 0;
  for (let i = 0; i < n; i++) {
    const s = submit[i];
    if (playhead < s) {
      unsubmitted++;
      continue;
    }
    const w = wait[i];
    if (w >= SENTINEL) {
      queued++; // never ran; sits in the queue forever
      continue;
    }
    const start = s + w;
    if (playhead < start) {
      queued++;
      continue;
    }
    const d = dur[i];
    if (d >= SENTINEL || playhead < start + d) {
      running++;
    } else {
      completed++;
    }
  }
  return { unsubmitted, queued, running, completed };
}
