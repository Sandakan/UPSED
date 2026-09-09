import React, { useState, useEffect } from 'react';
import { Battery, Zap, AlertTriangle, ShieldCheck, RefreshCw, Clock } from 'lucide-react';
import { Q1Status, UpsMetadata } from '../lib/types';

interface HeaderProps {
  selectedDevice: string | null;
  status: Q1Status | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  batteryBridgeActive: boolean;
  lastError?: string | null;
  lastUpdatedAt?: number;
  upsMetadata?: UpsMetadata | null;
}

const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp || timestamp <= 0) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec === 0) return 'just now';
  if (diffSec === 1) return '1 sec ago';
  if (diffSec < 60) return `${diffSec} secs ago`;
  const diffMin = Math.floor(diffSec / 60);
  const remSec = diffSec % 60;
  if (diffMin < 60) {
    return remSec > 0 ? `${diffMin}m ${remSec}s ago` : `${diffMin}m ago`;
  }
  return `${Math.floor(diffMin / 60)}h ago`;
};

export const Header: React.FC<HeaderProps> = ({
  selectedDevice,
  status,
  onRefresh,
  isRefreshing,
  batteryBridgeActive,
  lastError,
  lastUpdatedAt,
  upsMetadata,
}) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!lastUpdatedAt || lastUpdatedAt <= 0) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdatedAt]);

  const relativeTime = formatRelativeTime(lastUpdatedAt);
  const getModeBadge = () => {
    if (!status) return null;

    if (status.ups_failed) {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-950/80 text-rose-400 border border-rose-800/60">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>UPS FAULT</span>
        </span>
      );
    }
    if (status.utility_fail) {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/80 text-amber-400 border border-amber-800/60">
          <Battery className="w-3.5 h-3.5" />
          <span>BATTERY MODE (AC FAIL)</span>
        </span>
      );
    }
    if (status.bypass_active) {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-950/80 text-purple-400 border border-purple-800/60">
          <Zap className="w-3.5 h-3.5" />
          <span>BYPASS MODE</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>LINE NORMAL (ONLINE)</span>
      </span>
    );
  };

  return (
    <header className="h-16 bg-slate-900/90 backdrop-blur border-b border-slate-800 flex items-center justify-between px-6 z-10">
      <div className="flex items-center space-x-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center space-x-2">
            <span>
              {upsMetadata?.name
                ? `${upsMetadata.name}`
                : selectedDevice
                ? `UPS on ${selectedDevice}`
                : 'No UPS Selected'}
            </span>
            {upsMetadata && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-normal">
                {upsMetadata.rated_watts}W
              </span>
            )}
          </h2>
          <p className="text-xs font-mono">
            {status ? (
              <span className="text-emerald-400">Telemetry active • {status.raw_status_bits}</span>
            ) : lastError ? (
              <span className="text-amber-400" title={lastError}>
                Communication error: {lastError}
              </span>
            ) : selectedDevice ? (
              <span className="text-slate-400">Connecting / Polling telemetry...</span>
            ) : (
              <span className="text-slate-500">Disconnected</span>
            )}
          </p>
        </div>
        {getModeBadge()}
      </div>

      <div className="flex items-center space-x-3">
        {/* Last Updated At Indicator */}
        {lastUpdatedAt && lastUpdatedAt > 0 ? (
          <div
            className="text-xs px-2.5 py-1 rounded-lg border font-mono flex items-center space-x-1.5 bg-slate-950/60 text-slate-300 border-slate-800/60"
            title={`Telemetry last received at ${new Date(lastUpdatedAt).toLocaleTimeString()} (${relativeTime})`}
          >
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              Updated: {new Date(lastUpdatedAt).toLocaleTimeString()} ({relativeTime})
            </span>
          </div>
        ) : null}

        {/* Battery Bridge Status Indicator */}
        <div
          className={`text-xs px-2.5 py-1 rounded-lg border font-mono flex items-center space-x-1.5 ${
            batteryBridgeActive
              ? 'bg-cyan-950/60 text-cyan-400 border-cyan-800/60'
              : 'bg-slate-950/60 text-slate-500 border-slate-800/60'
          }`}
          title={
            batteryBridgeActive
              ? 'OS Battery Bridge is active (emulating system battery)'
              : 'OS Battery Bridge is disabled'
          }
        >
          <div
            className={`w-2 h-2 rounded-full ${
              batteryBridgeActive ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'
            }`}
          />
          <span>OS Bridge: {batteryBridgeActive ? 'Active' : 'Off'}</span>
        </div>

        {/* Manual Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={!selectedDevice || isRefreshing}
          className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition disabled:opacity-40"
          title="Poll status now"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </header>
  );
};

