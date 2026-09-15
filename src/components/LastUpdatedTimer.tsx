import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export interface LastUpdatedTimerProps {
  lastUpdatedAt?: number;
  selectedDevice?: string | null;
}

export const LastUpdatedTimer: React.FC<LastUpdatedTimerProps> = React.memo(({
  lastUpdatedAt: propUpdatedAt,
  selectedDevice,
}) => {
  const { t, i18n } = useTranslation('common');
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

  const diffSec = Math.max(0, Math.floor((Date.now() - effectiveUpdatedAt) / 1000));
  let relativeTime = '';
  if (diffSec === 0) {
    relativeTime = t('common:time.justNow', 'just now');
  } else if (diffSec < 60) {
    relativeTime = t('common:time.secondsAgo', { count: diffSec, defaultValue: `${diffSec}s ago` });
  } else {
    const diffMin = Math.floor(diffSec / 60);
    const remSec = diffSec % 60;
    if (diffMin < 60) {
      relativeTime = remSec > 0 ? `${diffMin}m ${remSec}s` : `${diffMin}m`;
    } else {
      relativeTime = `${Math.floor(diffMin / 60)}h`;
    }
  }

  const timeStr = new Date(effectiveUpdatedAt).toLocaleTimeString(i18n.language);

  return (
    <div
      className="hidden md:flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-lg text-slate-500"
      title={`${t('common:time.lastUpdated', 'Last updated')}: ${timeStr}`}
    >
      <Clock className="w-3 h-3 text-emerald-500" />
      <span>{relativeTime || timeStr}</span>
    </div>
  );
});

