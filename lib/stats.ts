// Numeric routines ported to match Python's NumPy / statistics semantics.

/** Mirror of the Python safe_float helper: returns null on empty / unparseable. */
export function safeFloat(value: string | undefined | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mean(data: number[]): number {
  if (data.length === 0) return 0;
  return data.reduce((a, b) => a + b, 0) / data.length;
}

/**
 * Min/max via a loop. Do NOT use `Math.min(...data)` / `Math.max(...data)` on
 * these arrays: spreading a large array into a call passes every element as an
 * argument, which overflows the call stack ("Maximum call stack size exceeded")
 * once the array reaches a few hundred thousand elements (e.g. a 2 GB CSV).
 */
export function arrayMin(data: number[]): number {
  let m = Infinity;
  for (let i = 0; i < data.length; i++) if (data[i] < m) m = data[i];
  return m;
}

export function arrayMax(data: number[]): number {
  let m = -Infinity;
  for (let i = 0; i < data.length; i++) if (data[i] > m) m = data[i];
  return m;
}

/** statistics.median — average of two middle values for even length. */
export function median(data: number[]): number {
  if (data.length === 0) return 0;
  const s = [...data].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Population standard deviation (NumPy np.std, ddof=0). */
export function stdPopulation(data: number[]): number {
  if (data.length === 0) return 0;
  const m = mean(data);
  const variance = data.reduce((a, b) => a + (b - m) ** 2, 0) / data.length;
  return Math.sqrt(variance);
}

/** Sample standard deviation (Python statistics.stdev, ddof=1). */
export function stdevSample(data: number[]): number {
  if (data.length < 2) return 0;
  const m = mean(data);
  const variance = data.reduce((a, b) => a + (b - m) ** 2, 0) / (data.length - 1);
  return Math.sqrt(variance);
}

/**
 * NumPy np.percentile with linear interpolation (default 'linear' method).
 * p is in [0, 100]. Matches analytics.percentile() and np.percentile().
 */
export function percentile(data: number[], p: number): number {
  if (data.length === 0) return 0;
  const s = [...data].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const k = ((s.length - 1) * p) / 100;
  const f = Math.floor(k);
  const c = f + 1;
  if (c >= s.length) return s[s.length - 1];
  return s[f] + (k - f) * (s[c] - s[f]);
}

/**
 * Python statistics.quantiles(data, n=4) using the default 'exclusive' method.
 * Returns the 3 cut points [Q1, Q2, Q3]. Requires at least 2 data points.
 */
export function quantilesExclusive(data: number[]): [number, number, number] {
  const s = [...data].sort((a, b) => a - b);
  const ld = s.length;
  const n = 4;
  const result: number[] = [];
  for (let i = 1; i < n; i++) {
    // j = i * m // n where m = ld + 1; delta = i*m - j*n
    const m = ld + 1;
    let j = Math.floor((i * m) / n);
    if (j < 1) j = 1;
    else if (j > ld - 1) j = ld - 1;
    const delta = i * m - j * n;
    const interpolated = (s[j - 1] * (n - delta) + s[j] * delta) / n;
    result.push(interpolated);
  }
  return [result[0], result[1], result[2]];
}

/** Pearson correlation coefficient (NumPy np.corrcoef[0,1]). */
export function correlation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

/**
 * Port of difflib.SequenceMatcher.ratio() (Ratcliff/Obershelp).
 * ratio = 2 * M / T, where M is the total number of matching characters
 * found by recursively matching the longest common contiguous block.
 */
export function sequenceMatcherRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  const matches = matchingBlocksTotal(a, b);
  return (2 * matches) / total;
}

function longestMatch(
  a: string,
  b: string,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
  b2j: Map<string, number[]>,
): [number, number, number] {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    const indices = b2j.get(a[i]);
    if (indices) {
      for (const j of indices) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
    }
    j2len = newj2len;
  }
  return [besti, bestj, bestsize];
}

function matchingBlocksTotal(a: string, b: string): number {
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j];
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch)!.push(j);
  }

  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longestMatch(a, b, alo, ahi, blo, bhi, b2j);
    if (k > 0) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return matches;
}
