/**
 * Time formatting utilities for VoltWatch.
 * Converts UTC ISO-8601 timestamps from SQLite into user-friendly local system time.
 */

/**
 * Formats an ISO timestamp string into a locale-aware 12-hour format with AM/PM for tables.
 * Example: 'Sep 24, 2026, 11:42:15 AM'
 */
export function formatTableTimestamp(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Formats an ISO timestamp string into concise local time for chart X-axes.
 * Example (single day): '11:42 AM'
 * Example (multi day): 'Sep 24, 11:42 AM'
 */
export function formatChartAxisTimestamp(isoString: string, isMultiDay: boolean): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  if (isMultiDay) {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Formats an ISO timestamp string into full local date-time for chart tooltips.
 * Example: 'Sep 24, 2026, 11:42:15 AM'
 */
export function formatChartTooltipTimestamp(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Formats a local date-time string for CSV export column.
 * Example: '2026-09-24 11:42:15'
 */
export function formatLocalCsvTimestamp(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
