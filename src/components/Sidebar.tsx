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
  Plug,
  Loader2,
  Info,
  Cpu,
} from 'lucide-react';
import { DiscoveredDevice, UnlockStage } from '../lib/types';
import { UpsedLogo } from './UpsedLogo';

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  devices: DiscoveredDevice[];
  selectedDevice: string | null;
  activeDeviceLabel: string | null;
  activeTransport?: 'usb' | 'websocket' | null;
  isStreaming?: boolean;
  onSelectDevice: (port: string) => void;
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
  devices,
  selectedDevice,
  activeDeviceLabel,
  activeTransport,
  isStreaming,
  onSelectDevice,
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

  const activeDevice = devices.find((d) => d.port_name === selectedDevice);

  // Badge: red for critical, amber for warning-only
  const badgeCount = criticalCount > 0 ? criticalCount : warningCount;
  const badgeColor  = criticalCount > 0
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

  return (
    <aside
      className="w-60 flex flex-col h-screen select-none shrink-0"
      style={{ backgroundColor: 'var(--sidebar-bg)' }}
    >
      {/* ── Brand ───────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-4 flex items-center">
        <UpsedLogo size="lg" className="text-slate-100" />
      </div>

      {/* ── UPS Device Dropdown ──────────────────────────────── */}
      <div className="px-3 pb-4" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition group"
          style={{
            backgroundColor: 'var(--card-bg)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <div
              className={`w-2 h-2 rounded-full shrink-0 transition ${
                activeDevice || isStreaming ? 'bg-emerald-400' : 'bg-slate-600'
              }`}
            />
            <div className="flex items-center space-x-1.5 min-w-0">
              <span className="text-slate-200 font-medium text-xs truncate">
                {activeDeviceLabel ?? t('nav:device.noDevice', 'No device connected')}
              </span>
              {activeTransport === 'websocket' && (
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-700/50 shrink-0">
                  Wi-Fi
                </span>
              )}
              {activeTransport === 'usb' && (
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 shrink-0">
                  USB
                </span>
              )}
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
            className="mt-1.5 rounded-xl overflow-hidden shadow-2xl border"
            style={{
              backgroundColor: 'var(--popover-bg)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {/* Scan row */}
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                {t('nav:device.discoveredPorts', 'Available Interfaces')}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onScan(); }}
                disabled={isScanning}
                className="p-1 rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-700/50 transition disabled:opacity-50 cursor-pointer"
                title={t('nav:device.scanTitle', 'Scan for UPS devices')}
              >
                {isScanning
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Search  className="w-3.5 h-3.5" />
                }
              </button>
            </div>

            {/* Device list */}
            <div className="max-h-48 overflow-y-auto py-1">
              {devices.length === 0 ? (
                <p className="text-xs text-slate-500 italic px-3 py-2.5">
                  {t('nav:device.noUpsFound', 'No UPS found. Click scan to discover.')}
                </p>
              ) : (
                devices.map((dev) => {
                  const isWs = dev.port_name.startsWith('BRIDGE:WS:') || (activeTransport === 'websocket' && selectedDevice === dev.port_name);
                  const isBridge = dev.port_name.startsWith('BRIDGE:');
                  return (
                    <button
                      key={dev.port_name}
                      onClick={() => { onSelectDevice(dev.port_name); setDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between text-xs transition ${
                        selectedDevice === dev.port_name
                          ? 'bg-cyan-950/60 text-cyan-300'
                          : 'text-slate-300 hover:bg-white/[0.04] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Plug className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="font-mono truncate">{dev.port_name}</span>
                        {isWs ? (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60 shrink-0 font-sans">
                            Wi-Fi
                          </span>
                        ) : isBridge ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 shrink-0 font-sans font-bold uppercase">
                            Bridge
                          </span>
                        ) : null}
                      </div>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ml-2 text-slate-400"
                        style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                      >
                        {dev.capabilities.protocol_id}
                      </span>
                    </button>
                  );
                })
              )}
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
