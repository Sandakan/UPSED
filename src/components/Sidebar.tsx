import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Sliders,
  Wrench,
  History,
  Settings,
  Bell,
  CheckCircle2,
  Info,
  Cpu,
} from 'lucide-react';
import { UnlockStage } from '../lib/types';
import { UpsedLogo } from './UpsedLogo';

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
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
  safetyStage,
  criticalCount,
  warningCount,
  onOpenAbout,
}) => {
  const { t } = useTranslation(['nav', 'common']);

  const getStageLabel = (stage: UnlockStage) => {
    switch (stage) {
      case 'T1ReadOnly':       return t('common:stages.t1.badge', 'T1 · Read-Only');
      case 'T2NonDestructive': return t('common:stages.t2.badge', 'T2 · Diagnostic');
      case 'T3ConfigWrite':    return t('common:stages.t3.badge', 'T3 · Config Write');
      case 'T4PowerControl':   return t('common:stages.t4.badge', 'T4 · Power Control');
    }
  };

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

  return (
    <aside
      className="w-64 flex flex-col h-screen select-none shrink-0"
      style={{ backgroundColor: 'var(--sidebar-bg)' }}
    >
      {/* ── Brand ───────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-3 flex items-center">
        <UpsedLogo size="lg" className="text-slate-100" />
      </div>

      {/* ── Main Navigation ──────────────────────────────────── */}
      <nav className="flex-1 px-3 py-2 space-y-5 overflow-y-auto sidebar-nav">
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
