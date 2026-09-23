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
 * A gap is declared when delta t > max(3 * pollIntervalSecs, 30s).
 */
export function detectDataGaps<T extends TimestampedSample>(
  samples: T[],
  pollIntervalSecs: number = 2
): DataGapInterval[] {
  if (!samples || samples.length < 2) return [];

  const thresholdMs = Math.max(pollIntervalSecs * 3 * 1000, 30 * 1000);
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
  if (!data || data.length === 0 || !gaps || gaps.length === 0) return data;

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
        // Create a null anchor point immediately following the last valid point
        const gapStartAnchor: any = {
          ...prevPoint,
          time: gap.start,
          xKey: `${prevPoint.xKey || prevPoint.timestamp || i}__gap_start`,
          rawTimestamp: gap.rawStart,
          isGap: true,
          gapDuration: gap.formattedDuration,
        };
        for (const k of numericKeys) {
          if (k in gapStartAnchor) {
            gapStartAnchor[k] = null;
          }
        }

        // Create a null anchor point immediately preceding the next valid point
        const gapEndAnchor: any = {
          ...nextPoint,
          time: gap.end,
          xKey: `${nextPoint.xKey || nextPoint.timestamp || i + 1}__gap_end`,
          rawTimestamp: gap.rawEnd,
          isGap: true,
          gapDuration: gap.formattedDuration,
        };
        for (const k of numericKeys) {
          if (k in gapEndAnchor) {
            gapEndAnchor[k] = null;
          }
        }

        result.push(gapStartAnchor);
        result.push(gapEndAnchor);
      }
    }
  }

  return result;
}

/**
 * Derives visible data gap intervals from a rendered chart slice (e.g. visibleData after zoom).
 * Ensures that gap intervals strictly reference keys present in the current visible domain.
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
        const startItem = data[inGapStartIdx];
        const endItem = data[i - 1];
        gaps.push({
          startMs: 0,
          endMs: 0,
          durationMs: 0,
          formattedDuration: startItem.gapDuration || endItem.gapDuration || 'Offline',
          start: startItem.time || '',
          end: endItem.time || '',
          rawStart: startItem.xKey || startItem.rawTimestamp || '',
          rawEnd: endItem.xKey || endItem.rawTimestamp || '',
          startIndex: inGapStartIdx,
          endIndex: i - 1,
        });
        inGapStartIdx = null;
      }
    }
  }

  if (inGapStartIdx !== null) {
    const startItem = data[inGapStartIdx];
    const endItem = data[data.length - 1];
    gaps.push({
      startMs: 0,
      endMs: 0,
      durationMs: 0,
      formattedDuration: startItem.gapDuration || endItem.gapDuration || 'Offline',
      start: startItem.time || '',
      end: endItem.time || '',
      rawStart: startItem.xKey || startItem.rawTimestamp || '',
      rawEnd: endItem.xKey || endItem.rawTimestamp || '',
      startIndex: inGapStartIdx,
      endIndex: data.length - 1,
    });
  }

  return gaps;
}
