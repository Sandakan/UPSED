import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export interface LastUpdatedTimerProps {
  lastUpdatedAt?: number;
  selectedDevice?: string | null;
}

const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp || timestamp <= 0) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec === 0) return 'just now';
  if (diffSec === 1) return '1s ago';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  const remSec = diffSec % 60;
  if (diffMin < 60) return remSec > 0 ? `${diffMin}m ${remSec}s ago` : `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
};

export const LastUpdatedTimer: React.FC<LastUpdatedTimerProps> = React.memo(({
  lastUpdatedAt: propUpdatedAt,
  selectedDevice,
}) => {
  const [, setTick] = useState(0);

  // Subscribe to query dataUpdatedAt if not explicitly provided as prop
  const { dataUpdatedAt: queryUpdatedAt } = useQuery({
    queryKey: ['deviceStatus', selectedDevice],
    queryFn: () => null,
    enabled: false,
    notifyOnChangeProps: ['dataUpdatedAt'],
  });

  const effectiveUpdatedAt = propUpdatedAt ?? (queryUpdatedAt > 0 ? queryUpdatedAt : undefined);

  // Tick every second so relative time stays fresh
  useEffect(() => {
    if (!effectiveUpdatedAt || effectiveUpdatedAt <= 0) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [effectiveUpdatedAt]);

  if (!effectiveUpdatedAt || effectiveUpdatedAt <= 0) {
    return null;
  }

  const relativeTime = formatRelativeTime(effectiveUpdatedAt);

  return (
    <div
      className="hidden md:flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-lg text-slate-500"
      title={`Telemetry received: ${new Date(effectiveUpdatedAt).toLocaleTimeString()}`}
    >
      <Clock className="w-3 h-3 text-emerald-500" />
      <span>{relativeTime || new Date(effectiveUpdatedAt).toLocaleTimeString()}</span>
    </div>
  );
});

