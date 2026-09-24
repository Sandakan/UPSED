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
  isLeading?: boolean;
  isTrailing?: boolean;
}

export interface RangeBounds {
  startMs: number;
  endMs: number;
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
 * Detects gaps between consecutive telemetry frames, as well as leading/trailing
 * gaps relative to an active requested time window (rangeBounds).
 *
 * A gap is declared when delta t > max(3.5 * medianStepMs, 3 * pollIntervalSecs, 45s).
 */
export function detectDataGaps<T extends TimestampedSample>(
  samples: T[],
  pollIntervalSecs: number = 2,
  rangeBounds?: RangeBounds | null
): DataGapInterval[] {
  // If no samples at all but rangeBounds is provided, the entire requested window is a gap
  if (!samples || samples.length === 0) {
    if (rangeBounds && rangeBounds.endMs > rangeBounds.startMs) {
      const delta = rangeBounds.endMs - rangeBounds.startMs;
      const startIso = new Date(rangeBounds.startMs).toISOString();
      const endIso = new Date(rangeBounds.endMs).toISOString();
      return [
        {
          startMs: rangeBounds.startMs,
          endMs: rangeBounds.endMs,
          durationMs: delta,
          formattedDuration: formatGapDuration(delta),
          start: startIso,
          end: endIso,
          rawStart: `${startIso}__rangeStart`,
          rawEnd: `${endIso}__rangeEnd`,
          startIndex: -1,
          endIndex: 0,
          isLeading: true,
          isTrailing: true,
        },
      ];
    }
    return [];
  }

  // Calculate typical (median) step between consecutive valid samples
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

  deltas.sort((a, b) => a - b);
  const medianStepMs = (deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : null) || (pollIntervalSecs * 1000);
  const thresholdMs = Math.max(medianStepMs * 3.5, pollIntervalSecs * 3 * 1000, 45 * 1000);
  const gaps: DataGapInterval[] = [];

  const firstRaw = samples[0].rawTimestamp || samples[0].timestamp || samples[0].time || '';
  const firstMs = toEpochMs(firstRaw);
  const lastRaw = samples[samples.length - 1].rawTimestamp || samples[samples.length - 1].timestamp || samples[samples.length - 1].time || '';
  const lastMs = toEpochMs(lastRaw);

  // 1. Leading Gap: between requested range start and the first recorded sample
  if (rangeBounds && rangeBounds.startMs && firstMs !== null && firstMs - rangeBounds.startMs > thresholdMs) {
    const delta = firstMs - rangeBounds.startMs;
    const startIso = new Date(rangeBounds.startMs).toISOString();
    gaps.push({
      startMs: rangeBounds.startMs,
      endMs: firstMs,
      durationMs: delta,
      formattedDuration: formatGapDuration(delta),
      start: startIso,
      end: samples[0].time || firstRaw.slice(-8),
      rawStart: `${startIso}__rangeStart`,
      rawEnd: samples[0].xKey || firstRaw,
      startIndex: -1,
      endIndex: 0,
      isLeading: true,
    });
  }

  // 2. Internal Gaps: between consecutive samples
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

      if (gaps.length >= 40) break;
    }
  }

  // 3. Trailing Gap: between the last recorded sample and requested range end
  if (rangeBounds && rangeBounds.endMs && lastMs !== null && rangeBounds.endMs - lastMs > thresholdMs) {
    const delta = rangeBounds.endMs - lastMs;
    const endIso = new Date(rangeBounds.endMs).toISOString();
    gaps.push({
      startMs: lastMs,
      endMs: rangeBounds.endMs,
      durationMs: delta,
      formattedDuration: formatGapDuration(delta),
      start: samples[samples.length - 1].time || lastRaw.slice(-8),
      end: endIso,
      rawStart: samples[samples.length - 1].xKey || lastRaw,
      rawEnd: `${endIso}__rangeEnd`,
      startIndex: samples.length - 1,
      endIndex: samples.length,
      isTrailing: true,
    });
  }

  return gaps;
}

/**
 * Injects boundary null anchor points into a chart data array across data gaps.
 * Generates proportional points for gaps so that unrecorded durations visually
 * occupy their true proportional width on categorical time-series axes.
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
  ],
  rangeBounds?: RangeBounds | null
): T[] {
  if ((!data || data.length === 0) && (!gaps || gaps.length === 0)) {
    return data || [];
  }

  // If no data points exist at all, but we have a window gap, generate a proportional placeholder timeline
  if (!data || data.length === 0) {
    if (!rangeBounds || !gaps || gaps.length === 0) return [];
    const totalMs = rangeBounds.endMs - rangeBounds.startMs;
    const count = 60;
    const placeholder: T[] = [];
    for (let k = 0; k < count; k++) {
      const ptMs = rangeBounds.startMs + (k / (count - 1)) * totalMs;
      const ptIso = new Date(ptMs).toISOString();
      const pt: any = {
        time: ptIso,
        xKey: k === 0 ? gaps[0].rawStart : k === count - 1 ? gaps[0].rawEnd : `${ptIso}__gap_${k}`,
        rawTimestamp: ptIso,
        isGap: true,
        gapDuration: gaps[0].formattedDuration,
      };
      for (const key of numericKeys) {
        pt[key] = null;
      }
      placeholder.push(pt);
    }
    return placeholder;
  }

  if (!gaps || gaps.length === 0) {
    return data;
  }

  // Calculate point density from recorded data
  const firstRaw = data[0].rawTimestamp || data[0].timestamp || data[0].time || '';
  const lastRaw = data[data.length - 1].rawTimestamp || data[data.length - 1].timestamp || data[data.length - 1].time || '';
  const firstMs = toEpochMs(firstRaw);
  const lastMs = toEpochMs(lastRaw);
  const recordedSpanMs = firstMs !== null && lastMs !== null && lastMs > firstMs ? lastMs - firstMs : 0;
  const pointsPerMs = recordedSpanMs > 0 ? data.length / recordedSpanMs : 1 / 10000;

  const result: T[] = [];

  // 1. Process Leading Gap (if any)
  const leadingGap = gaps.find((g) => g.isLeading);
  if (leadingGap) {
    const desired = Math.round(leadingGap.durationMs * pointsPerMs);
    const count = Math.max(4, Math.min(desired, 1000));
    for (let k = 0; k < count; k++) {
      const ptMs = leadingGap.startMs + (k / count) * leadingGap.durationMs;
      const ptIso = new Date(ptMs).toISOString();
      const pt: any = {
        time: ptIso,
        xKey: k === 0 ? leadingGap.rawStart : `${ptIso}__gap_lead_${k}`,
        rawTimestamp: ptIso,
        isGap: true,
        gapDuration: leadingGap.formattedDuration,
      };
      for (const key of numericKeys) {
        pt[key] = null;
      }
      result.push(pt);
    }
  }

  // Internal gaps map by startIndex
  const internalGaps = new Map<number, DataGapInterval>();
  for (const gap of gaps) {
    if (!gap.isLeading && !gap.isTrailing) {
      internalGaps.set(gap.startIndex, gap);
    }
  }

  // 2. Process Recorded Data + Internal Gaps
  for (let i = 0; i < data.length; i++) {
    result.push(data[i]);

    const gap = internalGaps.get(i);
    if (gap && i < data.length - 1) {
      const desired = Math.round(gap.durationMs * pointsPerMs);
      const count = Math.max(3, Math.min(desired, 400));
      for (let k = 1; k <= count; k++) {
        const ptMs = gap.startMs + (k / (count + 1)) * gap.durationMs;
        const ptIso = new Date(ptMs).toISOString();
        const pt: any = {
          time: ptIso,
          xKey: `${ptIso}__gap_${i}_${k}`,
          rawTimestamp: ptIso,
          isGap: true,
          gapDuration: gap.formattedDuration,
        };
        for (const key of numericKeys) {
          pt[key] = null;
        }
        result.push(pt);
      }
    }
  }

  // 3. Process Trailing Gap (if any)
  const trailingGap = gaps.find((g) => g.isTrailing);
  if (trailingGap) {
    const desired = Math.round(trailingGap.durationMs * pointsPerMs);
    const count = Math.max(4, Math.min(desired, 1000));
    for (let k = 1; k <= count; k++) {
      const ptMs = trailingGap.startMs + (k / count) * trailingGap.durationMs;
      const ptIso = new Date(ptMs).toISOString();
      const pt: any = {
        time: ptIso,
        xKey: k === count ? trailingGap.rawEnd : `${ptIso}__gap_trail_${k}`,
        rawTimestamp: ptIso,
        isGap: true,
        gapDuration: trailingGap.formattedDuration,
      };
      for (const key of numericKeys) {
        pt[key] = null;
      }
      result.push(pt);
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
