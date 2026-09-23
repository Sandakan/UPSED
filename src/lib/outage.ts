import { EventLogRecord, OutageInterval } from './types';

export type { OutageInterval };

export interface OutageSample {
  time: string;
  grid_voltage: number;
  rawTimestamp?: string;
  xKey?: string;
}

export interface OutageDetectionResult {
  intervals: OutageInterval[];
  isOutageMap: boolean[];
}

/**
 * Parses timestamps into milliseconds for reliable interval comparisons.
 */
function toEpochMs(ts: string): number | null {
  if (!ts) return null;
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Detects power outage intervals and per-sample outage states across a series of telemetry samples.
 * Uses hybrid detection:
 * 1. AC Grid Voltage falling below safe line threshold (< 50V).
 * 2. Correlation with system events (UTILITY_FAIL -> UTILITY_RESTORE intervals).
 * 3. Live active outage state on the latest sample.
 */
export function detectOutageDetails(
  samples: OutageSample[],
  events: EventLogRecord[] = [],
  isCurrentlyFailing: boolean = false
): OutageDetectionResult {
  if (!samples || samples.length === 0) {
    return { intervals: [], isOutageMap: [] };
  }

  // Parse event windows: [failMs, restoreMs]
  const sortedEvents = [...events].sort(
    (a, b) => (toEpochMs(a.timestamp) ?? 0) - (toEpochMs(b.timestamp) ?? 0)
  );

  const eventWindows: Array<{ startMs: number; endMs: number }> = [];
  let currentFailMs: number | null = null;

  for (const evt of sortedEvents) {
    const ms = toEpochMs(evt.timestamp);
    if (!ms) continue;

    if (evt.event_type === 'UTILITY_FAIL') {
      currentFailMs = ms;
    } else if (evt.event_type === 'UTILITY_RESTORE' && currentFailMs !== null) {
      eventWindows.push({ startMs: currentFailMs, endMs: ms });
      currentFailMs = null;
    }
  }

  // If there's an open UTILITY_FAIL event without a subsequent UTILITY_RESTORE
  if (currentFailMs !== null) {
    eventWindows.push({ startMs: currentFailMs, endMs: Infinity });
  }

  // Determine for each sample whether it is in an outage
  const isOutageMap = samples.map((sample, idx) => {
    // 1. Voltage threshold check
    if (sample.grid_voltage < 50) {
      return true;
    }

    // 2. Correlate with event windows if rawTimestamp is present
    if (sample.rawTimestamp) {
      const sMs = toEpochMs(sample.rawTimestamp);
      if (sMs !== null) {
        for (const w of eventWindows) {
          if (sMs >= w.startMs && sMs <= w.endMs) {
            return true;
          }
        }
      }
    }

    // 3. If it's the last sample and currently failing
    if (idx === samples.length - 1 && isCurrentlyFailing) {
      return true;
    }

    return false;
  });

  // Group consecutive outage samples into intervals
  const intervals: OutageInterval[] = [];
  let currentStartIdx: number | null = null;

  for (let i = 0; i < samples.length; i++) {
    if (isOutageMap[i]) {
      if (currentStartIdx === null) {
        currentStartIdx = i;
      }
    } else {
      if (currentStartIdx !== null) {
        intervals.push({
          start: samples[currentStartIdx].time,
          end: samples[i - 1].time,
          rawStart: samples[currentStartIdx].xKey || samples[currentStartIdx].rawTimestamp || samples[currentStartIdx].time,
          rawEnd: samples[i - 1].xKey || samples[i - 1].rawTimestamp || samples[i - 1].time,
          startIndex: currentStartIdx,
          endIndex: i - 1,
          isActive: false,
        });
        currentStartIdx = null;
      }
    }
  }

  // If the series ended while in an outage
  if (currentStartIdx !== null) {
    intervals.push({
      start: samples[currentStartIdx].time,
      end: samples[samples.length - 1].time,
      rawStart: samples[currentStartIdx].xKey || samples[currentStartIdx].rawTimestamp || samples[currentStartIdx].time,
      rawEnd: samples[samples.length - 1].xKey || samples[samples.length - 1].rawTimestamp || samples[samples.length - 1].time,
      startIndex: currentStartIdx,
      endIndex: samples.length - 1,
      isActive: isCurrentlyFailing || isOutageMap[samples.length - 1],
    });
  }

  return { intervals, isOutageMap };
}

/**
 * Convenience wrapper returning only intervals
 */
export function detectOutageIntervals(
  samples: OutageSample[],
  events: EventLogRecord[] = [],
  isCurrentlyFailing: boolean = false
): OutageInterval[] {
  return detectOutageDetails(samples, events, isCurrentlyFailing).intervals;
}

