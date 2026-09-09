import React from 'react';
import {
  Activity,
  Sliders,
  Wrench,
  History,
  Settings,
  Shield,
  Search,
  Plug,
  CheckCircle2,
} from 'lucide-react';
import { DiscoveredDevice, UnlockStage } from '../lib/types';

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  devices: DiscoveredDevice[];
  selectedDevice: string | null;
  onSelectDevice: (port: string) => void;
  onScan: () => void;
  isScanning: boolean;
  safetyStage: UnlockStage;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  devices,
  selectedDevice,
  onSelectDevice,
  onScan,
  isScanning,
  safetyStage,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'control', label: 'Hardware Control', icon: Sliders },
    { id: 'config', label: 'Configuration', icon: Wrench },
    { id: 'history', label: 'History & Events', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const getStageBadgeColor = (stage: UnlockStage) => {
    switch (stage) {
      case 'T1ReadOnly':
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-700/50';
      case 'T2NonDestructive':
        return 'bg-blue-950/80 text-blue-400 border-blue-700/50';
      case 'T3ConfigWrite':
        return 'bg-amber-950/80 text-amber-400 border-amber-700/50';
      case 'T4PowerControl':
        return 'bg-rose-950/80 text-rose-400 border-rose-700/50';
    }
  };

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800 flex items-center space-x-3">
        <div className="p-2 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-xl shadow-lg shadow-cyan-900/30">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-slate-100 tracking-tight">
            VoltWatch
          </h1>
          <p className="text-xs text-slate-400 font-mono">UPS Native Core</p>
        </div>
      </div>

      {/* Connected Devices (Multi-UPS Tree) */}
      <div className="p-4 border-b border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Connected Devices
          </span>
          <button
            onClick={onScan}
            disabled={isScanning}
            className="p-1 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition disabled:opacity-50"
            title="Scan for UPS devices on serial ports"
          >
            <Search className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-1 max-h-32 overflow-y-auto">
          {devices.length === 0 ? (
            <div className="text-xs text-slate-500 italic p-2 bg-slate-950/50 rounded border border-slate-800/50">
              No UPS connected. Click scan to discover.
            </div>
          ) : (
            devices.map((dev) => (
              <button
                key={dev.port_name}
                onClick={() => onSelectDevice(dev.port_name)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center justify-between transition ${
                  selectedDevice === dev.port_name
                    ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-700/60'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <Plug className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                  <span className="truncate">{dev.port_name}</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  {dev.capabilities.protocol_id}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                isActive
                  ? 'bg-blue-600/15 text-cyan-400 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Safety Gate Status Banner */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">Safety Gate</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-center ${getStageBadgeColor(
            safetyStage
          )}`}
        >
          {safetyStage === 'T1ReadOnly' && 'Stage T1: Read-Only'}
          {safetyStage === 'T2NonDestructive' && 'Stage T2: Non-Destructive'}
          {safetyStage === 'T3ConfigWrite' && 'Stage T3: Config Write'}
          {safetyStage === 'T4PowerControl' && 'Stage T4: Power Control'}
        </div>
        <p className="text-[10px] text-slate-500 mt-1 text-center">
          Firmware protection active
        </p>
      </div>
    </aside>
  );
};
