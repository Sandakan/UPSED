import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Sliders,
  Wrench,
  History,
  Settings,
  Search,
  ChevronDown,
  CheckCircle2,
  Bell,
  Loader2,
  Info,
  Cpu,
  Star,
  Plus,
} from 'lucide-react';
import { DiscoveredDevice, UnlockStage, UpsMetadata, Q1Status } from '../lib/types';
import { UpsedLogo } from './UpsedLogo';
import { TransportPill, DeviceStatePill, getTransportMedium, getUpsOperatingState } from './DevicePills';

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  profiles: UpsMetadata[];
  selectedUpsId: string | null;
  activeProfile: UpsMetadata | null;
  activeDevice: DiscoveredDevice | null;
  activeStatus: Q1Status | null;
  deviceStatuses: Record<string, Q1Status>;
  onSelectUps: (upsId: string) => void;
  onOpenConnectModal: () => void;
  onScan: () => void;
  isScanning: boolean;
  safetyStage: UnlockStage;
  criticalCount: number;
  warningCount: number;
  onOpenAbout?: () => void;
}

const NAV_GROUPS = [
  {
    id: 'monitoring',
    label: 'MONITORING',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: Activity },
      { id: 'control',   label: 'Hardware Control', icon: Sliders },
    ],
  },
  {
    id: 'control',
    label: 'CONTROL',
    items: [
      { id: 'config',   label: 'Configuration',   icon: Wrench  },
      { id: 'history',  label: 'History & Graphs', icon: History },
      { id: 'iot',      label: 'IoT Bridge',       icon: Cpu     },
    ],
  },
];

const getStageBadgeStyle = (stage: UnlockStage) => {
  switch (stage) {
    case 'T1ReadOnly':       return 'bg-emerald-950/80 text-emerald-400 border-emerald-700/40';
    case 'T2NonDestructive': return 'bg-blue-950/80    text-blue-400    border-blue-700/40';
    case 'T3ConfigWrite':    return 'bg-amber-950/80   text-amber-400   border-amber-700/40';
    case 'T4PowerControl':   return 'bg-rose-950/80    text-rose-400    border-rose-700/40';
  }
};

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  profiles,
  selectedUpsId,
  activeProfile,
  activeDevice,
  activeStatus,
  deviceStatuses,
  onSelectUps,
  onOpenConnectModal,
  onScan,
  isScanning,
  safetyStage,
  criticalCount,
  warningCount,
  onOpenAbout,
}) => {
  const { t } = useTranslation(['nav', 'common']);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getStageLabel = (stage: UnlockStage) => {
    switch (stage) {
      case 'T1ReadOnly':       return t('common:stages.t1.badge', 'T1 · Read-Only');
      case 'T2NonDestructive': return t('common:stages.t2.badge', 'T2 · Diagnostic');
      case 'T3ConfigWrite':    return t('common:stages.t3.badge', 'T3 · Config Write');
      case 'T4PowerControl':   return t('common:stages.t4.badge', 'T4 · Power Control');
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Badge: red for critical, amber for warning-only
  const badgeCount = criticalCount > 0 ? criticalCount : warningCount;
  const badgeColor = criticalCount > 0
    ? 'bg-rose-500 text-white'
    : 'bg-amber-500 text-black';

  const navItemStyle = (isActive: boolean) =>
    isActive
      ? {
          backgroundColor: 'var(--surface-active)',
          border: '1px solid var(--border-active)',
        }
      : {
          border: '1px solid transparent',
        };

  // Current active UPS status & transport
  const activeMedium = getTransportMedium(activeDevice?.port_name || activeProfile?.last_port);
  const activeOperatingState = getUpsOperatingState(activeStatus);

  return (
    <aside
      className="w-64 flex flex-col h-screen select-none shrink-0"
      style={{ backgroundColor: 'var(--sidebar-bg)' }}
    >
      {/* ── Brand ───────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-4 flex items-center">
        <UpsedLogo size="lg" className="text-slate-100" />
      </div>

      {/* ── Master UPS Device Dropdown ──────────────────────── */}
      <div className="px-3 pb-3" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition group text-left cursor-pointer"
          style={{
            backgroundColor: 'var(--card-bg)',
            border: '1px solid var(--border-subtle)',
          }}
          title={activeProfile ? `${activeProfile.name} (${activeProfile.unique_id})` : undefined}
        >
          <div className="flex flex-col min-w-0 pr-2">
            <div className="flex items-center space-x-1.5 min-w-0">
              {activeProfile?.is_primary && (
                <span title="Primary Master UPS" className="inline-flex shrink-0">
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                </span>
              )}
              <span className="text-slate-200 font-semibold text-xs truncate">
                {activeProfile?.name || activeDevice?.port_name || t('nav:device.noDevice', 'No UPS Selected')}
              </span>
            </div>

            {/* Dual status pills in dropdown trigger button */}
            <div className="flex items-center space-x-1.5 mt-1">
              <TransportPill transport={activeMedium} size="xs" />
              <DeviceStatePill state={activeOperatingState} size="xs" />
            </div>
          </div>

          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform duration-200 ${
              dropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Popover */}
        {dropdownOpen && (
          <div
            className="mt-1.5 rounded-xl overflow-hidden shadow-2xl border z-50 absolute left-3 w-60"
            style={{
              backgroundColor: 'var(--popover-bg)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {/* Header row */}
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                UPS Profiles
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onScan(); }}
                disabled={isScanning}
                className="p-1 rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-700/50 transition disabled:opacity-50 cursor-pointer"
                title="Scan for hardware"
              >
                {isScanning
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Search  className="w-3.5 h-3.5" />
                }
              </button>
            </div>

            {/* Profiles list */}
            <div className="max-h-56 overflow-y-auto py-1 custom-scrollbar">
              {profiles.length === 0 ? (
                <div className="p-3 text-center space-y-1">
                  <p className="text-xs text-slate-400 italic">No UPS profiles saved.</p>
                  <p className="text-[10px] text-slate-500">Connect a UPS to set up monitoring.</p>
                </div>
              ) : (
                profiles.map((p) => {
                  const isSelected = selectedUpsId === p.unique_id;
                  const profileStatus = deviceStatuses[p.unique_id] || (isSelected ? activeStatus : null);
                  const pMedium = getTransportMedium(p.last_port);
                  const pState = getUpsOperatingState(profileStatus);

                  return (
                    <button
                      key={p.unique_id}
                      onClick={() => {
                        onSelectUps(p.unique_id);
                        setDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 transition flex flex-col space-y-1 cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-950/60 text-cyan-300 border-l-2 border-cyan-400'
                          : 'text-slate-300 hover:bg-white/[0.04] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between min-w-0">
                        <div className="flex items-center space-x-1.5 min-w-0">
                          {p.is_primary && (
                            <span title="Primary UPS" className="inline-flex shrink-0">
                              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                            </span>
                          )}
                          <span className="font-medium text-xs truncate text-slate-200">
                            {p.name}
                          </span>
                        </div>
                        {isSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                        )}
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <TransportPill transport={pMedium} size="xs" />
                        <DeviceStatePill state={pState} size="xs" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer: Add / Detect UPS Action */}
            <div
              className="p-2 border-t"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'rgba(0,0,0,0.2)' }}
            >
              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  onOpenConnectModal();
                }}
                className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded-lg text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 border border-emerald-700/40 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add / Detect UPS</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Divider ─────────────────────────────────────────── */}
      <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '0 12px' }} />

      {/* ── Main Navigation ──────────────────────────────────── */}
      <nav className="flex-1 px-3 py-3 space-y-5 overflow-y-auto sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.id}>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-3 mb-1.5 select-none">
              {t(`nav:groups.${group.id}`, group.label)}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'text-white'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.04]'
                    }`}
                    style={navItemStyle(isActive)}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}
                    />
                    <span>{t(`nav:items.${item.id}`, item.label)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Divider ─────────────────────────────────────────── */}
      <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '0 12px' }} />

      {/* ── Footer Nav: Events + Settings ───────────────────── */}
      <div className="px-3 py-3 space-y-1">
        {/* Events */}
        {(() => {
          const isActive = currentTab === 'events';
          return (
            <button
              onClick={() => onTabChange('events')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? 'text-white'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.04]'
              }`}
              style={navItemStyle(isActive)}
            >
              <div className="flex items-center space-x-3">
                <Bell
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}
                />
                <span>{t('nav:items.events', 'Events')}</span>
              </div>
              {badgeCount > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none ${badgeColor}`}
                >
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </button>
          );
        })()}

        {/* Settings */}
        {(() => {
          const isActive = currentTab === 'settings';
          return (
            <button
              onClick={() => onTabChange('settings')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? 'text-white'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.04]'
              }`}
              style={navItemStyle(isActive)}
            >
              <Settings
                className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}
              />
              <span>{t('nav:items.settings', 'Settings')}</span>
            </button>
          );
        })()}

        {/* About Modal Trigger */}
        {onOpenAbout && (
          <button
            type="button"
            onClick={onOpenAbout}
            className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer text-slate-300 hover:text-white hover:bg-white/[0.04]"
            style={navItemStyle(false)}
          >
            <Info className="w-4 h-4 shrink-0 text-slate-400" />
            <span>{t('nav:items.about', 'About')}</span>
          </button>
        )}
      </div>

      {/* ── Safety Gate ─────────────────────────────────────── */}
      <div
        className="px-3 py-2"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
            {t('nav:safetyGate.title', 'Safety Gate')}
          </span>
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        </div>
        <div
          className={`px-2 py-0.5 rounded-md border text-[10.5px] font-medium text-center ${getStageBadgeStyle(safetyStage)}`}
        >
          {getStageLabel(safetyStage)}
        </div>
      </div>
    </aside>
  );
};
