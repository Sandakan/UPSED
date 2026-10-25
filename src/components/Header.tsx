import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  Plus,
  MoreHorizontal,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Languages,
  Check,
  Star,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
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
  onRefresh: (forceRefresh?: boolean) => void;
  isRefreshing: boolean;
  lastUpdatedAt?: number;
  safetyStage: UnlockStage;
  onTabChange: (tab: string) => void;
  onOpenAddDeviceModal: () => void;
  profiles?: UpsMetadata[];
  deviceStatuses?: Record<string, Q1Status>;
  onSelectUps?: (upsId: string) => void;
  onScan?: () => void;
  isScanning?: boolean;
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

export const Header: React.FC<HeaderProps> = React.memo(({
  currentTab,
  selectedUpsId,
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
  safetyStage: _safetyStage,
  onTabChange,
  onOpenAddDeviceModal,
  profiles,
  deviceStatuses,
  onSelectUps,
  onScan,
  isScanning,
}) => {
  const { t, i18n } = useTranslation(['common', 'nav', 'modals']);
  const auth = useAuth();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pageLabel = t(`nav:items.${currentTab}`, { defaultValue: PAGE_LABELS[currentTab] ?? currentTab });

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
      {/* ── Left: Page Title & Interactive Master UPS Picker ─────── */}
      <div className="flex items-center space-x-3 text-sm min-w-0 shrink mr-2">
        <span className="text-slate-200 font-bold truncate">{pageLabel}</span>

        {/* Master UPS Dropdown Trigger */}
        <div className="relative pl-3 border-l border-white/[0.08]" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center space-x-2 px-2.5 py-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] transition text-left cursor-pointer group select-none"
            title={activeProfile ? `${activeProfile.name} (${activeProfile.unique_id})` : undefined}
          >
            <div className="flex items-center space-x-1.5 text-xs text-slate-300 font-medium min-w-0">
              {activeProfile?.is_primary && (
                <span title="Primary Master UPS" className="inline-flex shrink-0">
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                </span>
              )}
              <span className="font-semibold text-white truncate max-w-[120px] sm:max-w-[160px] md:max-w-[200px]">
                {activeProfile?.name || t('nav:device.noDevice', 'No UPS Selected')}
              </span>
            </div>

            <TransportPill transport={transport} ip={transportIp} size="sm" />
            <DeviceStatePill state={operatingState} size="sm" />

            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
                pickerOpen ? 'rotate-180 text-white' : 'group-hover:text-slate-200'
              }`}
            />
          </button>

          {/* Unified Picker Popover */}
          {pickerOpen && (
            <div
              className="mt-2 rounded-2xl overflow-hidden shadow-2xl border z-50 absolute left-3 w-72 sm:w-80 animate-in fade-in duration-150"
              style={{
                backgroundColor: 'var(--popover-bg, #161d2b)',
                borderColor: 'var(--border-subtle, rgba(255,255,255,0.08))',
              }}
            >
              {/* Header: Title + Scan / Recheck Action */}
              <div
                className="flex items-center justify-between px-3.5 py-2.5 bg-black/20"
                style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))' }}
              >
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                    Connected UPS Devices
                  </span>
                  {profiles && profiles.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/[0.06] text-slate-400">
                      {profiles.length}
                    </span>
                  )}
                </div>

                {onScan && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onScan();
                    }}
                    disabled={isScanning}
                    className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-cyan-300 hover:bg-white/[0.06] transition disabled:opacity-50 cursor-pointer"
                    title="Scan for hardware"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-cyan-400' : ''}`} />
                    <span className="text-[11px]">{isScanning ? 'Scanning...' : 'Recheck'}</span>
                  </button>
                )}
              </div>

              {/* Profiles List */}
              <div className="max-h-60 overflow-y-auto py-1.5 custom-scrollbar space-y-0.5">
                {!profiles || profiles.length === 0 ? (
                  <div className="p-4 text-center space-y-1.5">
                    <p className="text-xs text-slate-400 italic">No UPS profiles detected.</p>
                    <p className="text-[11px] text-slate-500">Connect a UPS to set up real-time monitoring.</p>
                  </div>
                ) : (
                  profiles.map((p) => {
                    const isSelected = selectedUpsId === p.unique_id;
                    const profileStatus = (deviceStatuses && deviceStatuses[p.unique_id]) || (isSelected ? activeStatus : null);
                    const pMedium = getTransportMedium(p.last_port);
                    const pState = getUpsOperatingState(profileStatus);

                    return (
                      <button
                        key={p.unique_id}
                        onClick={() => {
                          if (onSelectUps) {
                            onSelectUps(p.unique_id);
                          }
                          setPickerOpen(false);
                        }}
                        className={`w-full text-left px-3.5 py-2.5 transition flex flex-col space-y-1 cursor-pointer border-l-2 ${
                          isSelected
                            ? 'bg-cyan-950/40 text-cyan-300 border-cyan-400'
                            : 'border-transparent text-slate-300 hover:bg-white/[0.04] hover:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between min-w-0">
                          <div className="flex items-center space-x-1.5 min-w-0">
                            {p.is_primary && (
                              <span title="Primary UPS" className="inline-flex shrink-0">
                                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                              </span>
                            )}
                            <span className="font-semibold text-xs truncate text-slate-100">
                              {p.name}
                            </span>
                            {p.rated_va && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                ({p.rated_va}VA)
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 ml-1.5" />
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <TransportPill transport={pMedium} size="xs" />
                          <DeviceStatePill state={pState} size="xs" />
                          {p.last_port && (
                            <span className="text-[10px] font-mono text-slate-500 truncate max-w-[120px]">
                              {p.last_port}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer: Recheck Hardware & Add Device Actions */}
              <div
                className="p-2.5 border-t bg-black/30 space-y-1.5"
                style={{ borderColor: 'var(--border-subtle, rgba(255,255,255,0.08))' }}
              >
                {onScan && (
                  <button
                    type="button"
                    onClick={() => onScan()}
                    disabled={isScanning}
                    className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-cyan-400' : ''}`} />
                    <span>{isScanning ? 'Scanning Interfaces...' : 'Recheck Connected Hardware'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen(false);
                    onOpenAddDeviceModal();
                  }}
                  className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded-xl text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 border border-emerald-700/40 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Connect Another UPS Device</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Actions ────────────────────────────────── */}
      <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
        {/* Security / Auth Status Pill */}
        {auth.status?.authenticated ? (
          <button
            type="button"
            onClick={() => auth.logout()}
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-indigo-950/80 text-indigo-300 border-indigo-700/50 hover:bg-indigo-900/60 transition cursor-pointer"
            title={`Authenticated as ${auth.status.username}. Click to log out.`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-mono">{auth.status.username}</span>
            <span className="text-[10px] text-indigo-400 font-normal opacity-80">· Log Out</span>
          </button>
        ) : !auth.status?.configured && !auth.status?.os_auth_available ? (
          <button
            type="button"
            onClick={() => auth.openLoginModal()}
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-amber-950/80 text-amber-300 border-amber-700/50 hover:bg-amber-900/60 transition cursor-pointer"
            title="Administrator credentials not configured. Click to initialize."
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>Setup Required</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => auth.requireAuth(() => {}, 'Unlock UPSED Hardware Operations')}
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-slate-900/80 text-slate-300 border-white/[0.1] hover:bg-white/[0.06] transition cursor-pointer"
            title="Write commands protected. Click to unlock."
          >
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Protected · Unlock</span>
          </button>
        )}

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
        <LastUpdatedTimer
          lastUpdatedAt={lastUpdatedAt}
          selectedDevice={selectedUpsId || activeProfile?.unique_id || selectedDevice || activeDevice?.port_name || null}
        />

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
                onClick={() => { onRefresh(true); setOverflowOpen(false); }}
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
