import React from 'react';
import { Battery, Zap, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { Q1Status } from '../lib/types';

interface HeaderProps {
  selectedDevice: string | null;
  status: Q1Status | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  batteryBridgeActive: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  selectedDevice,
  status,
  onRefresh,
  isRefreshing,
  batteryBridgeActive,
}) => {
  const getModeBadge = () => {
    if (!status) return null;

    if (status.ups_failed) {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-950/80 text-rose-400 border border-rose-800/60">
          <AlertTriangle className="w-3 h-3" />
          <span>FAULT / FAILED</span>
        </span>
      );
    }
    if (status.utility_fail) {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/80 text-amber-400 border border-amber-800/60 animate-pulse">
          <Battery className="w-3 h-3" />
          <span>ON BATTERY</span>
        </span>
      );
    }
    if (status.bypass_active) {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-950/80 text-blue-400 border border-blue-800/60">
          <Zap className="w-3 h-3" />
          <span>BYPASS MODE</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
        <ShieldCheck className="w-3 h-3" />
        <span>LINE NORMAL (ONLINE)</span>
      </span>
    );
  };

  return (
    <header className="h-16 bg-slate-900/90 backdrop-blur border-b border-slate-800 flex items-center justify-between px-6 z-10">
      <div className="flex items-center space-x-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center space-x-2">
            <span>{selectedDevice ? `UPS on ${selectedDevice}` : 'No UPS Selected'}</span>
          </h2>
          <p className="text-xs text-slate-400 font-mono">
            {status ? `Telemetry active • ${status.raw_status_bits}` : 'Disconnected'}
          </p>
        </div>
        {getModeBadge()}
      </div>

      <div className="flex items-center space-x-3">
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
