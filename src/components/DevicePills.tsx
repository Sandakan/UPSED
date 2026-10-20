import React from 'react';
import { Wifi, Usb, Cpu, Plug, HelpCircle } from 'lucide-react';
import { Q1Status, TransportMedium, UpsOperatingState } from '../lib/types';

export function getUpsOperatingState(status?: Q1Status | null): UpsOperatingState {
  if (!status) return 'Offline';
  if (status.ups_failed) return 'Fault';
  if (status.test_in_progress) return 'Testing';
  if (status.bypass_active) return 'Bypass';
  if (status.utility_fail) return 'Battery';
  return 'Online';
}

export function getTransportMedium(
  portName?: string | null,
  activeTransport?: 'usb' | 'websocket' | null
): TransportMedium {
  if (!portName) return 'unknown';
  if (portName.startsWith('BRIDGE:WS:') || activeTransport === 'websocket') return 'wifi';
  if (portName.startsWith('BRIDGE:')) return 'bridge';
  if (portName.startsWith('USB:') || activeTransport === 'usb') return 'usb';
  if (portName.startsWith('COM') || portName.startsWith('/dev/tty') || portName.startsWith('tty')) return 'serial';
  return 'unknown';
}

interface TransportPillProps {
  transport: TransportMedium;
  ip?: string | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const TransportPill: React.FC<TransportPillProps> = ({
  transport,
  ip,
  size = 'xs',
  className = '',
}) => {
  const sizeClasses = {
    xs: 'text-[9px] px-1.5 py-0.5 gap-1',
    sm: 'text-[10px] px-2 py-0.5 gap-1.5',
    md: 'text-[11px] px-2.5 py-1 gap-1.5',
  }[size];

  const iconSizes = {
    xs: 'w-2.5 h-2.5',
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
  }[size];

  switch (transport) {
    case 'wifi':
      return (
        <span
          className={`inline-flex items-center font-bold uppercase tracking-wider rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-700/50 shrink-0 ${sizeClasses} ${className}`}
          title={ip ? `Connected wirelessly via WebSocket (${ip})` : 'Connected wirelessly via WebSocket'}
        >
          <Wifi className={iconSizes} />
          <span>Wi-Fi</span>
        </span>
      );
    case 'usb':
      return (
        <span
          className={`inline-flex items-center font-bold uppercase tracking-wider rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 shrink-0 ${sizeClasses} ${className}`}
          title="Direct USB HID / CDC Serial"
        >
          <Usb className={iconSizes} />
          <span>USB</span>
        </span>
      );
    case 'bridge':
      return (
        <span
          className={`inline-flex items-center font-bold uppercase tracking-wider rounded-full bg-teal-950/80 text-teal-400 border border-teal-700/50 shrink-0 ${sizeClasses} ${className}`}
          title="ESP32 Hardware Bridge (USB Serial)"
        >
          <Cpu className={iconSizes} />
          <span>Bridge</span>
        </span>
      );
    case 'serial':
      return (
        <span
          className={`inline-flex items-center font-bold uppercase tracking-wider rounded-full bg-indigo-950/80 text-indigo-400 border border-indigo-700/50 shrink-0 ${sizeClasses} ${className}`}
          title="Direct Serial RS-232 / COM Port"
        >
          <Plug className={iconSizes} />
          <span>Serial</span>
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center font-semibold rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/50 shrink-0 ${sizeClasses} ${className}`}
          title="Disconnected / Offline Interface"
        >
          <HelpCircle className={iconSizes} />
          <span>Port</span>
        </span>
      );
  }
};

interface DeviceStatePillProps {
  state: UpsOperatingState;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const DeviceStatePill: React.FC<DeviceStatePillProps> = ({
  state,
  size = 'xs',
  className = '',
}) => {
  const sizeClasses = {
    xs: 'text-[9px] px-1.5 py-0.5 gap-1',
    sm: 'text-[10px] px-2 py-0.5 gap-1.5',
    md: 'text-[11px] px-2.5 py-1 gap-1.5',
  }[size];

  const dotSizes = {
    xs: 'w-1.5 h-1.5',
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
  }[size];

  switch (state) {
    case 'Online':
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 shrink-0 ${sizeClasses} ${className}`}
        >
          <span className={`${dotSizes} rounded-full bg-emerald-400 shrink-0`} />
          <span>Online</span>
        </span>
      );
    case 'Battery':
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/50 shrink-0 ${sizeClasses} ${className}`}
        >
          <span className={`${dotSizes} rounded-full bg-amber-400 animate-pulse shrink-0`} />
          <span>On Battery</span>
        </span>
      );
    case 'Bypass':
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-sky-950/80 text-sky-300 border border-sky-700/50 shrink-0 ${sizeClasses} ${className}`}
        >
          <span className={`${dotSizes} rounded-full bg-sky-400 shrink-0`} />
          <span>Bypass</span>
        </span>
      );
    case 'Testing':
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-purple-950/80 text-purple-300 border border-purple-700/50 shrink-0 ${sizeClasses} ${className}`}
        >
          <span className={`${dotSizes} rounded-full bg-purple-400 animate-ping shrink-0`} />
          <span>Testing</span>
        </span>
      );
    case 'Fault':
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-rose-950/80 text-rose-300 border border-rose-700/50 shrink-0 ${sizeClasses} ${className}`}
        >
          <span className={`${dotSizes} rounded-full bg-rose-400 animate-pulse shrink-0`} />
          <span>Fault</span>
        </span>
      );
    case 'Offline':
    default:
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/50 shrink-0 ${sizeClasses} ${className}`}
        >
          <span className={`${dotSizes} rounded-full bg-slate-500 shrink-0`} />
          <span>Offline</span>
        </span>
      );
  }
};
