import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  Plus,
  MoreHorizontal,
  Shield,
  Languages,
  Check,
  Star,
} from 'lucide-react';
import { UnlockStage, UpsMetadata, DiscoveredDevice, Q1Status } from '../lib/types';
import { LastUpdatedTimer } from './LastUpdatedTimer';
import { PrimaryButton } from './PrimaryButton';
import { setAppLanguage } from '../lib/i18n';
import { TransportPill, DeviceStatePill, getTransportMedium, getUpsOperatingState } from './DevicePills';

interface HeaderProps {
  currentTab: string;
  selectedUpsId?: string | null;
  activeProfile?: UpsMetadata | null;
  activeDevice?: DiscoveredDevice | null;
  activeStatus?: Q1Status | null;
  selectedDevice?: string | null;
  activeTransport?: 'usb' | 'websocket' | null;
  transportIp?: string | null;
  bridgeUpdateAvailable?: boolean;
  bridgeCompatible?: boolean;
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
  iot:       'IoT Bridge',
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

export const Header: React.FC<HeaderProps> = React.memo(({
  currentTab,
  activeProfile,
  activeDevice,
  activeStatus,
  selectedDevice,
  activeTransport,
  transportIp,
  bridgeUpdateAvailable,
  bridgeCompatible = true,
  onRefresh,
  isRefreshing,
  lastUpdatedAt,
  safetyStage,
  onTabChange,
  onOpenAddDeviceModal,
}) => {
  const { t, i18n } = useTranslation(['common', 'nav', 'modals']);
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

  const pageLabel = t(`nav:items.${currentTab}`, { defaultValue: PAGE_LABELS[currentTab] ?? currentTab });

  const getStageBadgeText = (stage: UnlockStage) => {
    switch (stage) {
      case 'T1ReadOnly':       return t('common:stages.t1.badge', 'T1 · Read-Only');
      case 'T2NonDestructive': return t('common:stages.t2.badge', 'T2 · Diagnostic');
      case 'T3ConfigWrite':    return t('common:stages.t3.badge', 'T3 · Config Write');
      case 'T4PowerControl':   return t('common:stages.t4.badge', 'T4 · Power Control');
    }
  };

  const currentLang = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  const transport = getTransportMedium(
    activeDevice?.port_name || activeProfile?.last_port || selectedDevice,
    activeTransport
  );
  const operatingState = getUpsOperatingState(activeStatus);

  return (
    <header
      className="h-14 flex items-center justify-between px-3 sm:px-5 z-10 shrink-0 min-w-0"
      style={{
        backgroundColor: 'transparent',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* ── Left: Page Title & Active UPS Badge ─────── */}
      <div className="flex items-center space-x-3 text-sm min-w-0 shrink mr-2">
        <span className="text-slate-200 font-bold truncate">{pageLabel}</span>

        {activeProfile && (
          <div className="hidden sm:flex items-center space-x-2 pl-3 border-l border-white/[0.08]">
            <div className="flex items-center space-x-1.5 text-xs text-slate-300 font-medium">
              {activeProfile.is_primary && (
                <span title="Primary Master UPS" className="inline-flex shrink-0">
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                </span>
              )}
              <span className="truncate max-w-[150px] md:max-w-[200px]" title={activeProfile.name}>
                {activeProfile.name}
              </span>
            </div>

            <TransportPill transport={transport} ip={transportIp} size="sm" />
            <DeviceStatePill state={operatingState} size="sm" />
          </div>
        )}
      </div>

      {/* ── Right: Actions ────────────────────────────────── */}
      <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
        {/* Safety Gate pill */}
        <span
          className={`hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${getStagePillStyle(safetyStage)}`}
        >
          <Shield className="w-3 h-3" />
          {getStageBadgeText(safetyStage)}
        </span>

        {/* Bridge Firmware Update Available Pill */}
        {bridgeUpdateAvailable && (
          <button
            onClick={() => onTabChange('iot')}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-emerald-950/80 text-emerald-300 border-emerald-600/50 hover:bg-emerald-900/60 transition cursor-pointer"
            title="ESP32 Bridge firmware update available! Click to open IoT firmware panel."
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Bridge Update</span>
          </button>
        )}

        {/* Bridge Firmware Incompatible Pill (Hard-Block Alert) */}
        {bridgeCompatible === false && (
          <button
            onClick={() => onTabChange('iot')}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-rose-950/80 text-rose-300 border-rose-600/50 hover:bg-rose-900/60 transition cursor-pointer"
            title="ESP32 Bridge firmware is outdated and incompatible! Click to update."
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
            <span>Bridge Incompatible</span>
          </button>
        )}

        {/* Last updated clock */}
        <LastUpdatedTimer lastUpdatedAt={lastUpdatedAt} selectedDevice={selectedDevice || activeDevice?.port_name || null} />

        {/* Primary CTA: Add / Scan UPS */}
        <PrimaryButton
          onClick={onOpenAddDeviceModal}
          icon={<Plus className="w-3.5 h-3.5" />}
          title={t('modals:connect.title', 'Connect UPS Device')}
        >
          <span className="hidden xl:inline">{t('modals:connect.title', 'Connect UPS Device')}</span>
          <span className="hidden sm:inline xl:hidden">{t('common:buttons.connect', 'Connect')}</span>
        </PrimaryButton>

        {/* Overflow menu (Actions & Language Switcher) */}
        <div className="relative" ref={overflowRef}>
          <button
            onClick={() => setOverflowOpen((o) => !o)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] transition cursor-pointer"
            title={t('common:buttons.more', 'More Options')}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {overflowOpen && (
            <div
              className="absolute right-0 mt-1.5 w-52 rounded-xl overflow-hidden shadow-2xl z-50 border py-1"
              style={{
                backgroundColor: 'var(--popover-bg)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              {/* Refresh Telemetry */}
              <button
                onClick={() => { onRefresh(); setOverflowOpen(false); }}
                disabled={(!selectedDevice && !activeProfile) || isRefreshing}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-300 hover:text-slate-100 hover:bg-white/[0.06] transition disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                <span>{t('common:buttons.refresh', 'Refresh Telemetry')}</span>
              </button>

              <div className="my-1 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

              {/* Language Switcher Section */}
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Languages className="w-3 h-3 text-slate-400" />
                <span>{t('common:language.label', 'Language')}</span>
              </div>

              <button
                type="button"
                onClick={() => { setAppLanguage('en'); setOverflowOpen(false); }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100 hover:bg-white/[0.06] transition cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 font-semibold">EN</span>
                  <span>{t('common:language.en', 'English')}</span>
                </div>
                {currentLang === 'en' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </button>

              <button
                type="button"
                onClick={() => { setAppLanguage('fr'); setOverflowOpen(false); }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100 hover:bg-white/[0.06] transition cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 font-semibold">FR</span>
                  <span>{t('common:language.fr', 'Français')}</span>
                </div>
                {currentLang === 'fr' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
});
