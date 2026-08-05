// Human-readable formatting helpers ported from the Python CLI.

/** Mirror of histogram.format_seconds_human. */
export function formatSecondsHuman(seconds: number): string {
  let s = Math.trunc(seconds);
  if (s === 0) return "0s";
  const parts: string[] = [];
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  s -= minutes * 60;
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(" ");
}

/** Mirror of hold_bucket.format_duration. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

/**
 * Mirror of histogram.format_epoch_human_relative.
 * `now` is injectable so results are deterministic / testable.
 */
export function formatEpochHumanRelative(epochSeconds: number, now: Date = new Date()): string {
  if (!Number.isFinite(epochSeconds)) return "N/A";
  const eventTime = new Date(Math.trunc(epochSeconds) * 1000);
  if (Number.isNaN(eventTime.getTime())) return "N/A";
  const deltaSec = (now.getTime() - eventTime.getTime()) / 1000;

  const MIN = 60;
  const HOUR = 3600;
  const DAY = 86400;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;

  if (deltaSec < MIN) return "just now";
  if (deltaSec < HOUR) {
    const minutes = Math.floor(deltaSec / 60);
    return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  }
  if (deltaSec < DAY) {
    const hours = Math.floor(deltaSec / 3600);
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  }
  if (deltaSec < WEEK) {
    const days = Math.floor(deltaSec / DAY);
    return `${days} day${days !== 1 ? "s" : ""} ago`;
  }
  if (deltaSec < MONTH) {
    const weeks = Math.floor(deltaSec / DAY / 7);
    return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
  }
  const y = eventTime.getFullYear();
  const m = String(eventTime.getMonth() + 1).padStart(2, "0");
  const d = String(eventTime.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format seconds as H:MM:SS like Python's str(timedelta(...)). */
export function formatTimedelta(seconds: number): string {
  if (!seconds) return "N/A";
  const total = Math.trunc(seconds);
  const days = Math.floor(total / 86400);
  let rem = total - days * 86400;
  const hours = Math.floor(rem / 3600);
  rem -= hours * 3600;
  const minutes = Math.floor(rem / 60);
  const secs = rem - minutes * 60;
  const hms = `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return days ? `${days} day${days !== 1 ? "s" : ""}, ${hms}` : hms;
}
