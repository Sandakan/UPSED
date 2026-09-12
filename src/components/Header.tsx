import React, { useState, useEffect, useRef } from 'react';
import {
  Home,
  ChevronRight,
  RefreshCw,
  Plus,
  MoreHorizontal,
  Shield,
} from 'lucide-react';
import { UnlockStage } from '../lib/types';
import { LastUpdatedTimer } from './LastUpdatedTimer';
import { PrimaryButton } from './PrimaryButton';

interface HeaderProps {
  currentTab: string;
  selectedDevice: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdatedAt?: number;
  safetyStage: UnlockStage;
  onTabChange: (tab: string) => void;
  onOpenAddDeviceModal: () => void;
}

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  events:    'Events',
  control:   'Hardware Control',
  config:    'Configuration',
  history:   'History & Graphs',
  settings:  'Settings',
};

const getStagePillStyle = (stage: UnlockStage) => {
  switch (stage) {
    case 'T1ReadOnly':       return 'bg-emerald-950/80 text-emerald-400 border-emerald-700/40';
    case 'T2NonDestructive': return 'bg-blue-950/80    text-blue-400    border-blue-700/40';
    case 'T3ConfigWrite':    return 'bg-amber-950/80   text-amber-400   border-amber-700/40';
    case 'T4PowerControl':   return 'bg-rose-950/80    text-rose-400    border-rose-700/40';
  }
};

const getStagePillLabel = (stage: UnlockStage) => {
  switch (stage) {
    case 'T1ReadOnly':       return 'T1 · Read-Only';
    case 'T2NonDestructive': return 'T2 · Diagnostic';
    case 'T3ConfigWrite':    return 'T3 · Config Write';
    case 'T4PowerControl':   return 'T4 · Power Control';
  }
};

export const Header: React.FC<HeaderProps> = React.memo(({
  currentTab,
  selectedDevice,
  onRefresh,
  isRefreshing,
  lastUpdatedAt,
  safetyStage,
  onTabChange,
  onOpenAddDeviceModal,
}) => {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Close overflow menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pageLabel = PAGE_LABELS[currentTab] ?? currentTab;

  return (
    <header
      className="h-14 flex items-center justify-between px-3 sm:px-5 z-10 shrink-0 min-w-0"
      style={{
        backgroundColor: 'transparent',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* ── Left: Breadcrumb ──────────────────────────────── */}
      <div className="flex items-center space-x-1.5 text-sm min-w-0 shrink mr-2">
        <button
          onClick={() => onTabChange('dashboard')}
          className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition shrink-0"
          title="Dashboard"
        >
          <Home className="w-3.5 h-3.5" />
        </button>
        <ChevronRight className="w-3 h-3 text-slate-700 shrink-0" />
        <span className="text-slate-200 font-medium truncate">{pageLabel}</span>
      </div>

      {/* ── Right: Actions ────────────────────────────────── */}
      <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
        {/* Safety Gate pill */}
        <span
          className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${getStagePillStyle(safetyStage)}`}
        >
          <Shield className="w-3 h-3" />
          {getStagePillLabel(safetyStage)}
        </span>

        {/* Last updated clock */}
        <LastUpdatedTimer lastUpdatedAt={lastUpdatedAt} selectedDevice={selectedDevice} />

        {/* Primary CTA: Add / Scan UPS */}
        <PrimaryButton
          onClick={onOpenAddDeviceModal}
          icon={<Plus className="w-3.5 h-3.5" />}
          title="Add New UPS Device"
        >
          <span className="hidden xl:inline">Add New UPS Device</span>
          <span className="hidden sm:inline xl:hidden">Add UPS</span>
        </PrimaryButton>

        {/* Overflow menu (Refresh Telemetry) */}
        <div className="relative" ref={overflowRef}>
          <button
            onClick={() => setOverflowOpen((o) => !o)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] transition"
            title="More actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {overflowOpen && (
            <div
              className="absolute right-0 mt-1.5 w-48 rounded-xl overflow-hidden shadow-2xl z-50 border"
              style={{
                backgroundColor: 'var(--popover-bg)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <button
                onClick={() => { onRefresh(); setOverflowOpen(false); }}
                disabled={!selectedDevice || isRefreshing}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:text-slate-100 hover:bg-white/[0.06] transition disabled:opacity-40"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                <span>Refresh Telemetry</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
});
