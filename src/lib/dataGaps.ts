export interface DataGapInterval {
  startMs: number;
  endMs: number;
  durationMs: number;
  formattedDuration: string;
  start: string;
  end: string;
  rawStart: string;
  rawEnd: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Formats a duration in milliseconds into a concise, human-friendly string.
 * Examples: '45s', '14m', '2h 15m', '1d 6h'
 */
export function formatGapDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return remainingSeconds > 0 && totalMinutes < 5
      ? `${totalMinutes}m ${remainingSeconds}s`
      : `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes > 0
      ? `${totalHours}h ${remainingMinutes}m`
      : `${totalHours}h`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours > 0
    ? `${totalDays}d ${remainingHours}h`
    : `${totalDays}d`;
}

/**
 * Parses timestamp into milliseconds.
 */
function toEpochMs(ts: string): number | null {
  if (!ts) return null;
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? null : parsed;
}

export interface TimestampedSample {
  timestamp?: string;
  rawTimestamp?: string;
  time?: string;
  xKey?: string;
}

/**
 * Detects gaps between consecutive telemetry frames.
 * A gap is declared when delta t > max(3.5 * medianStepMs, 3 * pollIntervalSecs, 45s).
 * This dynamically adapts to downsampled historical ranges (e.g. 7d, 30d) where normal
 * points are minutes apart, preventing false gaps between every sample.
 */
export function detectDataGaps<T extends TimestampedSample>(
  samples: T[],
  pollIntervalSecs: number = 2
): DataGapInterval[] {
  if (!samples || samples.length < 2) return [];

  // Calculate the typical (median) step between consecutive valid samples
  const deltas: number[] = [];
  const maxProbe = Math.min(samples.length, 120);
  for (let i = 1; i < maxProbe; i++) {
    const prevRaw = samples[i - 1].rawTimestamp || samples[i - 1].timestamp || samples[i - 1].time || '';
    const currRaw = samples[i].rawTimestamp || samples[i].timestamp || samples[i].time || '';
    const prevMs = toEpochMs(prevRaw);
    const currMs = toEpochMs(currRaw);
    if (prevMs !== null && currMs !== null && currMs > prevMs) {
      deltas.push(currMs - prevMs);
    }
  }

  if (deltas.length === 0) return [];

  deltas.sort((a, b) => a - b);
  const medianStepMs = deltas[Math.floor(deltas.length / 2)] || (pollIntervalSecs * 1000);

  // A data gap is ONLY flagged if the time jump is significantly larger than the normal sample spacing!
  // Must be >= 3.5x median step, >= 3x poll interval, and at least 45 seconds.
  const thresholdMs = Math.max(medianStepMs * 3.5, pollIntervalSecs * 3 * 1000, 45 * 1000);
  const gaps: DataGapInterval[] = [];

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];

    const prevRaw = prev.rawTimestamp || prev.timestamp || prev.time || '';
    const currRaw = curr.rawTimestamp || curr.timestamp || curr.time || '';

    const prevMs = toEpochMs(prevRaw);
    const currMs = toEpochMs(currRaw);

    if (prevMs === null || currMs === null) continue;

    const delta = currMs - prevMs;
    if (delta > thresholdMs) {
      gaps.push({
        startMs: prevMs,
        endMs: currMs,
        durationMs: delta,
        formattedDuration: formatGapDuration(delta),
        start: prev.time || prevRaw.slice(-8),
        end: curr.time || currRaw.slice(-8),
        rawStart: prev.xKey || prevRaw,
        rawEnd: curr.xKey || currRaw,
        startIndex: i - 1,
        endIndex: i,
      });

      // Safety limit: Never allow more than 40 gap intervals in a single chart series
      // to prevent DOM/GPU exhaustion if timestamps are erratic
      if (gaps.length >= 40) break;
    }
  }

  return gaps;
}

/**
 * Injects boundary null anchor points into a chart data array across data gaps.
 * This guarantees that:
 * 1. Recharts Area/Line charts with connectNulls={false} break cleanly (no false linear interpolation).
 * 2. The gap timeline occupies visual width proportional to time elapsed, with a minimum width.
 * 3. The DataGapReferenceArea can span from the start anchor to the end anchor.
 */
export function injectGapAnchorPoints<T extends TimestampedSample & Record<string, any>>(
  data: T[],
  gaps: DataGapInterval[],
  numericKeys: string[] = [
    'value',
    'value2',
    'grid_voltage',
    'output_voltage',
    'grid_frequency',
    'output_frequency',
    'load_pct',
    'output_watts',
    'battery_voltage',
    'battery_soc',
    'temperature_c',
    'runtime_mins',
  ]
): T[] {
  // If no gaps or abnormal number of gaps, return original array immediately without allocation
  if (!data || data.length === 0 || !gaps || gaps.length === 0 || gaps.length > 40) {
    return data;
  }

  const gapByIndex = new Map<number, DataGapInterval>();
  for (const gap of gaps) {
    gapByIndex.set(gap.startIndex, gap);
  }

  const result: T[] = [];

  for (let i = 0; i < data.length; i++) {
    result.push(data[i]);

    const gap = gapByIndex.get(i);
    if (gap) {
      const prevPoint = data[i];
      const nextPoint = data[i + 1];

      if (nextPoint) {
        // Create a single null anchor point bridging the gap between prevPoint and nextPoint
        const gapAnchor: any = {
          ...prevPoint,
          time: '',
          xKey: `${prevPoint.xKey || prevPoint.timestamp || i}__gap`,
          rawTimestamp: gap.rawStart,
          isGap: true,
          suppressTick: true,
          gapDuration: gap.formattedDuration,
        };
        for (const k of numericKeys) {
          gapAnchor[k] = null;
        }

        result.push(gapAnchor);
      }
    }
  }

  return result;
}

/**
 * Derives visible data gap intervals from a rendered chart slice (e.g. visibleData after zoom).
 * Snaps the boundaries to the valid data points surrounding the gap so the shaded layer
 * meets the line curves seamlessly without empty margins.
 */
export function deriveVisibleDataGaps<T extends { isGap?: boolean; time?: string; xKey?: string; rawTimestamp?: string; gapDuration?: string }>(
  data: T[]
): DataGapInterval[] {
  if (!data || data.length < 2) return [];

  const gaps: DataGapInterval[] = [];
  let inGapStartIdx: number | null = null;

  for (let i = 0; i < data.length; i++) {
    if (data[i].isGap) {
      if (inGapStartIdx === null) {
        inGapStartIdx = i;
      }
    } else {
      if (inGapStartIdx !== null) {
        // Snap the boundaries to the valid data points surrounding the gap
        const boundaryStartIdx = inGapStartIdx > 0 ? inGapStartIdx - 1 : inGapStartIdx;
        const boundaryEndIdx = i; // First resumed valid point

        const startItem = data[boundaryStartIdx];
        const endItem = data[boundaryEndIdx];
        const gapInfoItem = data[inGapStartIdx];

        gaps.push({
          startMs: 0,
          endMs: 0,
          durationMs: 0,
          formattedDuration: gapInfoItem.gapDuration || 'Offline',
          start: startItem.time || '',
          end: endItem.time || '',
          rawStart: startItem.xKey || startItem.rawTimestamp || '',
          rawEnd: endItem.xKey || endItem.rawTimestamp || '',
          startIndex: boundaryStartIdx,
          endIndex: boundaryEndIdx,
        });
        inGapStartIdx = null;
      }
    }
  }

  if (inGapStartIdx !== null) {
    // Gap extends to the end of visible data
    const boundaryStartIdx = inGapStartIdx > 0 ? inGapStartIdx - 1 : inGapStartIdx;
    const boundaryEndIdx = data.length - 1;

    const startItem = data[boundaryStartIdx];
    const endItem = data[boundaryEndIdx];
    const gapInfoItem = data[inGapStartIdx];

    gaps.push({
      startMs: 0,
      endMs: 0,
      durationMs: 0,
      formattedDuration: gapInfoItem.gapDuration || 'Offline',
      start: startItem.time || '',
      end: endItem.time || '',
      rawStart: startItem.xKey || startItem.rawTimestamp || '',
      rawEnd: endItem.xKey || endItem.rawTimestamp || '',
      startIndex: boundaryStartIdx,
      endIndex: boundaryEndIdx,
    });
  }

  return gaps;
}
