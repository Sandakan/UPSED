import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu,
  Wifi,
  WifiOff,
  Usb,
  RefreshCw,
  Database,
  Terminal,
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Copy,
  Trash2,
  Radio,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Signal,
  SignalLow,
  SignalMedium,
  SignalHigh,
  Clock,
  HardDrive,
  Send,
  Zap,
  Globe,
  Share2,
  RotateCcw,
  Download,
  UploadCloud,
  FileCode,
  ShieldCheck,
  Check,
  FileText,
  History,
  X,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sliders,
  Users,
  Moon,
  Sun,
} from 'lucide-react';
import { marked } from 'marked';
import * as XLSX from 'xlsx';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { listen } from '@tauri-apps/api/event';
import { api } from '../lib/tauri';
import {
  BridgeStatus,
  BridgeLogEntry,
  WifiScanNetwork,
  WsTestResult,
  WifiProvisionStatusEvent,
  BridgeFirmwareCheckResult,
  OtaProgressEvent,
  TuyaBridgeConfig,
  BridgeCmdExecutedEvent,
  BridgeIlluminationConfig,
} from '../lib/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../lib/auth';

export interface IoTProps {
  portName?: string | null;
  upsId?: string | null;
  pollInterval?: number;
}

const BridgeLedGuide: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  const LED_STATES = [
    {
      color: 'bg-emerald-400',
      shadow: 'shadow-[0_0_10px_#34d399]',
      pattern: 'Solid Green (Blue tick)',
      title: 'Proxy Mode · UPSED Connected',
      desc: 'Normal operation. AC grid is healthy, exchanging real-time telemetry with UPSED (brief 60ms Blue flash on each poll).',
      badge: 'Normal',
      badgeClass: 'bg-emerald-950/60 text-emerald-400 border-emerald-700/40',
    },
    {
      color: 'bg-cyan-400 animate-pulse',
      shadow: 'shadow-[0_0_10px_#22d3ee]',
      pattern: 'Breathing Cyan (2.4s pulse)',
      title: 'Standalone Logging · PSRAM Active',
      desc: 'Wi-Fi is connected, but UPSED desktop is offline. Bridge is autonomously buffering telemetry to 8MB PSRAM ring buffer.',
      badge: 'Buffering',
      badgeClass: 'bg-cyan-950/60 text-cyan-400 border-cyan-700/40',
    },
    {
      color: 'bg-rose-600 animate-pulse',
      shadow: 'shadow-[0_0_12px_#e11d48]',
      pattern: 'Pulsing Alert Red (700ms)',
      title: 'Power Outage · Running on Battery',
      desc: 'CRITICAL: Utility Fail bit detected. AC grid power is lost and UPS inverter is supplying power from battery.',
      badge: 'On Battery',
      badgeClass: 'bg-rose-950/60 text-rose-400 border-rose-700/40',
    },
    {
      color: 'bg-amber-400 animate-pulse',
      shadow: 'shadow-[0_0_10px_#f59e0b]',
      pattern: 'Pulsing Yellow (1.5s pulse)',
      title: 'UPS RS-232 Port Offline / NAK',
      desc: 'Bridge is running, but the UPS RS-232 communication cable is disconnected, or the UPS is returning NAK.',
      badge: 'UPS Offline',
      badgeClass: 'bg-amber-950/60 text-amber-400 border-amber-700/40',
    },
    {
      color: 'bg-amber-500 animate-ping',
      shadow: 'shadow-[0_0_10px_#f59e0b]',
      pattern: 'Pulsing Amber (900ms pulse)',
      title: 'Wi-Fi Connecting / Associating',
      desc: 'Bridge is actively associating with the configured 2.4GHz Wi-Fi access point and waiting for DHCP IP assignment.',
      badge: 'Connecting',
      badgeClass: 'bg-amber-950/60 text-amber-400 border-amber-700/40',
    },
    {
      color: 'bg-rose-500 animate-bounce',
      shadow: 'shadow-[0_0_10px_#f43f5e]',
      pattern: 'Fast Double-Blink Red (1.2s)',
      title: 'Wi-Fi Auth Error (AUTH_FAIL)',
      desc: 'Incorrect Wi-Fi password (AUTH_FAIL) or router AP rejected connection (Reason 202). Check network credentials.',
      badge: 'Auth Error',
      badgeClass: 'bg-rose-950/60 text-rose-400 border-rose-700/40',
    },
    {
      color: 'bg-amber-600 animate-pulse',
      shadow: 'shadow-[0_0_10px_#d97706]',
      pattern: 'Slow Blinking Amber (1s cycle)',
      title: 'Wi-Fi Disconnected / Retrying',
      desc: 'Bridge disconnected from Wi-Fi access point. Performing periodic automatic reconnect attempts every 30 seconds.',
      badge: 'Wi-Fi Down',
      badgeClass: 'bg-amber-950/60 text-amber-500 border-amber-700/40',
    },
    {
      color: 'bg-fuchsia-500 animate-ping',
      shadow: 'shadow-[0_0_10px_#d946ef]',
      pattern: 'Blinking Magenta (200ms cycle)',
      title: 'OTA Authenticating / Lease Staged',
      desc: 'ArduinoOTA UDP invite/handshake received or 90-second HTTP OTA lease active on port 8080 awaiting upload token.',
      badge: 'OTA Auth',
      badgeClass: 'bg-fuchsia-950/60 text-fuchsia-300 border-fuchsia-700/40',
    },
    {
      color: 'bg-fuchsia-400 animate-pulse',
      shadow: 'shadow-[0_0_12px_#e879f9]',
      pattern: 'Pulsing Magenta (800ms wave)',
      title: 'Wireless Firmware Streaming',
      desc: 'Active firmware streaming and flash write in progress over Wi-Fi (ArduinoOTA port 3232 or HTTP port 8080). LED refreshes on each chunk.',
      badge: 'OTA Flashing',
      badgeClass: 'bg-fuchsia-950/60 text-fuchsia-400 border-fuchsia-700/40',
    },
    {
      color: 'bg-emerald-500',
      shadow: 'shadow-[0_0_12px_#10b981]',
      pattern: 'Solid Green Flash (250ms)',
      title: 'OTA Flashing Complete · Rebooting',
      desc: 'Firmware binary committed cleanly to flash partition without checksum errors. Bridge is rebooting into new firmware.',
      badge: 'Rebooting',
      badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/40',
    },
    {
      color: 'bg-purple-500 animate-pulse',
      shadow: 'shadow-[0_0_10px_#a855f7]',
      pattern: 'Periodic Violet Pulse (450ms)',
      title: 'Tuya Cloud Connecting / Syncing',
      desc: 'ESP32 is acquiring NTP time, resolving broker DNS, or establishing TLS handshake with TuyaLink Cloud (overlaid on base mode).',
      badge: 'Tuya Sync',
      badgeClass: 'bg-purple-950/60 text-purple-400 border-purple-700/40',
    },
    {
      color: 'bg-orange-500 animate-ping',
      shadow: 'shadow-[0_0_10px_#f97316]',
      pattern: 'Periodic Orange Double-Blink',
      title: 'Tuya Cloud Error / Auth Failure',
      desc: 'Tuya connection failed or credentials rejected (rc=4/5). Reconnecting with exponential backoff (overlaid on base mode).',
      badge: 'Tuya Fault',
      badgeClass: 'bg-orange-950/60 text-orange-400 border-orange-700/40',
    },
    {
      color: 'bg-emerald-200',
      shadow: 'shadow-[0_0_8px_#a7f3d0]',
      pattern: 'Momentary Mint Flash (80ms)',
      title: 'Tuya Telemetry Published',
      desc: 'Brief mint/white tick rendered each time a 19-DP telemetry snapshot report is successfully delivered to TuyaLink.',
      badge: 'Tuya Publish',
      badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/40',
    },
  ];

  return (
    <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 lg:col-span-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <Radio className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <h3 className="text-base font-semibold text-white">ESP32 Hardware Status LED Diagnostic Guide</h3>
            <p className="text-xs text-slate-400">Onboard WS2812 RGB LED color and blink pattern reference</p>
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition cursor-pointer"
        >
          {isExpanded ? 'Hide Guide' : 'View Status LED Guide'}
        </button>
      </div>

      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pt-4 mt-3 border-t border-white/[0.08]">
          {LED_STATES.map((st, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-xl border border-white/[0.06] bg-black/20 flex flex-col justify-between space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <span className={`w-3.5 h-3.5 rounded-full ${st.color} ${st.shadow} shrink-0`} />
                  <span className="text-xs font-semibold text-white">{st.pattern}</span>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${st.badgeClass}`}>
                  {st.badge}
                </span>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-200 mb-0.5">{st.title}</div>
                <div className="text-[11px] text-slate-400 leading-relaxed">{st.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface HardwareLedIlluminationCardProps {
  status: BridgeStatus | null;
  portName?: string | null;
  onStatusUpdate: (st: BridgeStatus | null) => void;
  onRefresh: () => Promise<void>;
}

const minToTime = (min?: number) => {
  if (min === undefined || min === null) return '00:00';
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const timeToMin = (timeStr: string) => {
  const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10));
  if (isNaN(h) || isNaN(m)) return 0;
  return ((h % 24) * 60 + (m % 60)) % 1440;
};

const HardwareLedIlluminationCard: React.FC<HardwareLedIlluminationCardProps> = ({
  status,
  portName,
  onStatusUpdate,
  onRefresh,
}) => {
  const auth = useAuth();
  const isAuthenticated = Boolean(auth.status?.authenticated);

  const [nightEnabled, setNightEnabled] = useState(status?.night_mode_enabled ?? true);
  const [nightType, setNightType] = useState<'dimmed' | 'off'>(
    (status?.night_mode_type as 'off' | 'dimmed') || 'dimmed'
  );
  const [nightDimPct, setNightDimPct] = useState(status?.night_dim_pct ?? 10);
  const [nightWakeAlert, setNightWakeAlert] = useState(status?.night_wake_alert ?? true);
  const [nightStartTime, setNightStartTime] = useState(minToTime(status?.night_start_min ?? 1320));
  const [nightEndTime, setNightEndTime] = useState(minToTime(status?.night_end_min ?? 420));

  const [stealthEnabled, setStealthEnabled] = useState(status?.proxy_stealth_enabled ?? true);
  const [stealthType, setStealthType] = useState<'dimmed' | 'off'>(
    (status?.proxy_stealth_type as 'off' | 'dimmed') || 'dimmed'
  );
  const [stealthDimPct, setStealthDimPct] = useState(status?.proxy_stealth_dim_pct ?? 10);

  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingNow, setIsTogglingNow] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!status || isDirty) return;
    setNightEnabled(status.night_mode_enabled ?? true);
    setNightType((status.night_mode_type as 'off' | 'dimmed') || 'dimmed');
    setNightDimPct(status.night_dim_pct ?? 10);
    setNightWakeAlert(status.night_wake_alert ?? true);
    setNightStartTime(minToTime(status.night_start_min ?? 1320));
    setNightEndTime(minToTime(status.night_end_min ?? 420));

    setStealthEnabled(status.proxy_stealth_enabled ?? true);
    setStealthType((status.proxy_stealth_type as 'off' | 'dimmed') || 'dimmed');
    setStealthDimPct(status.proxy_stealth_dim_pct ?? 10);
  }, [status, isDirty]);

  const handleReset = () => {
    if (!status) return;
    setNightEnabled(status.night_mode_enabled ?? true);
    setNightType((status.night_mode_type as 'off' | 'dimmed') || 'dimmed');
    setNightDimPct(status.night_dim_pct ?? 10);
    setNightWakeAlert(status.night_wake_alert ?? true);
    setNightStartTime(minToTime(status.night_start_min ?? 1320));
    setNightEndTime(minToTime(status.night_end_min ?? 420));

    setStealthEnabled(status.proxy_stealth_enabled ?? true);
    setStealthType((status.proxy_stealth_type as 'off' | 'dimmed') || 'dimmed');
    setStealthDimPct(status.proxy_stealth_dim_pct ?? 10);
    setIsDirty(false);
  };

  const handleToggleNightModeNow = async () => {
    setIsTogglingNow(true);
    try {
      let nextVal = 0;
      if (status?.night_override !== 0 && status?.night_override !== undefined) {
        nextVal = 0;
      } else if (status?.night_mode_active) {
        nextVal = -1;
      } else {
        nextVal = 1;
      }

      const updated = await api.toggleBridgeNightModeNow(nextVal, portName ?? undefined);
      onStatusUpdate(updated);
      await onRefresh();
      if (nextVal === 1) {
        toast.success('Bridge manual night mode activated');
      } else if (nextVal === -1) {
        toast.success('Bridge manual daylight mode activated');
      } else {
        toast.success('Bridge returned to automatic schedule');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTogglingNow(false);
    }
  };

  const handleSaveIllumination = async () => {
    await auth.requireAuth(async () => {
      setIsSaving(true);
      try {
        const config: BridgeIlluminationConfig = {
          night_enabled: nightEnabled,
          night_type: nightType,
          night_dim_pct: nightDimPct,
          night_wake_alert: nightWakeAlert,
          night_start_min: timeToMin(nightStartTime),
          night_end_min: timeToMin(nightEndTime),
          stealth_enabled: stealthEnabled,
          stealth_type: stealthType,
          stealth_dim_pct: stealthDimPct,
        };

        const updated = await api.configureBridgeIllumination(config, portName ?? undefined);
        onStatusUpdate(updated);
        await onRefresh();
        setIsDirty(false);
        toast.success('Hardware LED illumination policy saved to ESP32 NVS');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSaving(false);
      }
    }, 'Authorize Hardware LED Illumination Policy Update');
  };

  return (
    <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 lg:col-span-2 space-y-5">
      {/* Header with Title, Live Badges & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
        <div className="flex items-center space-x-2.5">
          <Moon className="w-5 h-5 text-indigo-400 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-white">Hardware LED Illumination & Sleep Policies</h3>
              {status?.night_mode_active ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  Night Active ({status.night_mode_type === 'off' ? 'Dark' : `${status.night_dim_pct}% Dim`})
                </span>
              ) : status?.proxy_stealth_active ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  Desk Stealth Active ({status.proxy_stealth_type === 'off' ? 'Dark' : `${status.proxy_stealth_dim_pct}% Dim`})
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  Daylight Active (100%)
                </span>
              )}
              {status?.night_override === 1 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                  Manual Night
                </span>
              )}
              {status?.night_override === -1 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-700/50">
                  Manual Day
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Automated bedtime dimming, desktop distraction-free stealth mode, and critical alarm bypass
            </p>
          </div>
        </div>

        {/* Quick Action Button */}
        <button
          type="button"
          onClick={handleToggleNightModeNow}
          disabled={isTogglingNow}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-slate-200 hover:text-white transition cursor-pointer self-start sm:self-auto shrink-0"
        >
          {isTogglingNow ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : status?.night_override !== 0 && status?.night_override !== undefined ? (
            <>
              <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
              <span>Resume Clock Schedule</span>
            </>
          ) : status?.night_mode_active ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Force Daylight Mode</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              <span>Force Night Mode Now</span>
            </>
          )}
        </button>
      </div>

      {/* Two-Column Policies Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Column 1: Automated Night Schedule */}
        <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-semibold text-white">Automated Night Schedule</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={nightEnabled}
                onChange={(e) => {
                  setNightEnabled(e.target.checked);
                  setIsDirty(true);
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Automatically dims or turns off the bridge status LED during sleeping hours. Ideal when your UPS is in or near a bedroom.
          </p>

          {/* Time Span Inputs */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">Night Begins (Bedtime)</label>
              <input
                type="time"
                value={nightStartTime}
                disabled={!nightEnabled}
                onChange={(e) => {
                  setNightStartTime(e.target.value);
                  setIsDirty(true);
                }}
                className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-40"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">Night Ends (Sunrise)</label>
              <input
                type="time"
                value={nightEndTime}
                disabled={!nightEnabled}
                onChange={(e) => {
                  setNightEndTime(e.target.value);
                  setIsDirty(true);
                }}
                className="w-full bg-[#12141a] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-40"
              />
            </div>
          </div>

          {/* Night Style Mode Options */}
          <div className="space-y-1.5 pt-1">
            <label className="block text-[11px] font-medium text-slate-300">Night Illumination Style</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!nightEnabled}
                onClick={() => {
                  setNightType('dimmed');
                  setIsDirty(true);
                }}
                className={`p-2.5 rounded-lg border text-left transition cursor-pointer disabled:opacity-40 ${
                  nightType === 'dimmed'
                    ? 'border-indigo-500/50 bg-indigo-500/10 text-white'
                    : 'border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-white'
                }`}
              >
                <div className="text-xs font-semibold mb-0.5">Dimmed Glow</div>
                <div className="text-[10px] text-slate-400">Subtle ambient glow</div>
              </button>
              <button
                type="button"
                disabled={!nightEnabled}
                onClick={() => {
                  setNightType('off');
                  setIsDirty(true);
                }}
                className={`p-2.5 rounded-lg border text-left transition cursor-pointer disabled:opacity-40 ${
                  nightType === 'off'
                    ? 'border-indigo-500/50 bg-indigo-500/10 text-white'
                    : 'border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-white'
                }`}
              >
                <div className="text-xs font-semibold mb-0.5">Completely Dark</div>
                <div className="text-[10px] text-slate-400">0% brightness (Off)</div>
              </button>
            </div>
          </div>

          {/* Dim percentage slider */}
          {nightType === 'dimmed' && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">Night Glow Brightness</span>
                <span className="text-indigo-400 font-mono font-semibold">{nightDimPct}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="30"
                step="1"
                value={nightDimPct}
                disabled={!nightEnabled}
                onChange={(e) => {
                  setNightDimPct(parseInt(e.target.value, 10));
                  setIsDirty(true);
                }}
                className="w-full accent-indigo-500 disabled:opacity-40 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>5% (Minimum)</span>
                <span>10% (Default)</span>
                <span>30% (Max)</span>
              </div>
            </div>
          )}

          {/* Alarm Wakeup Checkbox */}
          <div className="pt-2 border-t border-white/[0.06]">
            <label className="flex items-start space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={nightWakeAlert}
                disabled={!nightEnabled}
                onChange={(e) => {
                  setNightWakeAlert(e.target.checked);
                  setIsDirty(true);
                }}
                className="mt-0.5 rounded border-white/20 bg-slate-900 text-indigo-500 focus:ring-0 disabled:opacity-40"
              />
              <div>
                <span className="text-xs font-medium text-slate-200">
                  Wake LED on Power Failure & Faults (Recommended)
                </span>
                <p className="text-[10px] text-slate-400 leading-normal">
                  Critical alarms (utility grid outage / running on battery, inverter errors, OTA flash) immediately wake the LED at 100% full brightness.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Column 2: In-Use Desktop Stealth Mode */}
        <div className="p-4 rounded-xl border border-white/[0.06] bg-black/20 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold text-white">Desk Stealth Mode (When In Use)</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={stealthEnabled}
                  onChange={(e) => {
                    setStealthEnabled(e.target.checked);
                    setIsDirty(true);
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
              </label>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Mutes or dims the LED while the UPSED desktop app is actively connected on your desk. Prevents peripheral glare while you work.
            </p>

            {/* Stealth Style Mode Options */}
            <div className="space-y-1.5 pt-1">
              <label className="block text-[11px] font-medium text-slate-300">Desk Stealth Style</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!stealthEnabled}
                  onClick={() => {
                    setStealthType('dimmed');
                    setIsDirty(true);
                  }}
                  className={`p-2.5 rounded-lg border text-left transition cursor-pointer disabled:opacity-40 ${
                    stealthType === 'dimmed'
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-white'
                      : 'border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-semibold mb-0.5">Dimmed Glow</div>
                  <div className="text-[10px] text-slate-400">Gentle desk lighting</div>
                </button>
                <button
                  type="button"
                  disabled={!stealthEnabled}
                  onClick={() => {
                    setStealthType('off');
                    setIsDirty(true);
                  }}
                  className={`p-2.5 rounded-lg border text-left transition cursor-pointer disabled:opacity-40 ${
                    stealthType === 'off'
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-white'
                      : 'border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-semibold mb-0.5">Completely Dark</div>
                  <div className="text-[10px] text-slate-400">Zero glare (Off)</div>
                </button>
              </div>
            </div>

            {/* Stealth dim percentage slider */}
            {stealthType === 'dimmed' && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">Stealth Glow Brightness</span>
                  <span className="text-cyan-400 font-mono font-semibold">{stealthDimPct}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="30"
                  step="1"
                  value={stealthDimPct}
                  disabled={!stealthEnabled}
                  onChange={(e) => {
                    setStealthDimPct(parseInt(e.target.value, 10));
                    setIsDirty(true);
                  }}
                  className="w-full accent-cyan-500 disabled:opacity-40 cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                  <span>5% (Subtle)</span>
                  <span>10% (Default)</span>
                  <span>30% (Max)</span>
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-white/[0.06] text-[11px] text-slate-400 leading-relaxed">
            <span className="font-semibold text-slate-300">Automatic Restore:</span> When you shut down or put your computer to sleep, the bridge transitions back to its standard daylight or bedtime schedule.
          </div>
        </div>
      </div>

      {/* Save Settings Bar */}
      <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {isDirty ? (
            <span className="text-xs text-amber-400 font-medium">Unsaved changes</span>
          ) : (
            <span className="text-xs text-slate-500">Settings synced with ESP32 NVS</span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {isDirty && (
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white transition cursor-pointer"
            >
              Discard Changes
            </button>
          )}
          <PrimaryButton
            onClick={handleSaveIllumination}
            disabled={isSaving || !isDirty}
            variant="primary"
            className="text-xs"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                Saving to Bridge...
              </>
            ) : (
              <>
                {!isAuthenticated ? (
                  <Lock className="w-3.5 h-3.5 mr-1.5 text-slate-300" />
                ) : (
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                )}
                Save Illumination Policy
              </>
            )}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};

export const IoT: React.FC<IoTProps> = ({ portName, upsId, pollInterval = 10 }) => {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const isAuthenticated = Boolean(auth.status?.authenticated);

  // Status & Telemetry via TanStack Query
  const {
    data: status = null,
    isFetching: isFetchingQueryStatus,
    refetch: refetchBridgeStatusQuery,
  } = useQuery<BridgeStatus | null>({
    queryKey: ['bridgeStatus', portName],
    queryFn: async () => {
      const st = await api.getBridgeStatus(portName ?? undefined).catch(() => null);
      return st;
    },
    refetchInterval: pollInterval * 1000,
    staleTime: 5000,
  });

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const isLoadingStatus = isFetchingQueryStatus || isManualRefreshing;

  const setStatus = useCallback(
    (st: BridgeStatus | null) => {
      queryClient.setQueryData(['bridgeStatus', portName], st);
      queryClient.setQueryData(['bridgeStatus'], st);
    },
    [queryClient, portName]
  );

  const [activeTab, setActiveTab] = useState<
    'wifi' | 'ws' | 'led' | 'backlog' | 'ota' | 'logs' | 'smart-home'
  >('wifi');

  // Firmware & Wireless OTA
  const [firmwareCheck, setFirmwareCheck] = useState<BridgeFirmwareCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isFlashingOta, setIsFlashingOta] = useState(false);
  const [otaProgress, setOtaProgress] = useState<OtaProgressEvent | null>(null);
  const [otaSource, setOtaSource] = useState<'github' | 'local' | 'file'>('github');
  const [customBinaryPath, setCustomBinaryPath] = useState('');
  const [isOtaConfirmOpen, setIsOtaConfirmOpen] = useState(false);
  const [isPurgeConfirmOpen, setIsPurgeConfirmOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [changelogContent, setChangelogContent] = useState<string | null>(null);
  const [isChangelogLoading, setIsChangelogLoading] = useState(false);
  const [changelogError, setChangelogError] = useState<string | null>(null);
  const [isDev, setIsDev] = useState<boolean>(Boolean(import.meta.env.DEV));

  // Wi-Fi Scanner & Provisioning
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isConfiguringWifi, setIsConfiguringWifi] = useState(false);
  const [provisioningStep, setProvisioningStep] = useState<
    'idle' | 'saving' | 'reconnecting' | 'connected' | 'rollback' | 'failed'
  >('idle');
  const [provisioningTargetSsid, setProvisioningTargetSsid] = useState('');
  const [provisioningResult, setProvisioningResult] = useState<{
    ip?: string | null;
    error?: string | null;
  } | null>(null);
  const [scannedNetworks, setScannedNetworks] = useState<WifiScanNetwork[]>([]);
  const [isScanningWifi, setIsScanningWifi] = useState(false);

  // Keep SSID in sync when status loads
  useEffect(() => {
    if (status?.ssid && !ssid) {
      setSsid(status.ssid);
    }
  }, [status?.ssid, ssid]);

  // WebSocket Failover & Discovery
  const [fallbackHost, setFallbackHost] = useState('upsed-bridge.local');
  const [isSavingHost, setIsSavingHost] = useState(false);
  const [isAdvancedWsOpen, setIsAdvancedWsOpen] = useState(false);
  const [wsTestResult, setWsTestResult] = useState<WsTestResult | null>(null);
  const [isTestingWs, setIsTestingWs] = useState(false);
  const [isDiscoveringLan, setIsDiscoveringLan] = useState(false);
  const [isSyncingTime, setIsSyncingTime] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);

  // Backlog Manager
  const [isSyncingBacklog, setIsSyncingBacklog] = useState(false);
  const [isClearingBacklog, setIsClearingBacklog] = useState(false);

  // TuyaLink MQTT Controller State
  const [tuyaConfig, setTuyaConfig] = useState<TuyaBridgeConfig>({
    enabled: false,
    region: 'eu',
    product_id: '',
    device_id: '',
    device_secret: '',
    off_mode: 'SOFF',
    interlock_pct: 8,
  });
  const [showTuyaSecret, setShowTuyaSecret] = useState(false);
  const [isSavingTuya, setIsSavingTuya] = useState(false);
  const [isTestingTuya, setIsTestingTuya] = useState(false);
  const [isReconnectingTuya, setIsReconnectingTuya] = useState(false);
  const [isTuyaRecipeOpen, setIsTuyaRecipeOpen] = useState(false);
  const prevTuyaStateRef = useRef<string | undefined>(undefined);

  // Real-Time Log Console
  const [logs, setLogs] = useState<BridgeLogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<'ALL' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const consoleBottomRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;

  // Fetch status & fallback host
  const refreshStatus = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      const [res, savedHost] = await Promise.all([
        refetchBridgeStatusQuery(),
        api.getBridgeFallbackHost().catch(() => 'upsed-bridge.local'),
      ]);
      if (savedHost) {
        setFallbackHost(savedHost);
      }
      if (res.data?.ssid && !ssid) {
        setSsid(res.data.ssid);
      }
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refetchBridgeStatusQuery, ssid]);

  // Initial load: fallback host and log history
  useEffect(() => {
    api.getBridgeFallbackHost()
      .then((savedHost) => {
        if (savedHost) setFallbackHost(savedHost);
      })
      .catch(() => {});

    api.getBridgeLogHistory()
      .then((history) => {
        if (history && history.length > 0) {
          setLogs(history);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch TuyaLink configuration when opening the Smart Home tab
  const refreshTuyaConfig = useCallback(async () => {
    try {
      const cfg = await api.getBridgeTuyaConfig(portName ?? undefined);
      setTuyaConfig((prev) => ({
        ...cfg,
        device_secret: cfg.has_secret ? (prev.device_secret || '********') : '',
      }));
    } catch {
      // Bridge may be offline or on older firmware
    }
  }, [portName]);

  useEffect(() => {
    if (activeTab === 'smart-home') {
      refreshTuyaConfig();
    }
  }, [activeTab, refreshTuyaConfig]);

  const handleSaveTuyaConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    await auth.requireAuth(async () => {
      setIsSavingTuya(true);
      try {
        const updated = await api.setBridgeTuyaConfig(tuyaConfig, portName ?? undefined);
        setTuyaConfig({
          ...updated,
          device_secret: updated.has_secret ? '********' : '',
        });
        await refreshStatus();
        toast.success('TuyaLink MQTT configuration saved to ESP32 NVS');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSavingTuya(false);
      }
    }, 'Authorize Bridge TuyaLink Configuration Update');
  };

  const handleTestTuyaPublish = async () => {
    setIsTestingTuya(true);
    try {
      const res = await api.testBridgeTuyaPublish(portName ?? undefined);
      setTuyaConfig((prev) => ({
        ...res,
        device_secret: res.has_secret ? (prev.device_secret || '********') : '',
      }));
      if (res.published) {
        toast.success('Published 19-DP telemetry snapshot to TuyaLink MQTT');
      } else {
        toast.error(`TuyaLink publish failed: ${res.last_error || 'MQTT not connected'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTestingTuya(false);
    }
  };

  const handleReconnectTuya = async () => {
    setIsReconnectingTuya(true);
    try {
      const res = await api.reconnectBridgeTuya(portName ?? undefined);
      setTuyaConfig((prev) => ({
        ...prev,
        ...res,
        device_secret: res.has_secret ? (prev.device_secret || '********') : '',
      }));
      toast.success('Immediate TuyaLink reconnection triggered on ESP32');
    } catch (err: unknown) {
      toast.error(`Failed to trigger Tuya reconnection: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsReconnectingTuya(false);
    }
  };

  const handleCopyTuyaSchema = () => {
    const schema = {
      properties: [
        { abilityId: 101, code: 'ups_power_switch', name: 'UPS Power Switch', accessMode: 'rw', typeSpec: { type: 'bool' } },
        { abilityId: 102, code: 'force_shutdown', name: 'Force Shutdown Override', accessMode: 'rw', typeSpec: { type: 'bool' } },
        { abilityId: 103, code: 'cancel_shutdown', name: 'Cancel Shutdown', accessMode: 'rw', typeSpec: { type: 'bool' } },
        { abilityId: 104, code: 'output_enabled', name: 'AC Output Enabled', accessMode: 'ro', typeSpec: { type: 'bool' } },
        { abilityId: 105, code: 'pc_online', name: 'PC Host Online', accessMode: 'ro', typeSpec: { type: 'bool' } },
        { abilityId: 106, code: 'grid_voltage', name: 'Grid Voltage', accessMode: 'ro', typeSpec: { type: 'value', min: 0, max: 3000, scale: 1, step: 1, unit: 'V' } },
        { abilityId: 107, code: 'output_voltage', name: 'Output Voltage', accessMode: 'ro', typeSpec: { type: 'value', min: 0, max: 3000, scale: 1, step: 1, unit: 'V' } },
        { abilityId: 108, code: 'load_pct', name: 'Load Percentage', accessMode: 'ro', typeSpec: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' } },
        { abilityId: 109, code: 'battery_pct', name: 'Battery Percentage', accessMode: 'ro', typeSpec: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' } },
        { abilityId: 110, code: 'battery_voltage', name: 'Battery Voltage', accessMode: 'ro', typeSpec: { type: 'value', min: 0, max: 10000, scale: 2, step: 1, unit: 'V' } },
        { abilityId: 111, code: 'temperature_c', name: 'Internal Temperature', accessMode: 'ro', typeSpec: { type: 'value', min: 0, max: 1000, scale: 1, step: 1, unit: '°C' } },
        { abilityId: 112, code: 'ups_mode', name: 'UPS Operating Mode', accessMode: 'ro', typeSpec: { type: 'enum', range: ['standby', 'line', 'battery', 'bypass', 'fault'] } },
        { abilityId: 113, code: 'utility_fail', name: 'Utility Grid Fail', accessMode: 'ro', typeSpec: { type: 'bool' } },
        { abilityId: 114, code: 'battery_low', name: 'Battery Low Alarm', accessMode: 'ro', typeSpec: { type: 'bool' } },
        { abilityId: 115, code: 'buzzer_mute', name: 'Buzzer Mute', accessMode: 'rw', typeSpec: { type: 'bool' } },
        { abilityId: 116, code: 'battery_test_10s', name: '10s Battery Test', accessMode: 'rw', typeSpec: { type: 'bool' } },
        { abilityId: 117, code: 'deep_battery_test', name: 'Deep Battery Test', accessMode: 'rw', typeSpec: { type: 'bool' } },
        { abilityId: 118, code: 'cancel_test', name: 'Cancel Battery Test', accessMode: 'rw', typeSpec: { type: 'bool' } },
        { abilityId: 119, code: 'outlet_1_switch', name: 'Programmable Outlet 1', accessMode: 'rw', typeSpec: { type: 'bool' } },
        { abilityId: 120, code: 'outlet_2_switch', name: 'Programmable Outlet 2', accessMode: 'rw', typeSpec: { type: 'bool' } },
      ],
    };
    navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
    toast.success('Copied 19-DP TuyaLink Things Data Model JSON to clipboard');
  };

  const getTuyaBatchRows = (): (string | number | undefined)[][] => [
    [
      'Description (Do Not Delete)\nThis template supports custom data points of Property with either of these data types, namely value, string, date, boolean, enumeration, raw, and fault.',
    ],
    [
      'Required\nEnter a number from 101 to 499.',
      'Required\nThe function name can contain Chinese and alphanumeric characters, dashes, underscores, slashes, and periods, and should start with Chinese or alphanumeric characters.',
      'Required\nThe identifier can contain alphanumeric characters and underscores.',
      'Required\nSingle select\nFor Send and Report, enter rw\nFor Report Only, enter ro\nFor Send Only, enter wr',
      'Required\nSingle select\nFor Value type, enter value\nFor String type, enter string\nFor Date type, enter date\nFor Boolean type, enter bool\nFor Enumeration type, enter enum\nFor Raw type, enter raw\nFor Fault type, enter fault\nFor Single-Precision Floating-Point type, enter float\nFor Double-Precision Floating-Point type, enter double\n',
      'For Value type, leave this field empty\nFor String type, this field is required. Enter a value from 0 to 1024 to specify the maximum length.\nFor Date type, leave this field empty\nFor Boolean type, leave this field empty\nFor Enumeration type, this field is required. Enter enum values, separated by commas (,).\nFor Raw type, leave this field empty\nFor Fault type, this field is required. Enter fault values, separated by commas (,).\nFor Single-Precision Floating-Point type, leave this field empty\nFor Double-Precision Floating-Point type, leave this field empty',
      'Optional\nYou can write a remark in Chinese or English.',
      'This field is required for value, single-precision and double-precision floating-point, and long integer types.\n\nThe minimum value must be less than the maximum value.\n\nFor Value type, enter a positive integer.\nFor Single-Precision Floating-Point type, enter the number of decimal places.\nFor Double-Precision Floating-Point type, enter the number of decimal places.',
      'This field is required for value, single-precision and double-precision floating-point, and long integer types.\n\nThe maximum value must be greater than the minimum value.\n\nFor Value type, enter a positive integer.\nFor Single-Precision Floating-Point type, enter the number of decimal places.\nFor Double-Precision Floating-Point type, enter the number of decimal places.',
      'This field is required for value, single-precision and double-precision floating-point',
      'This field is required for value type.',
      'Optional\nThis field is required for value, single-precision and double-precision floating-point',
    ],
    [
      'DP ID',
      'Function Name',
      'Identifier',
      'Data Transfer Type',
      'Data Type',
      'Data Definition',
      'Remark',
      'Minimum Value',
      'Maximum Value',
      'Pitch',
      'Scale',
      'Unit',
    ],
    [101, 'UPS Power Switch', 'ups_power_switch', 'Send and Report (rw)', 'bool', undefined, 'Turns UPS inverter ON (SON) or OFF (SOFF)'],
    [102, 'Force Shutdown Override', 'force_shutdown', 'Send and Report (rw)', 'bool', undefined, 'Bypasses safety interlock and immediately powers off output'],
    [103, 'Cancel Shutdown', 'cancel_shutdown', 'Send and Report (rw)', 'bool', undefined, 'Aborts pending hardware shutdown countdown (CS)'],
    [104, 'AC Output Status', 'output_enabled', 'Report Only (ro)', 'bool', undefined, 'Reported true when AC output voltage >= 80V'],
    [105, 'PC Host Online', 'pc_online', 'Report Only (ro)', 'bool', undefined, 'Reported true when Desktop proxy active or load > threshold'],
    [106, 'Grid Voltage', 'grid_voltage', 'Report Only (ro)', 'value', undefined, 'Input AC grid voltage', 0, 3000, 1, 1, 'V'],
    [107, 'Output Voltage', 'output_voltage', 'Report Only (ro)', 'value', undefined, 'Output AC voltage', 0, 3000, 1, 1, 'V'],
    [108, 'Load Percentage', 'load_pct', 'Report Only (ro)', 'value', undefined, 'Real-time output load percentage', 0, 100, 1, 0, '%'],
    [109, 'Battery Percentage', 'battery_pct', 'Report Only (ro)', 'value', undefined, 'Estimated battery state-of-charge', 0, 100, 1, 0, '%'],
    [110, 'Battery Voltage', 'battery_voltage', 'Report Only (ro)', 'value', undefined, 'Raw DC battery bank voltage', 0, 10000, 1, 2, 'V'],
    [111, 'Internal Temperature', 'temperature_c', 'Report Only (ro)', 'value', undefined, 'Internal heatsink temperature', 0, 1000, 1, 1, '℃'],
    [112, 'UPS Operating Mode', 'ups_mode', 'Report Only (ro)', 'enum', 'standby, line, battery, bypass, fault', 'Current UPS operating mode'],
    [113, 'Utility Grid Fail', 'utility_fail', 'Report Only (ro)', 'bool', undefined, 'Reported true during blackouts (running on battery)'],
    [114, 'Battery Low Alarm', 'battery_low', 'Report Only (ro)', 'bool', undefined, 'Reported true when battery is critically depleted'],
    [115, 'Buzzer Mute', 'buzzer_mute', 'Send and Report (rw)', 'bool', undefined, 'Toggles UPS audible beeper (Q)'],
    [116, '10s Battery Test', 'battery_test_10s', 'Send and Report (rw)', 'bool', undefined, 'Dispatches 10-second battery self-test (T)'],
    [117, 'Deep Battery Test', 'deep_battery_test', 'Send and Report (rw)', 'bool', undefined, 'Tests battery until low threshold (TL)'],
    [118, 'Cancel Battery Test', 'cancel_test', 'Send and Report (rw)', 'bool', undefined, 'Cancels active battery test (CT)'],
    [119, 'Programmable Outlet 1', 'outlet_1_switch', 'Send and Report (rw)', 'bool', undefined, 'Toggles outlet group 1 (SKON1/SKOFF1)'],
    [120, 'Programmable Outlet 2', 'outlet_2_switch', 'Send and Report (rw)', 'bool', undefined, 'Toggles outlet group 2 (SKON2/SKOFF2)'],
  ];

  const handleDownloadTuyaExcel = async () => {
    try {
      const rows = getTuyaBatchRows();
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [
        { wch: 10 },
        { wch: 26 },
        { wch: 22 },
        { wch: 22 },
        { wch: 14 },
        { wch: 42 },
        { wch: 45 },
        { wch: 14 },
        { wch: 14 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

      const savedPath = await api.saveFileWithDialog(
        'tuya_upsed_bridge_dps.xlsx',
        'Excel Workbook (*.xlsx)',
        ['xlsx'],
        new Uint8Array(wbArray)
      );

      if (savedPath) {
        toast.custom(
          JSON.stringify({
            title: 'Tuya Batch Excel Template Saved',
            description: `Saved to ${savedPath}`,
            action: {
              label: 'Reveal in Finder / Explorer',
              onClick: () => {
                revealItemInDir(savedPath).catch(() => {});
              },
            },
          })
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to save Excel file: ${msg}`);
    }
  };

  const handleDownloadTuyaCsv = async () => {
    try {
      const rows = getTuyaBatchRows();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const csvString = '\uFEFF' + XLSX.utils.sheet_to_csv(ws);
      const encoder = new TextEncoder();
      const csvBytes = encoder.encode(csvString);

      const savedPath = await api.saveFileWithDialog(
        'tuya_upsed_bridge_dps.csv',
        'CSV Document (*.csv)',
        ['csv'],
        csvBytes
      );

      if (savedPath) {
        toast.custom(
          JSON.stringify({
            title: 'Tuya Batch CSV Template Saved',
            description: `Saved to ${savedPath}`,
            action: {
              label: 'Reveal in Finder / Explorer',
              onClick: () => {
                revealItemInDir(savedPath).catch(() => {});
              },
            },
          })
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to save CSV file: ${msg}`);
    }
  };

  // Real-time log listener from Tauri backend
  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | null = null;

    listen<BridgeLogEntry>('upsed://bridge-log', (event) => {
      if (isPausedRef.current) return;
      const entry = event.payload;
      setLogs((prev) => {
        const isDuplicate = prev.some((e) =>
          (entry.seq > 0 && e.seq === entry.seq && e.source === entry.source) ||
          (e.timestamp === entry.timestamp && e.msg === entry.msg)
        );
        if (isDuplicate) return prev;
        const next = [...prev, entry];
        return next.length > 300 ? next.slice(-300) : next;
      });
    }).then((unlisten) => {
      if (!isMounted) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Real-time bridge-status listener for Tuya state machine transitions
  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | null = null;

    listen<BridgeStatus>('bridge-status', (event) => {
      if (!isMounted) return;
      const st = event.payload;
      if (st.tuya_enabled !== undefined) {
        setTuyaConfig((prev) => ({
          ...prev,
          enabled: st.tuya_enabled ?? prev.enabled,
          connected: st.tuya_connected ?? prev.connected,
          state: st.tuya_state ?? prev.state,
          retry_count: st.tuya_retry_count ?? prev.retry_count,
          next_retry_sec: st.tuya_next_retry_sec ?? prev.next_retry_sec,
          region: st.tuya_region ?? prev.region,
          last_error: st.tuya_last_error ?? prev.last_error,
        }));

        const prevState = prevTuyaStateRef.current;
        const newState = st.tuya_state;
        prevTuyaStateRef.current = newState;

        if (prevState && prevState !== newState) {
          if (newState === 'connected') {
            toast.custom(
              JSON.stringify({
                title: 'TuyaLink Cloud Connected',
                description: `ESP32 connected to TuyaLink (${st.tuya_region?.toUpperCase() || 'EU'}). Remote Smart Life control active.`,
                event: {
                  severity: 'success',
                  event_type: 'TUYA_CONNECTED',
                  timestamp: new Date().toISOString(),
                },
              })
            );
          } else if (newState === 'auth_failed') {
            toast.custom(
              JSON.stringify({
                title: 'TuyaLink Authentication Failed',
                description: `Tuya rejected credentials: ${st.tuya_last_error || 'Check Product ID, Device ID, and Device Secret'}.`,
                event: {
                  severity: 'critical',
                  event_type: 'TUYA_AUTH_FAIL',
                  timestamp: new Date().toISOString(),
                },
              })
            );
          }
        }
      }
    }).then((unlisten) => {
      if (!isMounted) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Sync Tuya configuration from polling query status
  useEffect(() => {
    if (status?.tuya_enabled !== undefined) {
      setTuyaConfig((prev) => ({
        ...prev,
        enabled: status.tuya_enabled ?? prev.enabled,
        connected: status.tuya_connected ?? prev.connected,
        state: status.tuya_state ?? prev.state,
        retry_count: status.tuya_retry_count ?? prev.retry_count,
        next_retry_sec: status.tuya_next_retry_sec ?? prev.next_retry_sec,
        region: status.tuya_region ?? prev.region,
        last_error: status.tuya_last_error ?? prev.last_error,
      }));
    }
  }, [status]);

  // Real-time Wi-Fi Provisioning Status Listener
  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | null = null;

    listen<WifiProvisionStatusEvent>('ups-wifi-provision-status', (event) => {
      if (!isMounted) return;
      const { phase, ssid: evSsid, ip: evIp, error: evError } = event.payload;

      setProvisioningStep(phase);
      setProvisioningTargetSsid(evSsid);
      setProvisioningResult({ ip: evIp, error: evError });

      if (phase === 'connected') {
        setIsConfiguringWifi(false);
        refreshStatus();
        queryClient.invalidateQueries({ queryKey: ['ports'] });
        queryClient.invalidateQueries({ queryKey: ['connectedDevices'] });
        toast.custom(
          JSON.stringify({
            title: 'ESP32 Bridge Connected to Wi-Fi',
            description: `Successfully associated with "${evSsid}". IP assigned: ${evIp || 'N/A'}.`,
            event: {
              severity: 'success',
              event_type: 'BRIDGE_WIFI_OK',
              timestamp: new Date().toISOString(),
            },
          })
        );
      } else if (phase === 'rollback') {
        setIsConfiguringWifi(false);
        refreshStatus();
        toast.custom(
          JSON.stringify({
            title: 'Wi-Fi Connection Rolled Back',
            description: `Could not connect to "${evSsid}" (${evError || 'Auth error/timeout'}). Bridge safely restored previous working network to prevent lockout.`,
            event: {
              severity: 'warning',
              event_type: 'BRIDGE_WIFI_ROLLBACK',
              timestamp: new Date().toISOString(),
            },
          })
        );
      } else if (phase === 'failed') {
        setIsConfiguringWifi(false);
        toast.custom(
          JSON.stringify({
            title: 'Wi-Fi Transition Timed Out',
            description: `ESP32 did not report back after 18s. Check 2.4GHz network status or reconnect via USB.`,
            event: {
              severity: 'error',
              event_type: 'BRIDGE_WIFI_ERR',
              timestamp: new Date().toISOString(),
            },
          })
        );
      }
    }).then((unlisten) => {
      if (!isMounted) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, [refreshStatus, queryClient]);

  // Auto-scroll log console
  useEffect(() => {
    if (autoScroll && activeTab === 'logs') {
      consoleBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, activeTab]);

  // Detect development vs production environment for developer-only features
  useEffect(() => {
    let isMounted = true;
    api
      .isDevMode()
      .then((dev) => {
        if (!isMounted) return;
        setIsDev(dev);
        if (!dev) {
          setOtaSource((curr) => (curr === 'local' ? 'github' : curr));
        }
      })
      .catch(() => {
        if (!isMounted) return;
        const dev = Boolean(import.meta.env.DEV);
        setIsDev(dev);
        if (!dev) {
          setOtaSource((curr) => (curr === 'local' ? 'github' : curr));
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Real-time OTA Progress Listener
  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | null = null;

    listen<OtaProgressEvent>('ups-ota-progress', (event) => {
      if (!isMounted) return;
      const progress = event.payload;
      setOtaProgress(progress);
      if (progress.phase === 'success') {
        setIsFlashingOta(false);
        refreshStatus();
        queryClient.invalidateQueries({ queryKey: ['deviceStatus'] });
      } else if (progress.phase === 'error') {
        setIsFlashingOta(false);
      }
    }).then((unlisten) => {
      if (!isMounted) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, [refreshStatus, queryClient]);

  // Real-time remote command execution listener across concurrent UPSED app instances
  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | null = null;

    listen<BridgeCmdExecutedEvent>('ups-bridge-cmd-executed', (event) => {
      if (!isMounted) return;
      const { cmd, source } = event.payload;
      queryClient.invalidateQueries({ queryKey: ['deviceStatus'] });
      queryClient.invalidateQueries({ queryKey: ['outletStates'] });
      queryClient.invalidateQueries({ queryKey: ['deviceFlags'] });
      refreshStatus();
      toast.custom(
        JSON.stringify({
          title: 'Remote UPS Command Executed',
          description: `Client "${source}" dispatched command "${cmd}" to the UPS. Local telemetry cache refreshed.`,
          event: {
            severity: 'info',
            event_type: 'BRIDGE_REMOTE_CMD',
            timestamp: new Date().toISOString(),
          },
        })
      );
    }).then((unlisten) => {
      if (!isMounted) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, [queryClient, refreshStatus]);

  // Initial firmware check when status loads
  useEffect(() => {
    if (status?.fw && !firmwareCheck) {
      api.checkBridgeFirmwareUpdate(status.fw)
        .then(setFirmwareCheck)
        .catch(() => {});
    }
  }, [status?.fw, firmwareCheck]);

  // Manual check for firmware updates
  const handleCheckUpdate = useCallback(async (currentFw?: string) => {
    setIsCheckingUpdate(true);
    try {
      const fwVersion = currentFw || status?.fw || '1.0.0';
      const result = await api.checkBridgeFirmwareUpdate(fwVersion);
      setFirmwareCheck(result);
      if (result.update_available) {
        toast.custom(
          JSON.stringify({
            title: 'Bridge Update Available',
            description: `New firmware ${result.latest_version} is available on GitHub.`,
            event: {
              severity: 'info',
              event_type: 'BRIDGE_OTA_AVAILABLE',
              timestamp: new Date().toISOString(),
            },
          })
        );
      } else {
        toast.success('Bridge firmware is up to date.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Update check failed: ${msg}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [status?.fw]);

  // On-demand fetch of official firmware changelog from GitHub
  const fetchChangelog = useCallback(async () => {
    setIsChangelogLoading(true);
    setChangelogError(null);
    try {
      const res = await fetch(
        'https://raw.githubusercontent.com/Sandakan/UPSED/main/upsed-bridge/CHANGELOG.md'
      );
      if (!res.ok) {
        throw new Error(`Failed to load changelog from GitHub (${res.status} ${res.statusText})`);
      }
      const text = await res.text();
      setChangelogContent(text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setChangelogError(
        msg || 'Unable to fetch changelog. Please check your internet connectivity.'
      );
    } finally {
      setIsChangelogLoading(false);
    }
  }, []);

  // Wireless OTA Flash - Open In-App Confirmation Modal
  const handleFlashOta = () => {
    setIsOtaConfirmOpen(true);
  };

  // Execute Wireless OTA Flash after explicit confirmation
  const executeFlashOta = async () => {
    setIsOtaConfirmOpen(false);
    await auth.requireFreshAuth(async () => {
      setIsFlashingOta(true);
      setOtaProgress({
        phase: 'leasing',
        percentage: 5,
        bytes_transferred: 0,
        total_bytes: 0,
        message: 'Requesting on-demand OTA lease from ESP32...',
      });

      try {
        const res = await api.flashBridgeFirmware({
          portName: portName ?? undefined,
          source: otaSource,
          customPath: otaSource === 'file' ? customBinaryPath : undefined,
          downloadUrl: otaSource === 'github' ? firmwareCheck?.download_url ?? undefined : undefined,
        });

        toast.custom(
          JSON.stringify({
            title: 'Bridge Firmware Flashed',
            description: res || 'ESP32 successfully updated and rebooted.',
            event: {
              severity: 'info',
              event_type: 'BRIDGE_OTA_SUCCESS',
              timestamp: new Date().toISOString(),
            },
          })
        );
        await refreshStatus();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.custom(
          JSON.stringify({
            title: 'OTA Flash Failed',
            description: msg,
            event: {
              severity: 'critical',
              event_type: 'BRIDGE_OTA_ERR',
              timestamp: new Date().toISOString(),
            },
          })
        );
        setOtaProgress({
          phase: 'error',
          percentage: 0,
          bytes_transferred: 0,
          total_bytes: 0,
          message: msg,
        });
      } finally {
        setIsFlashingOta(false);
      }
    }, 'Authorize ESP32 Bridge Firmware Flash');
  };

  // Wi-Fi Scan
  const handleScanWifi = async () => {
    setIsScanningWifi(true);
    try {
      const networks = await api.scanBridgeWifi(portName ?? undefined);
      setScannedNetworks(networks);
      toast.custom(
        JSON.stringify({
          title: 'Wi-Fi Scan Completed',
          description: `Discovered ${networks.length} 2.4GHz Wi-Fi networks in range.`,
          event: {
            severity: 'info',
            event_type: 'BRIDGE_WIFI_SCAN',
            timestamp: new Date().toISOString(),
          },
        })
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.custom(
        JSON.stringify({
          title: 'Wi-Fi Scan Failed',
          description: msg,
          event: {
            severity: 'warning',
            event_type: 'BRIDGE_WIFI_SCAN_ERR',
            timestamp: new Date().toISOString(),
          },
        })
      );
    } finally {
      setIsScanningWifi(false);
    }
  };

  // Wi-Fi Provision
  const handleConfigureWifi = async () => {
    if (!ssid.trim()) return;
    await auth.requireAuth(async () => {
      setIsConfiguringWifi(true);
      setProvisioningStep('saving');
      setProvisioningTargetSsid(ssid.trim());
      setProvisioningResult(null);

      try {
        const updated = await api.configureBridgeWifi(ssid.trim(), password, portName ?? undefined);
        setStatus(updated);
        setProvisioningStep('reconnecting');
        // Background 'ups-wifi-provision-status' event listener finalizes 'connected', 'rollback', or 'failed'
      } catch (e: unknown) {
        setIsConfiguringWifi(false);
        setProvisioningStep('failed');
        const msg = e instanceof Error ? e.message : String(e);
        setProvisioningResult({ error: msg });
        toast.custom(
          JSON.stringify({
            title: 'ESP32 Wi-Fi Provisioning Failed',
            description: msg,
            event: {
              severity: 'critical',
              event_type: 'BRIDGE_WIFI_ERR',
              timestamp: new Date().toISOString(),
            },
          })
        );
      }
    }, 'Authorize ESP32 Wi-Fi Provisioning');
  };

  // Test WebSocket
  const handleTestWebSocket = async () => {
    setIsTestingWs(true);
    setWsTestResult(null);
    try {
      const res = await api.testBridgeWebsocket(fallbackHost.trim());
      setWsTestResult(res);
      if (res.reachable) {
        toast.custom(
          JSON.stringify({
            title: 'WebSocket Bridge Reachable',
            description: `Ping round-trip took ${res.latency_ms}ms at ws://${res.host}:${res.port}.`,
            event: {
              severity: 'success',
              event_type: 'BRIDGE_WS_OK',
              timestamp: new Date().toISOString(),
            },
          })
        );
      } else {
        toast.custom(
          JSON.stringify({
            title: 'WebSocket Connection Failed',
            description: res.error || 'Connection timed out.',
            event: {
              severity: 'warning',
              event_type: 'BRIDGE_WS_FAIL',
              timestamp: new Date().toISOString(),
            },
          })
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setWsTestResult({
        reachable: false,
        host: fallbackHost.trim(),
        port: 81,
        latency_ms: 0,
        error: msg,
      });
    } finally {
      setIsTestingWs(false);
    }
  };

  // Discover on LAN
  const handleDiscoverLan = async () => {
    setIsDiscoveringLan(true);
    try {
      const discovered = await api.discoverBridgeOnLan();
      if (discovered && discovered.length > 0) {
        const [bestIp, bestStatus] = discovered[0];
        setFallbackHost(bestIp);
        await api.setBridgeFallbackHost(bestIp).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['ports'] });
        queryClient.invalidateQueries({ queryKey: ['connectedDevices'] });
        toast.custom(
          JSON.stringify({
            title: 'ESP32 Bridge Discovered on LAN',
            description: `Found active bridge at ${bestIp}:81 (MAC: ${bestStatus.mac}). Updated failover host.`,
            event: {
              severity: 'success',
              event_type: 'BRIDGE_LAN_FOUND',
              timestamp: new Date().toISOString(),
            },
          })
        );
      } else {
        toast.custom(
          JSON.stringify({
            title: 'No Bridge Detected on Local Subnet',
            description: 'Scanned local subnet port 81. Make sure ESP32 and PC are on the same Wi-Fi network.',
            event: {
              severity: 'warning',
              event_type: 'BRIDGE_LAN_NOT_FOUND',
              timestamp: new Date().toISOString(),
            },
          })
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.custom(
        JSON.stringify({
          title: 'LAN Discovery Sweep Failed',
          description: msg,
          event: {
            severity: 'critical',
            event_type: 'BRIDGE_LAN_ERR',
            timestamp: new Date().toISOString(),
          },
        })
      );
    } finally {
      setIsDiscoveringLan(false);
    }
  };

  // Save Fallback Host
  const handleSaveFallbackHost = async () => {
    await auth.requireAuth(async () => {
      setIsSavingHost(true);
      try {
        const cleanHost = fallbackHost.trim() || 'upsed-bridge.local';
        await api.setBridgeFallbackHost(cleanHost);
        queryClient.invalidateQueries({ queryKey: ['ports'] });
        queryClient.invalidateQueries({ queryKey: ['connectedDevices'] });
        toast.custom(
          JSON.stringify({
            title: 'Bridge Failover Host Saved',
            description: `Dual-Mode WebSocket failover will target ws://${cleanHost}:81 when USB is unplugged.`,
            event: {
              severity: 'success',
              event_type: 'BRIDGE_HOST_SAVED',
              timestamp: new Date().toISOString(),
            },
          })
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Failed to save host: ${msg}`);
      } finally {
        setIsSavingHost(false);
      }
    }, 'Authorize Bridge Host Configuration');
  };

  // Reset Fallback Host to Default
  const handleResetFallbackHost = async () => {
    await auth.requireAuth(async () => {
      setFallbackHost('upsed-bridge.local');
      setIsSavingHost(true);
      try {
        await api.setBridgeFallbackHost('upsed-bridge.local');
        queryClient.invalidateQueries({ queryKey: ['ports'] });
        queryClient.invalidateQueries({ queryKey: ['connectedDevices'] });
        toast.success('Reset failover endpoint to default (upsed-bridge.local)');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Reset failed: ${msg}`);
      } finally {
        setIsSavingHost(false);
      }
    }, 'Authorize Bridge Host Configuration');
  };

  // Sync Host Time to ESP32 RTC
  const handleSyncTime = async () => {
    setIsSyncingTime(true);
    try {
      const res = await api.bridgeSyncTime(portName ?? undefined);
      setStatus(res);
      toast.success(
        `ESP32 RTC synchronized: ${res.rtc_iso ? new Date(res.rtc_iso).toLocaleTimeString() : 'OK'} (${res.time_source || 'Host'})`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSyncingTime(false);
    }
  };

  // Invalidate Command Cache
  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      const count = await api.bridgeClearCache(portName ?? undefined);
      await refreshStatus();
      toast.success(`Bridge query cache cleared (${count} entries removed)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsClearingCache(false);
    }
  };

  // Sync Backlog
  const handleSyncBacklog = async () => {
    setIsSyncingBacklog(true);
    try {
      const imported = await api.syncBridgeBacklog(portName ?? undefined, upsId ?? undefined);
      await refreshStatus();
      toast.custom(
        JSON.stringify({
          title: 'ESP32 Telemetry Buffer Synced',
          description:
            imported > 0
              ? `Imported ${imported} MessagePack telemetry samples from ESP32 RAM into UPSED History.`
              : 'Local database is already up to date with ESP32 telemetry buffer.',
          event: {
            severity: 'info',
            event_type: 'BRIDGE_SYNC',
            timestamp: new Date().toISOString(),
          },
        })
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.custom(
        JSON.stringify({
          title: 'Buffer Sync Failed',
          description: msg,
          event: {
            severity: 'critical',
            event_type: 'BRIDGE_SYNC_ERR',
            timestamp: new Date().toISOString(),
          },
        })
      );
    } finally {
      setIsSyncingBacklog(false);
    }
  };

  // Clear Backlog
  const handleClearBacklog = () => {
    setIsPurgeConfirmOpen(true);
  };

  const executeClearBacklog = async () => {
    setIsPurgeConfirmOpen(false);
    await auth.requireAuth(async () => {
      setIsClearingBacklog(true);
      try {
        await api.clearBridgeBacklog(portName ?? undefined);
        await refreshStatus();
        toast.custom(
          JSON.stringify({
            title: 'ESP32 Telemetry Buffer Cleared',
            description: 'Telemetry ring buffer has been reset to 0 records.',
            event: {
              severity: 'info',
              event_type: 'BRIDGE_CLEARED',
              timestamp: new Date().toISOString(),
            },
          })
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.custom(
          JSON.stringify({
            title: 'Failed to Clear Buffer',
            description: msg,
            event: {
              severity: 'critical',
              event_type: 'BRIDGE_CLEAR_ERR',
              timestamp: new Date().toISOString(),
            },
          })
        );
      } finally {
        setIsClearingBacklog(false);
      }
    }, 'Authorize Clearing Bridge Telemetry Buffer');
  };

  // Copy Logs
  const handleCopyLogs = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [#${l.seq}] [${l.level}] [${l.source}] ${l.msg}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Logs copied to clipboard');
  };

  // Filtered Logs
  const filteredLogs = logs.filter((l) => {
    if (logFilter === 'ALL') return true;
    return l.level === logFilter;
  });

  const formatUptime = (secs: number) => {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const getRssiIcon = (rssi: number) => {
    if (rssi >= -60) return <SignalHigh className="w-4 h-4 text-emerald-400" />;
    if (rssi >= -75) return <SignalMedium className="w-4 h-4 text-amber-400" />;
    return <SignalLow className="w-4 h-4 text-rose-400" />;
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <Cpu className="w-7 h-7 text-emerald-400" />
              IoT Bridge & Diagnostics Hub
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-mono font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              ESP32-S3 Dual-Mode
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time JSON-RPC 2.0 telemetry bridge, Wi-Fi provisioning, WebSocket failover & PSRAM telemetry buffer.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={refreshStatus}
            disabled={isLoadingStatus}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh Status</span>
          </button>
        </div>
      </div>

      {/* ── Incompatible Firmware Alert Banner (Hard-Block) ──────────── */}
      {status && status.is_compatible === false && (
        <div className="rounded-2xl p-4 border border-rose-500/40 bg-rose-500/10 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-rose-300 flex items-center gap-2">
                <span>Incompatible ESP32 Bridge Firmware</span>
                <span className="px-2 py-0.2 rounded text-[10px] font-mono bg-rose-500/30 text-rose-200">
                  Installed: v{status.fw} • Required: &gt;= v{status.min_supported_fw || '1.0.0'}
                </span>
              </h3>
              <p className="text-xs text-rose-300/80 mt-1 leading-relaxed">
                Hardware telemetry commands are suspended to prevent protocol errors and serial data corruption.
                Please update your bridge firmware to version {status.min_supported_fw || '1.0.0'} or newer using the <strong>Firmware &amp; OTA</strong> panel below.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('ota')}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 transition shrink-0 cursor-pointer shadow-lg shadow-rose-950/40"
          >
            Update Firmware Now
          </button>
        </div>
      )}

      {/* ── Status Banner & Health Hero Grid ────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Transport & Hardware Mode */}
        <div className="rounded-2xl p-4 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Transport & Link</span>
            {status?.active_transport === 'websocket' ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Radio className="w-3 h-3 animate-pulse" />
                WebSocket
              </span>
            ) : status ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Usb className="w-3 h-3" />
                USB CDC
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-slate-800 text-slate-400 border border-white/5">
                Offline
              </span>
            )}
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-white font-mono truncate">
              {status ? status.bridge : 'Bridge Not Detected'}
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-2 mt-1">
              <span>FW: <strong className={status?.is_compatible === false ? 'text-rose-400 font-bold' : 'text-slate-200'}>{status?.fw || '—'}</strong></span>
              {status?.is_compatible === false ? (
                <button
                  onClick={() => setActiveTab('ota')}
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition cursor-pointer flex items-center gap-1"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                  Incompatible
                </button>
              ) : firmwareCheck?.update_available ? (
                <button
                  onClick={() => setActiveTab('ota')}
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition cursor-pointer flex items-center gap-1"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Update
                </button>
              ) : null}
              <span>•</span>
              <span className="truncate">MAC: <strong className="text-slate-200 font-mono">{status?.mac || '—'}</strong></span>
            </div>
          </div>
        </div>

        {/* Card 2: 2.4GHz Wi-Fi Radio */}
        <div className="rounded-2xl p-4 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Wi-Fi Connection</span>
            {status?.wifi_connected ? (
              <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
                {getRssiIcon(status.rssi)}
                {status.rssi} dBm
              </span>
            ) : (
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <WifiOff className="w-3 h-3 text-rose-400" />
                Disconnected
              </span>
            )}
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-white truncate flex items-center gap-1.5">
              <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">{status?.wifi_connected ? status.ssid : 'No Wi-Fi'}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1 truncate">
              {status?.wifi_connected ? (
                <span>IP: <strong className="text-slate-200 font-mono">{status.ip}</strong></span>
              ) : status?.wifi_last_error ? (
                <span className="text-amber-400 truncate">Err: {status.wifi_last_error}</span>
              ) : (
                <span>Provisioning required</span>
              )}
            </div>
          </div>
        </div>

        {/* Card 3: PSRAM Telemetry Buffer */}
        <div className="rounded-2xl p-4 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{status?.psram_active ? 'PSRAM Buffer' : 'SRAM Buffer'}</span>
            <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
              (status?.backlog_records ?? 0) > 0
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
            }`}>
              {(status?.backlog_records ?? 0) > 0 ? `${status?.backlog_records} Buffered` : 'Standby'}
            </span>
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-white font-mono">
              {(status?.backlog_records ?? 0).toLocaleString()} <span className="text-xs font-normal text-slate-400">/ {(status?.backlog_capacity || 32768).toLocaleString()}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-slate-500" />
              <span>
                PSRAM: {status?.psram_active ? `${Math.round((status.psram_free ?? 0) / 1024)} KB free` : 'Internal SRAM'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Uptime & RTC Diagnostics */}
        <div className="rounded-2xl p-4 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ESP32 Uptime &amp; RTC</span>
            <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
              status?.time_synced
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {status?.time_synced ? `${status.time_source || 'NTP'} Synced` : 'Unsynced'}
            </span>
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-white font-mono flex items-center justify-between">
              <span>{status?.uptime_sec ? formatUptime(status.uptime_sec) : '0s'}</span>
              <button
                onClick={handleSyncTime}
                disabled={isSyncingTime}
                title="Synchronize host real-world time to ESP32 RTC"
                className="text-[10px] text-emerald-400 hover:text-emerald-300 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition cursor-pointer disabled:opacity-50 flex items-center gap-1 font-sans"
              >
                <Clock className={`w-3 h-3 ${isSyncingTime ? 'animate-spin' : ''}`} />
                <span>Sync</span>
              </button>
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between gap-1.5 font-mono">
              <span className="flex items-center gap-1 truncate text-slate-300">
                <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span className="truncate">
                  {status?.rtc_iso ? new Date(status.rtc_iso).toLocaleTimeString() : 'RTC --:--'}
                </span>
              </span>
              <span className="text-[10px] text-slate-500 shrink-0">
                Port {status?.ws_port ?? 81}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Hardware Bridge Security Barrier Banner ───────────────────── */}
      {!isAuthenticated ? (
        <div className="p-4 rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.06] backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-indigo-950/20">
          <div className="flex items-start sm:items-center space-x-3.5">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="text-xs">
              <h4 className="font-semibold text-indigo-300">
                Hardware Bridge Settings are Protected
              </h4>
              <p className="text-slate-400 mt-0.5 leading-relaxed">
                Modifying Wi-Fi credentials, TuyaLink cloud settings, fallback hosts, or flashing bridge firmware requires authenticated authorization.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => auth.requireAuth(() => {}, 'Unlock Bridge Settings')}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold shadow-lg shadow-indigo-950/40 transition cursor-pointer shrink-0 self-start sm:self-auto flex items-center gap-1.5"
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>
              {auth.status?.os_auth_available
                ? `Unlock with ${auth.status.provider_name}`
                : 'Log In to Unlock'}
            </span>
          </button>
        </div>
      ) : (
        <div className="px-4 py-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] text-[11.5px] text-emerald-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Hardware Bridge Settings Unlocked · Verified via {auth.status?.provider_name || 'Administrator'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => auth.logout()}
            className="text-[11px] text-emerald-300 hover:text-emerald-100 transition cursor-pointer font-medium"
          >
            Log Out
          </button>
        </div>
      )}

      {/* ── Sub-navigation Tabs ──────────────────────────────────────── */}
      <div className="flex items-center space-x-1 border-b border-white/[0.08] pb-1">
        <button
          onClick={() => setActiveTab('wifi')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'wifi'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Wifi className="w-3.5 h-3.5" />
          <span>Wi-Fi Provisioning</span>
        </button>

        <button
          onClick={() => setActiveTab('ws')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'ws'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>WebSocket & Failover</span>
        </button>

        <button
          onClick={() => setActiveTab('led')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'led'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Moon className="w-3.5 h-3.5" />
          <span>Status LED & Night Mode</span>
          {status?.night_mode_active && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('backlog')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'backlog'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Telemetry Buffer</span>
          {(status?.backlog_records ?? 0) > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
              {status?.backlog_records}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('ota')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'ota'
              ? status?.is_compatible === false
                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>Firmware & OTA</span>
          {status?.is_compatible === false ? (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold animate-pulse">
              INCOMPATIBLE
            </span>
          ) : firmwareCheck?.update_available ? (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500 text-black font-bold">
              UPDATE
            </span>
          ) : null}
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'logs'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Live Debug Console</span>
          {logs.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-700 text-slate-300 font-mono">
              {logs.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('smart-home')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'smart-home'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Smart Home Integrations</span>
        </button>
      </div>

      {/* ── Tab Content ────────────────────────────────────────────── */}
      {/* 1. Wi-Fi Provisioning & Scanner Tab */}
      {activeTab === 'wifi' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Scanner */}
          <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2.5">
                  <Signal className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-base font-semibold text-white">2.4GHz Wi-Fi Scanner</h3>
                </div>
                <button
                  onClick={handleScanWifi}
                  disabled={isScanningWifi}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isScanningWifi ? 'animate-spin text-emerald-400' : ''}`} />
                  <span>{isScanningWifi ? 'Scanning Airwaves...' : 'Scan Networks'}</span>
                </button>
              </div>

              <p className="text-xs text-slate-400 mb-4">
                Discovers 2.4GHz IEEE 802.11 b/g/n networks in range of the ESP32-S3 antenna. Click any network to auto-fill the SSID.
              </p>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {scannedNetworks.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-white/[0.08] rounded-xl text-xs text-slate-500">
                    {isScanningWifi ? 'Scanning 2.4GHz channels 1–13...' : 'No scan results yet. Click "Scan Networks" to probe.'}
                  </div>
                ) : (
                  scannedNetworks.map((net, i) => (
                    <div
                      key={`${net.ssid}-${i}`}
                      onClick={() => setSsid(net.ssid)}
                      className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs cursor-pointer transition ${
                        ssid === net.ssid
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                          : 'bg-white/[0.02] border-white/[0.05] text-slate-300 hover:bg-white/[0.06] hover:border-white/[0.1]'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 truncate">
                        {net.open ? (
                          <Unlock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
                        )}
                        <span className="font-medium truncate">{net.ssid}</span>
                      </div>
                      <div className="flex items-center space-x-3 shrink-0 font-mono text-[11px] text-slate-400">
                        <span>Ch {net.channel}</span>
                        <div className="flex items-center space-x-1">
                          {getRssiIcon(net.rssi)}
                          <span>{net.rssi} dBm</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-white/[0.08] text-[11px] text-slate-500 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
              <span>Note: ESP32-S3 hardware supports 2.4GHz Wi-Fi exclusively. 5GHz networks are not supported.</span>
            </div>
          </div>

          {/* Provisioning Form */}
          <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2.5 mb-4">
                <Wifi className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-semibold text-white">NVS Credential Provisioning</h3>
              </div>

              <p className="text-xs text-slate-400 mb-4">
                Saves credentials securely into ESP32 Non-Volatile Storage (NVS flash partition) over USB CDC or active WebSocket session.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Network SSID (2.4GHz)
                  </label>
                  <input
                    type="text"
                    value={ssid}
                    onChange={(e) => setSsid(e.target.value)}
                    placeholder="e.g. MyHomeNetwork_2.4G"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Wi-Fi Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter WPA2 passphrase"
                      className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {status?.wifi_last_error && !status.wifi_connected && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <strong>Last Association Error:</strong> {status.wifi_last_error}
                      <p className="text-amber-400/80 text-[11px] mt-0.5">
                        Verify WPA passphrase or ensure access point operates on 20MHz channel width.
                      </p>
                    </div>
                  </div>
                )}

                {/* 3-Step Live Provisioning Progress Stepper */}
                {provisioningStep !== 'idle' && (
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-white/10 space-y-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                      <span>Provisioning Progress</span>
                      <span className="text-slate-400 font-mono text-[11px] capitalize">{provisioningStep}</span>
                    </div>

                    <div className="space-y-2.5 text-xs">
                      {/* Step 1: NVS Flash Write */}
                      <div className="flex items-center gap-2.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-slate-200">
                          Credentials Staged & Written to NVS Flash
                        </span>
                      </div>

                      {/* Step 2: Associating with AP */}
                      <div className="flex items-center gap-2.5">
                        {provisioningStep === 'saving' ? (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-800 text-slate-500">
                            <span className="text-[10px]">2</span>
                          </div>
                        ) : provisioningStep === 'reconnecting' ? (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-cyan-500/20 text-cyan-400">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          </div>
                        ) : provisioningStep === 'connected' ? (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20 text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        ) : provisioningStep === 'rollback' ? (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-amber-500/20 text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-red-500/20 text-red-400">
                            <AlertCircle className="w-3.5 h-3.5" />
                          </div>
                        )}
                        <span className={provisioningStep === 'reconnecting' ? 'text-cyan-300 font-medium' : provisioningStep === 'rollback' ? 'text-amber-300' : 'text-slate-300'}>
                          {provisioningStep === 'saving'
                            ? `Preparing association with "${provisioningTargetSsid}"`
                            : provisioningStep === 'reconnecting'
                            ? `Associating with "${provisioningTargetSsid}" (up to 12s)...`
                            : provisioningStep === 'connected'
                            ? `Successfully associated with "${provisioningTargetSsid}"`
                            : provisioningStep === 'rollback'
                            ? `Failed to associate (${provisioningResult?.error || 'Auth error/timeout'})`
                            : `Association failed`}
                        </span>
                      </div>

                      {/* Step 3: Link Verification & Status */}
                      <div className="flex items-center gap-2.5">
                        {provisioningStep === 'connected' ? (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20 text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        ) : provisioningStep === 'rollback' ? (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-amber-500/20 text-amber-400">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </div>
                        ) : provisioningStep === 'failed' ? (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-red-500/20 text-red-400">
                            <AlertCircle className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-800 text-slate-500">
                            <span className="text-[10px]">3</span>
                          </div>
                        )}
                        <span className={provisioningStep === 'connected' ? 'text-emerald-400 font-medium' : provisioningStep === 'rollback' ? 'text-amber-400 font-medium' : 'text-slate-400'}>
                          {provisioningStep === 'connected'
                            ? `Connected & Verified (IP: ${provisioningResult?.ip || 'Assigned'})`
                            : provisioningStep === 'rollback'
                            ? `Safely restored previous connection (No lockout)`
                            : provisioningStep === 'failed'
                            ? `Connection timed out`
                            : `Awaiting link verification...`}
                        </span>
                      </div>
                    </div>

                    {(provisioningStep === 'connected' || provisioningStep === 'rollback' || provisioningStep === 'failed') && (
                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setProvisioningStep('idle')}
                          className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.08] flex items-center justify-between">
              <span className="text-xs text-slate-500 font-mono">
                {status?.wifi_connected ? `Connected: ${status.ip}` : 'Status: Disconnected'}
              </span>
              <PrimaryButton
                onClick={handleConfigureWifi}
                disabled={isConfiguringWifi || !ssid.trim()}
                variant="primary"
                className="text-xs"
              >
                {isConfiguringWifi ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Connecting...
                  </>
                ) : (
                  <>
                    {!isAuthenticated ? (
                      <Lock className="w-3.5 h-3.5 mr-1.5 text-slate-300" />
                    ) : (
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Save & Connect
                  </>
                )}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* 2. WebSocket & Failover Tab */}
      {activeTab === 'ws' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Active Failover Target & Status Card */}
            <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2.5">
                    <Globe className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-base font-semibold text-white">WebSocket Failover Target</h3>
                  </div>
                  {status?.active_transport === 'websocket' ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Active (In Use)
                    </span>
                  ) : status?.wifi_connected ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                      Ready (Standby)
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-white/5">
                      Standby
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                  When USB serial is unplugged or disconnected, UPSED seamlessly switches communication to this endpoint over Wi-Fi without dropping your UPS monitoring session.
                </p>

                {/* Target URI Box */}
                <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] space-y-2.5 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">Configured Failover URI</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-cyan-300">
                      Port 81
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <code className="text-base font-mono font-bold text-white tracking-wide truncate">
                      ws://{fallbackHost}:81
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`ws://${fallbackHost}:81`);
                        toast.success('Copied WebSocket URI to clipboard');
                      }}
                      className="p-1.5 text-slate-400 hover:text-white transition cursor-pointer"
                      title="Copy WebSocket URI"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Metadata & Origin Details */}
                <div className="grid grid-cols-2 gap-3 text-xs mb-4">
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-[10px] text-slate-500 mb-0.5">Endpoint Origin</div>
                    <div className="font-medium text-slate-200 truncate">
                      {status?.ip && fallbackHost === status.ip
                        ? 'Auto-synced from USB'
                        : fallbackHost === 'upsed-bridge.local'
                        ? 'mDNS Multicast Default'
                        : 'Manual Override'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-[10px] text-slate-500 mb-0.5">Active Medium</div>
                    <div className="font-medium text-slate-200 flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${status?.active_transport === 'websocket' ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400'}`} />
                      {status?.active_transport === 'websocket' ? 'Wi-Fi WebSocket' : 'USB CDC Serial'}
                    </div>
                  </div>
                </div>

                {/* Quick Action Buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleDiscoverLan}
                    disabled={isDiscoveringLan}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isDiscoveringLan ? 'animate-spin text-cyan-400' : ''}`} />
                    <span>{isDiscoveringLan ? 'Sweeping Subnet...' : 'Fast LAN Subnet Discovery'}</span>
                  </button>

                  <button
                    onClick={() => setIsAdvancedWsOpen((prev) => !prev)}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5 text-slate-400" />
                    <span>{isAdvancedWsOpen ? 'Hide Manual Config' : 'Manual IP Override'}</span>
                    {isAdvancedWsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-white/[0.08] text-[11px] text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Zero-config auto-sync keeps this address current when connected via USB.</span>
              </div>
            </div>

          {/* WebSocket Ping & Latency Tester */}
          <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2.5">
                  <Activity className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-base font-semibold text-white">WebSocket Ping & Latency Probe</h3>
                </div>
                <button
                  onClick={handleTestWebSocket}
                  disabled={isTestingWs}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingWs ? 'animate-spin' : ''}`} />
                  <span>{isTestingWs ? 'Pinging...' : 'Test WebSocket'}</span>
                </button>
              </div>

              <p className="text-xs text-slate-400 mb-4">
                Initiates a test TCP handshake and JSON-RPC 2.0 <code className="text-slate-300">bridge.ping</code> round-trip to <code className="text-emerald-400 font-mono">ws://{fallbackHost}:81</code>.
              </p>

              {wsTestResult ? (
                <div className={`p-4 rounded-xl border ${
                  wsTestResult.reachable
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {wsTestResult.reachable ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-rose-400" />
                      )}
                      <span className="font-semibold text-sm">
                        {wsTestResult.reachable ? 'Connection Succeeded' : 'Connection Failed'}
                      </span>
                    </div>
                    {wsTestResult.reachable && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {wsTestResult.latency_ms} ms
                      </span>
                    )}
                  </div>

                  {wsTestResult.reachable ? (
                    <div className="mt-3 text-xs space-y-1 text-slate-300 font-mono">
                      <div>Target: ws://{wsTestResult.host}:{wsTestResult.port}</div>
                      <div>Firmware: {wsTestResult.status?.fw || 'ESP32-S3 UPSED'}</div>
                      <div>Wi-Fi RSSI: {wsTestResult.status?.rssi} dBm</div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-rose-300">
                      Error: {wsTestResult.error || 'Failed to connect. Check IP and Wi-Fi signal.'}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10 border border-dashed border-white/[0.08] rounded-xl text-xs text-slate-500">
                  Click "Test WebSocket" to measure LAN latency.
                </div>
              )}
            </div>

            <div className="mt-6 pt-3 border-t border-white/[0.08] text-[11px] text-slate-500 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Standard local Wi-Fi latency is typically 5ms to 25ms over 802.11n.</span>
            </div>
          </div>
        </div>

        {/* Collapsible Accordion: Advanced Network & Manual IP */}
        {isAdvancedWsOpen && (
          <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1a1d24] animate-in fade-in duration-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <h4 className="text-sm font-semibold text-white">Advanced Network & Manual IP Override</h4>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">For Homelabs & VLANs</span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              If your ESP32 bridge is deployed on an isolated IoT VLAN, separate subnet, or behind a VPN where mDNS multicast and LAN sweeps are blocked, enter the static IP or DNS hostname directly.
            </p>

            <div className="max-w-xl space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Custom Hostname or Static IP Address
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={fallbackHost}
                    onChange={(e) => setFallbackHost(e.target.value)}
                    placeholder="upsed-bridge.local or 192.168.1.150"
                    className="flex-1 px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-500/50"
                  />
                  <button
                    onClick={handleSaveFallbackHost}
                    disabled={isSavingHost}
                    className="flex items-center px-4 py-2 rounded-xl text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-500 transition cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {!isAuthenticated && <Lock className="w-3.5 h-3.5 mr-1.5 text-slate-300" />}
                    <span>{isSavingHost ? 'Saving...' : 'Save Endpoint'}</span>
                  </button>
                  <button
                    onClick={handleResetFallbackHost}
                    disabled={isSavingHost}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition cursor-pointer shrink-0"
                    title="Reset to default upsed-bridge.local"
                  >
                    {!isAuthenticated ? (
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-slate-500">
                Target will be saved to local SQLite app settings and used as the fallback destination when USB communication drops.
              </div>
            </div>
          </div>
        )}

        {/* Multi-App Concurrency & Connected Client Sessions */}
        <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <Users className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="text-base font-semibold text-white">Multi-App Concurrency Sessions</h3>
                <p className="text-xs text-slate-400">
                  The ESP32 bridge allows concurrent connections from multiple UPSED app instances across your LAN.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {(status?.ws_clients ?? 0) + (status?.usb_client_active ? 1 : 0)} Active Client{(status?.ws_clients ?? 0) + (status?.usb_client_active ? 1 : 0) === 1 ? '' : 's'}
              </span>
              <span className="text-[11px] font-mono text-slate-500">Max: 8</span>
            </div>
          </div>

          {status?.connected_clients && status.connected_clients.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-black/30 text-slate-400 text-[11px] font-semibold uppercase tracking-wider border-b border-white/[0.06]">
                  <tr>
                    <th className="py-2.5 px-3">Session ID</th>
                    <th className="py-2.5 px-3">Transport Medium</th>
                    <th className="py-2.5 px-3">Remote Address</th>
                    <th className="py-2.5 px-3">Connected Duration</th>
                    <th className="py-2.5 px-3 text-right">Requests Serviced</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {status.connected_clients.map((client) => (
                    <tr key={client.id} className="hover:bg-white/[0.02] transition">
                      <td className="py-2.5 px-3 font-mono text-slate-200">{client.id}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                          client.medium === 'websocket'
                            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {client.medium === 'websocket' ? 'Wi-Fi WebSocket' : 'USB CDC'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-400">{client.ip}</td>
                      <td className="py-2.5 px-3 text-slate-400">{formatUptime(client.connected_sec)}</td>
                      <td className="py-2.5 px-3 font-mono text-right text-emerald-400">{client.req_count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-black/20 border border-white/[0.04] text-xs text-slate-500 text-center">
              No active remote client sessions reported by ESP32.
            </div>
          )}
        </div>

        {/* Hardware Serial Bus Query Cache */}
        <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <Zap className="w-5 h-5 text-amber-400" />
              <div>
                <h3 className="text-base font-semibold text-white">Serial Bus Command Cache</h3>
                <p className="text-xs text-slate-400">
                  Caches previous UPS responses on the ESP32 to eliminate 2400-baud RS-232 serial contention across concurrent apps.
                </p>
              </div>
            </div>
            <button
              onClick={handleClearCache}
              disabled={isClearingCache || (status?.cache_entries ?? 0) === 0}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isClearingCache ? 'Clearing...' : 'Invalidate Cache'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="text-[10px] text-slate-500 mb-0.5">Cache Hit Ratio</div>
              <div className="text-base font-bold text-emerald-400 font-mono">
                {(status?.cache_hits ?? 0) + (status?.cache_misses ?? 0) > 0
                  ? `${Math.round(((status?.cache_hits ?? 0) / ((status?.cache_hits ?? 0) + (status?.cache_misses ?? 0))) * 100)}%`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="text-[10px] text-slate-500 mb-0.5">Cache Hits / Misses</div>
              <div className="text-base font-bold text-slate-200 font-mono">
                {status?.cache_hits ?? 0} <span className="text-xs text-slate-500 font-normal">/ {status?.cache_misses ?? 0}</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="text-[10px] text-slate-500 mb-0.5">Occupied Slots</div>
              <div className="text-base font-bold text-slate-200 font-mono">
                {status?.cache_entries ?? 0} <span className="text-xs text-slate-500 font-normal">/ {status?.cache_capacity ?? 16}</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="text-[10px] text-slate-500 mb-0.5">Telemetry TTL</div>
              <div className="text-base font-bold text-cyan-400 font-mono">
                {status?.cache_ttl_ms ?? 1500} ms
              </div>
            </div>
          </div>
        </div>

        {/* Hardware Status LED Diagnostic Guide */}
        <BridgeLedGuide />
      </div>
    )}

      {/* 3. Status LED & Night Mode Tab */}
      {activeTab === 'led' && (
        <div className="space-y-6">
          {/* Hardware Status LED Illumination & Sleep Policies */}
          <HardwareLedIlluminationCard
            status={status}
            portName={portName}
            onStatusUpdate={setStatus}
            onRefresh={refreshStatus}
          />

          {/* Hardware Status LED Diagnostic Guide */}
          <BridgeLedGuide />
        </div>
      )}

      {/* 4. MessagePack Telemetry Buffer Tab */}
      {activeTab === 'backlog' && (() => {
        const capacity = status?.backlog_capacity || 32768;
        const records = status?.backlog_records ?? 0;
        const pct = Math.min(100, Math.round((records / capacity) * 100));
        const hours10s = (capacity * 10 / 3600).toFixed(1);
        const hours5s = (capacity * 5 / 3600).toFixed(1);

        return (
          <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center space-x-2.5">
                  <Database className="w-5 h-5 text-emerald-400 shrink-0" />
                  <h3 className="text-base font-semibold text-white">ESP32 {status?.psram_active ? 'PSRAM' : 'SRAM'} Telemetry Ring Buffer</h3>
                </div>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Continuously records high-resolution telemetry in RAM across active desktop monitoring and standalone sleep modes, enabling connecting apps to backfill historical gaps.
                </p>
              </div>

              <div className="flex items-center space-x-2.5 shrink-0">
                <PrimaryButton
                  variant="secondary"
                  onClick={handleClearBacklog}
                  disabled={isClearingBacklog || records === 0}
                  isLoading={isClearingBacklog}
                  icon={
                    !isAuthenticated ? (
                      <Lock className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-400 transition-colors" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-400 transition-colors" />
                    )
                  }
                  size="md"
                  className="group whitespace-nowrap hover:border-rose-500/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <span>Clear Buffer</span>
                </PrimaryButton>

                <PrimaryButton
                  onClick={handleSyncBacklog}
                  disabled={isSyncingBacklog || records === 0}
                  isLoading={isSyncingBacklog}
                  icon={<Database className="w-3.5 h-3.5" />}
                  variant="primary"
                  size="md"
                  className="whitespace-nowrap"
                >
                  <span>Sync into UPSED History</span>
                </PrimaryButton>
              </div>
            </div>

            {/* Buffer Capacity Visualizer */}
            <div className="p-5 rounded-xl bg-black/30 border border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Buffer Utilization</span>
                <span className="text-white font-bold">
                  {records.toLocaleString()} / {capacity.toLocaleString()} records ({pct}%)
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-white/[0.05] overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    pct > 80
                      ? 'bg-rose-500'
                      : pct > 50
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(2, pct))}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>0 Records</span>
                <span>{capacity.toLocaleString()} Capacity (~{hours10s}h @ 10s / ~{hours5s}h @ 5s cadence)</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                <span className="text-slate-400 block mb-1">Encoding Format</span>
                <strong className="text-white font-mono">MessagePack (Binary)</strong>
                <p className="text-slate-500 text-[11px] mt-1">
                  4× more compact than JSON; stores up to {capacity.toLocaleString()} telemetry snapshots in {status?.psram_active ? 'PSRAM' : 'SRAM'}.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                <span className="text-slate-400 block mb-1">Catch-Up Ingestion</span>
                <strong className="text-white font-mono">Fast Batch Insertion</strong>
                <p className="text-slate-500 text-[11px] mt-1">
                  Transfers in chunks of 50 records and inserts in single SQLite transactions.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                <span className="text-slate-400 block mb-1">Overflow Protection</span>
                <strong className="text-white font-mono">FIFO Overwrite</strong>
                <p className="text-slate-500 text-[11px] mt-1">
                  Circular ring buffer automatically evicts the oldest sample when full.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 4. Live Debug Console Tab */}
      {activeTab === 'logs' && (
        <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-2.5">
              <Terminal className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-semibold text-white">Real-Time Diagnostic Debug Console</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Streaming
              </span>
            </div>

            <div className="flex items-center flex-wrap gap-2">
              {/* Level Filter */}
              <div className="flex rounded-lg bg-black/40 p-0.5 border border-white/10 text-xs font-mono">
                {(['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setLogFilter(lvl)}
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                      logFilter === lvl
                        ? 'bg-white/15 text-white font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              {/* Pause/Resume */}
              <button
                onClick={() => setIsPaused(!isPaused)}
                className={`p-1.5 rounded-lg border text-xs cursor-pointer transition ${
                  isPaused
                    ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                    : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white'
                }`}
                title={isPaused ? 'Resume stream' : 'Pause stream'}
              >
                <Clock className="w-4 h-4" />
              </button>

              {/* Copy */}
              <button
                onClick={handleCopyLogs}
                className="p-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white transition cursor-pointer"
                title="Copy all logs"
              >
                <Copy className="w-4 h-4" />
              </button>

              {/* Clear */}
              <button
                onClick={() => setLogs([])}
                className="p-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white transition cursor-pointer"
                title="Clear console view"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Console Window */}
          <div className="rounded-xl p-4 bg-black/75 border border-white/10 font-mono text-xs overflow-y-auto max-h-[460px] min-h-[300px] space-y-1.5 select-text">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-16 text-slate-600 italic">
                {logs.length === 0 ? 'Waiting for incoming bridge RPC notifications...' : 'No logs matching current filter.'}
              </div>
            ) : (
              filteredLogs.map((entry, index) => {
                const isError = entry.level === 'ERROR';
                const isWarn = entry.level === 'WARN';
                const isDebug = entry.level === 'DEBUG';
                const isInfo = entry.level === 'INFO';

                return (
                  <div
                    key={`${entry.seq}-${index}`}
                    className={`flex items-start gap-2.5 leading-relaxed ${
                      isError
                        ? 'text-rose-400 bg-rose-950/20 px-1.5 py-0.5 rounded'
                        : isWarn
                        ? 'text-amber-300 bg-amber-950/20 px-1.5 py-0.5 rounded'
                        : isDebug
                        ? 'text-slate-400 bg-slate-900/40 px-1.5 py-0.5 rounded'
                        : isInfo
                        ? 'text-slate-300'
                        : 'text-slate-500'
                    }`}
                  >
                    <span className="text-slate-600 shrink-0 text-[11px]">
                      {entry.timestamp ? entry.timestamp.split('T')[1]?.replace('Z', '') : `+${(entry.ms / 1000).toFixed(1)}s`}
                    </span>
                    <span className="text-slate-500 shrink-0 text-[11px]">
                      #{entry.seq}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0 uppercase ${
                        isError
                          ? 'bg-rose-500/20 text-rose-300'
                          : isWarn
                          ? 'bg-amber-500/20 text-amber-300'
                          : isDebug
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-emerald-500/20 text-emerald-400'
                      }`}
                    >
                      {entry.level}
                    </span>
                    <span className="text-cyan-400/80 shrink-0 font-medium text-[11px]">
                      [{entry.source}]
                    </span>
                    <span className="break-all whitespace-pre-wrap flex-1">
                      {entry.msg}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={consoleBottomRef} />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <div className="flex items-center space-x-2">
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded bg-white/10 border-white/20 text-emerald-500 focus:ring-0"
                />
                <span>Auto-scroll to bottom</span>
              </label>
              {isPaused && <span className="text-amber-400 font-medium">(Stream paused)</span>}
            </div>
            <span>Buffered logs: {logs.length} (Max 300)</span>
          </div>
        </div>
      )}

      {/* 5. Smart Home Integrations Tab */}
      {activeTab === 'smart-home' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: TuyaLink MQTT Cloud Controller Configuration */}
          <form
            onSubmit={handleSaveTuyaConfig}
            className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-5"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center space-x-2.5">
                <Radio className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-base font-semibold text-white">TuyaLink MQTT Cloud Controller</h3>
                  <p className="text-xs text-slate-400">
                    Direct ESP32-S3 TLS 8883 connection for Smart Life scenes & remote UPS control
                  </p>
                </div>
              </div>

              {tuyaConfig.connected ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected ({tuyaConfig.region?.toUpperCase() || 'EU'})
                </span>
              ) : !tuyaConfig.enabled ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-slate-800 text-slate-400 border border-white/5">
                  Disabled
                </span>
              ) : tuyaConfig.state === 'auth_failed' ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Auth Failed
                </span>
              ) : tuyaConfig.state === 'waiting_ntp' ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  Clock Syncing...
                </span>
              ) : tuyaConfig.state === 'connecting' ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
                  Connecting {tuyaConfig.retry_count ? `(#${tuyaConfig.retry_count})` : ''}
                </span>
              ) : tuyaConfig.state === 'retrying' ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Clock className="w-3.5 h-3.5" />
                  Retrying {tuyaConfig.next_retry_sec ? `in ${tuyaConfig.next_retry_sec}s` : ''} {tuyaConfig.retry_count ? `(#${tuyaConfig.retry_count})` : ''}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Disconnected
                </span>
              )}
            </div>

            {/* Live Interlock & Output Status Strip */}
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-black/30 border border-white/[0.06]">
                <span className="text-slate-400 text-[11px] block">TLS Broker</span>
                <span className="font-mono text-white font-medium text-[11px]">
                  {tuyaConfig.broker || `m1.tuya${tuyaConfig.region || 'eu'}.com`}:8883
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-black/30 border border-white/[0.06]">
                <span className="text-slate-400 text-[11px] block">UPS AC Output</span>
                <span
                  className={`font-semibold text-[11px] ${
                    tuyaConfig.output_enabled ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                >
                  {tuyaConfig.output_enabled ? 'Energized (ON)' : 'Standby / Off'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-black/30 border border-white/[0.06]">
                <span className="text-slate-400 text-[11px] block">Host Interlock</span>
                <span
                  className={`font-semibold text-[11px] ${
                    tuyaConfig.pc_online ? 'text-amber-400' : 'text-cyan-400'
                  }`}
                >
                  {tuyaConfig.pc_online ? 'PC Online (Protected)' : 'PC Offline (Ready)'}
                </span>
              </div>
            </div>

            {tuyaConfig.last_error && tuyaConfig.last_error !== 'None' && tuyaConfig.last_error !== 'Idle' && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span className="font-mono text-[11px]">{tuyaConfig.last_error}</span>
              </div>
            )}

            {/* Enable Toggle & Region */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-between p-3 rounded-xl bg-black/25 border border-white/[0.06] cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">Enable TuyaLink MQTT</div>
                  <div className="text-[11px] text-slate-400">24/7 autonomous ESP32 link</div>
                </div>
                <input
                  type="checkbox"
                  checked={tuyaConfig.enabled}
                  onChange={(e) => setTuyaConfig({ ...tuyaConfig, enabled: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </label>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Tuya Data Center Region</label>
                <select
                  value={tuyaConfig.region}
                  onChange={(e) => setTuyaConfig({ ...tuyaConfig, region: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="eu">Central Europe (m1.tuyaeu.com)</option>
                  <option value="us">Western America (m1.tuyaus.com)</option>
                  <option value="cn">China Data Center (m1.tuyacn.com)</option>
                  <option value="in">India Data Center (m1.tuyain.com)</option>
                </select>
              </div>
            </div>

            {/* Tuya Credentials */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Product ID (PID)</label>
                  <input
                    type="text"
                    value={tuyaConfig.product_id}
                    onChange={(e) => setTuyaConfig({ ...tuyaConfig, product_id: e.target.value.trim() })}
                    placeholder="e.g. vu8x9a2b..."
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Device ID</label>
                  <input
                    type="text"
                    value={tuyaConfig.device_id}
                    onChange={(e) => setTuyaConfig({ ...tuyaConfig, device_id: e.target.value.trim() })}
                    placeholder="e.g. 6c92d8f1..."
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Device Secret (HMAC-SHA256 Key)</label>
                <div className="relative">
                  <input
                    type={showTuyaSecret ? 'text' : 'password'}
                    value={tuyaConfig.device_secret}
                    onChange={(e) => setTuyaConfig({ ...tuyaConfig, device_secret: e.target.value })}
                    placeholder={tuyaConfig.has_secret ? '******** (Stored in ESP32 NVS)' : 'Enter Tuya Device Secret'}
                    className="w-full pl-3 pr-9 py-2 rounded-xl bg-black/40 border border-white/10 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTuyaSecret(!showTuyaSecret)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showTuyaSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Hardware Safety Policy & Interlock */}
            <div className="p-3.5 rounded-xl bg-black/25 border border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Smart Load & Host Safety Interlock
                </span>
                <span className="text-[10px] font-mono text-emerald-400">
                  Threshold: {tuyaConfig.interlock_pct}% Load
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Power-Off Command Mode</label>
                  <select
                    value={tuyaConfig.off_mode}
                    onChange={(e) => setTuyaConfig({ ...tuyaConfig, off_mode: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="SOFF">SOFF (Standby Off — Online / P-Series)</option>
                    <option value="S.2">S.2 (12s Delayed Shutdown — Megatec)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Block Power-Off When Load &gt; {tuyaConfig.interlock_pct}%
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={tuyaConfig.interlock_pct}
                    onChange={(e) =>
                      setTuyaConfig({ ...tuyaConfig, interlock_pct: Number(e.target.value) })
                    }
                    className="w-full accent-emerald-500 cursor-pointer mt-1"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Turning the UPS <strong>ON</strong> (<code className="text-emerald-300">SON</code>) is always allowed. Turning the UPS <strong>OFF</strong> via <code className="text-cyan-300">ups_power_switch</code> is automatically blocked if UPSED Desktop is connected or load exceeds {tuyaConfig.interlock_pct}% (use <code className="text-rose-300">force_shutdown</code> DP to override).
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2.5 pt-1 flex-wrap">
              <PrimaryButton
                type="submit"
                disabled={isSavingTuya}
                icon={!isAuthenticated ? <Lock className="w-4 h-4 text-slate-400" /> : <CheckCircle2 className="w-4 h-4" />}
              >
                {isSavingTuya ? 'Saving to ESP32...' : 'Save TuyaLink Config'}
              </PrimaryButton>

              <button
                type="button"
                onClick={handleTestTuyaPublish}
                disabled={isTestingTuya || !tuyaConfig.enabled}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition cursor-pointer disabled:opacity-50"
              >
                <Send className={`w-3.5 h-3.5 text-cyan-400 ${isTestingTuya ? 'animate-pulse' : ''}`} />
                <span>{isTestingTuya ? 'Publishing...' : 'Push Telemetry Now'}</span>
              </button>

              <button
                type="button"
                onClick={handleReconnectTuya}
                disabled={isReconnectingTuya || !tuyaConfig.enabled}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition cursor-pointer disabled:opacity-50"
                title="Force an immediate reconnection attempt to Tuya Cloud"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isReconnectingTuya ? 'animate-spin' : ''}`} />
                <span>{isReconnectingTuya ? 'Reconnecting...' : 'Reconnect Now'}</span>
              </button>

              <button
                type="button"
                onClick={refreshTuyaConfig}
                className="p-2 rounded-xl text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition cursor-pointer"
                title="Refresh Tuya status from ESP32"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* Right Column: 19-DP Tuya Schema & Cold-Boot / Wake Workflow Guide */}
          <div className="space-y-6">
            <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center space-x-2.5">
                  <Sliders className="w-5 h-5 text-cyan-400" />
                  <div>
                    <h3 className="text-base font-semibold text-white">19-DP TuyaLink Things Data Model</h3>
                    <p className="text-xs text-slate-400">
                      Import directly into Tuya IoT Platform under Product $\rightarrow$ Function Definition
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleDownloadTuyaExcel}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition cursor-pointer"
                    title="Download Excel (.xlsx) workbook formatted for Tuya Batch Import"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Excel (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadTuyaCsv}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300/90 border border-emerald-500/20 transition cursor-pointer"
                    title="Download CSV (.csv) template formatted for Tuya Batch Import"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download CSV (.csv)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyTuyaSchema}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition cursor-pointer"
                    title="Copy 19-DP TuyaLink Things Data Model JSON to clipboard"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy JSON</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                <div className="p-3 rounded-xl bg-black/35 border border-white/[0.06] space-y-1">
                  <div className="text-amber-400 font-semibold uppercase tracking-wider text-[10px]">
                    Power & Boot Control (R/W)
                  </div>
                  <div className="font-mono text-slate-300 space-y-0.5">
                    <div>• ups_power_switch (bool)</div>
                    <div>• force_shutdown (bool)</div>
                    <div>• cancel_shutdown (bool)</div>
                    <div>• outlet_1_switch / outlet_2_switch</div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-black/35 border border-white/[0.06] space-y-1">
                  <div className="text-emerald-400 font-semibold uppercase tracking-wider text-[10px]">
                    Diagnostics & Audio (R/W)
                  </div>
                  <div className="font-mono text-slate-300 space-y-0.5">
                    <div>• buzzer_mute (bool)</div>
                    <div>• battery_test_10s (bool)</div>
                    <div>• deep_battery_test (bool)</div>
                    <div>• cancel_test (bool)</div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-black/35 border border-white/[0.06] space-y-1 sm:col-span-2">
                  <div className="text-cyan-400 font-semibold uppercase tracking-wider text-[10px]">
                    Live Telemetry & Scene Condition Triggers (Read-Only)
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 font-mono text-slate-300">
                    <div>• output_enabled</div>
                    <div>• pc_online</div>
                    <div>• ups_mode (enum)</div>
                    <div>• grid_voltage (V)</div>
                    <div>• output_voltage (V)</div>
                    <div>• load_pct (%)</div>
                    <div>• battery_pct (%)</div>
                    <div>• battery_voltage (V)</div>
                    <div>• temperature_c (°C)</div>
                    <div>• utility_fail</div>
                    <div>• battery_low</div>
                  </div>
                </div>
              </div>

              {/* Collapsible Cold Boot & Sleep Wake Scene Recipe */}
              <div className="pt-1 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setIsTuyaRecipeOpen(!isTuyaRecipeOpen)}
                  className="w-full flex items-center justify-between text-xs font-medium text-slate-300 hover:text-white py-1.5 cursor-pointer"
                >
                  <span>Smart Plug + UPS + PCIe Wake Card Scene Setup Guide</span>
                  {isTuyaRecipeOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {isTuyaRecipeOpen && (
                  <div className="mt-2 p-3.5 rounded-xl bg-black/40 border border-white/[0.06] text-xs text-slate-300 space-y-2 leading-relaxed">
                    <div className="font-semibold text-white">
                      Single-Tap Cold Boot & Sleep Wake Workflow (Tuya Smart Life App):
                    </div>
                    <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-300">
                      <li>
                        <strong>Step 1 (Smart Plug):</strong> Set upstream Smart Plug switch to <code className="text-emerald-400">ON</code>.
                      </li>
                      <li>
                        <strong>Step 2 (Timer Delay):</strong> Add a <code className="text-cyan-300">5s Delay</code> in the Tuya Scene so the UPS MCU stabilizes on AC mains.
                      </li>
                      <li>
                        <strong>Step 3 (UPSED Bridge):</strong> Set <code className="text-amber-300">ups_power_switch = true</code> (ESP32 dispatches <code className="text-emerald-400">SON\r</code> to energize UPS AC output).
                      </li>
                      <li>
                        <strong>Step 4 (Timer Delay):</strong> Add a <code className="text-cyan-300">3s Delay</code> so the PC ATX PSU +5VSB standby rail charges the PCIe card.
                      </li>
                      <li>
                        <strong>Step 5 (PCIe Wake Card):</strong> Trigger PCIe Wake Card <code className="text-emerald-400">Power ON</code> to boot or wake the PC!
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            </div>

            {/* Home Assistant MQTT Card */}
            <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <Share2 className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Home Assistant MQTT Auto-Discovery</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  Companion
                </span>
              </div>
              <p className="text-xs text-slate-400">
                The same telemetry snapshot parsed on the ESP32-S3 also powers local WebSocket failover and Home Assistant sensor discovery.
              </p>
            </div>
          </div>

          {/* Hardware Status LED Diagnostic Guide */}
          <BridgeLedGuide />
        </div>
      )}

      {/* 4. Firmware & Wireless OTA Tab */}
      {activeTab === 'ota' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Firmware Overview & Release Status */}
          <div className="space-y-6">
            {/* Card 1: Active Firmware & Version Checker */}
            <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <Cpu className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-base font-semibold text-white">Bridge Firmware Version</h3>
                </div>
                {firmwareCheck?.update_available ? (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Update Available
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-white/5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Up To Date
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-1">
                  <div className="text-slate-400 text-[11px]">Installed on ESP32</div>
                  <div className="text-base font-bold text-white font-mono">
                    {status?.fw || '1.0.0'}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    Target: ESP32-S3 DevKitC-1
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-1">
                  <div className="text-slate-400 text-[11px]">Latest Release (GitHub)</div>
                  <div className="text-base font-bold text-emerald-400 font-mono">
                    {firmwareCheck?.latest_version || status?.fw || 'v1.0.0'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {firmwareCheck?.published_at
                      ? new Date(firmwareCheck.published_at).toLocaleDateString()
                      : 'Sandakan/UPSED'}
                  </div>
                </div>
              </div>

              {/* Release Notes */}
              {firmwareCheck?.release_notes && (
                <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-1.5 text-xs">
                  <div className="font-semibold text-slate-300 flex items-center justify-between">
                    <span>Release Notes ({firmwareCheck.latest_version})</span>
                    {firmwareCheck.binary_size && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        {Math.round(firmwareCheck.binary_size / 1024)} KB
                      </span>
                    )}
                  </div>
                  <div
                    className="changelog-markdown text-slate-400 text-[11px] leading-relaxed max-h-36 overflow-y-auto custom-scrollbar"
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(firmwareCheck.release_notes, { gfm: true, breaks: true }) as string,
                    }}
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleCheckUpdate()}
                    disabled={isCheckingUpdate}
                    className="flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition cursor-pointer border border-white/[0.06] disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin text-emerald-400' : ''}`} />
                    <span>{isCheckingUpdate ? 'Checking GitHub...' : 'Check Updates'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsChangelogOpen(true);
                      if (!changelogContent) {
                        fetchChangelog();
                      }
                    }}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition cursor-pointer border border-white/[0.06]"
                  >
                    <FileText className="w-3.5 h-3.5 text-cyan-400" />
                    <span>View Changelog</span>
                  </button>
                </div>

                {firmwareCheck?.download_url && (
                  <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                    <Download className="w-3 h-3 text-emerald-400" />
                    Asset Verified
                  </span>
                )}
              </div>
            </div>

            {/* Card 2: Local Developer Binary (Developer Mode Only) */}
            {isDev && (
              <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <FileCode className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-base font-semibold text-white">Local PlatformIO Build</h3>
                  </div>
                  {firmwareCheck?.local_binary_path ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1.5">
                      <span className="font-bold">
                        {firmwareCheck.local_binary_version ? `v${firmwareCheck.local_binary_version.replace(/^v/, '')}` : 'v1.3.0'}
                      </span>
                      <span>• Compiled Ready</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-400 border border-white/5">
                      Not Found
                    </span>
                  )}
                </div>

                {firmwareCheck?.local_binary_path ? (
                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">Artifact:</span>
                      <span className="text-white font-mono font-medium">firmware.bin</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">Build Version:</span>
                      <span className="text-cyan-400 font-mono font-bold">
                        {firmwareCheck.local_binary_version ? `v${firmwareCheck.local_binary_version.replace(/^v/, '')}` : 'v1.3.0'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">Size:</span>
                      <span className="text-cyan-400 font-mono font-semibold">
                        {Math.round((firmwareCheck.local_binary_size || 0) / 1024)} KB
                      </span>
                    </div>
                    {firmwareCheck.local_binary_modified && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[11px]">Last Built:</span>
                        <span className="text-slate-300 font-mono text-[11px]">
                          {firmwareCheck.local_binary_modified}
                        </span>
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500 font-mono truncate pt-1 border-t border-white/[0.04]">
                      {firmwareCheck.local_binary_path}
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] text-xs text-slate-400 space-y-1">
                    <div>No local PlatformIO build detected at:</div>
                    <div className="text-[11px] font-mono text-slate-300">
                      upsed-bridge/.pio/build/esp32-s3-devkitc-1/firmware.bin
                    </div>
                    <div className="text-[11px] text-slate-500 pt-1">
                      Run <code className="text-cyan-300">npm run bridge:build</code> in terminal to compile locally.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Card 3: Safety & Invariant Guarantees */}
            <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-3">
              <div className="flex items-center space-x-2 text-emerald-400">
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <h4 className="text-sm font-semibold text-white">Hardware Safety & Security Guarantees</h4>
              </div>
              <ul className="text-xs text-slate-400 space-y-2 leading-relaxed">
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">On-Demand Port 8080 Lease:</strong> The HTTP OTA server is closed by default. It opens strictly for 90 seconds upon authenticated command and auto-closes on timeout or reboot.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">Strict Secret Enforcement:</strong> Transfers require <code className="text-cyan-300">UPSED_OTA_SECRET</code> matching between desktop and bridge via <code className="text-slate-300">X-UPSED-OTA-TOKEN</code>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">RS-232 Telemetry Isolation:</strong> UPS communication is safely suspended during flash to eliminate hardware UART collisions and flash writes contention.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">Visual Status Indication:</strong> Onboard RGB LED blinks Magenta during authentication/staging, pulses Magenta while streaming chunks, and flashes solid Green upon completion before rebooting.
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Right Column: Wireless Flashing Controls & Live Progress */}
          <div className="space-y-6">
            <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <UploadCloud className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-base font-semibold text-white">Wireless Firmware Flashing</h3>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Dual-OTA Engine
                </span>
              </div>

              <p className="text-xs text-slate-400">
                Flash pre-compiled firmware binaries directly to the ESP32-S3 over local Wi-Fi without attaching physical USB cables.
              </p>

              {/* Source Selection */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-300 block">Firmware Source</label>
                <div className="space-y-2">
                  {/* GitHub option */}
                  <label
                    className={`flex items-start space-x-3 p-3 rounded-xl border transition cursor-pointer ${
                      otaSource === 'github'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                        : 'bg-black/20 border-white/[0.06] text-slate-400 hover:bg-white/[0.03]'
                    } ${!firmwareCheck?.download_url ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="radio"
                      name="otaSource"
                      value="github"
                      checked={otaSource === 'github'}
                      onChange={() => setOtaSource('github')}
                      disabled={!firmwareCheck?.download_url || isFlashingOta}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-white flex items-center gap-2">
                        <span>Official GitHub Release</span>
                        {firmwareCheck?.latest_version && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                            {firmwareCheck.latest_version}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 text-[11px] mt-0.5">
                        {firmwareCheck?.download_url
                          ? 'Automated download from Sandakan/UPSED releases'
                          : 'No remote release binary currently published on GitHub'}
                      </div>
                    </div>
                  </label>

                  {/* Local build option (Developer Mode Only) */}
                  {isDev && (
                    <label
                      className={`flex items-start space-x-3 p-3 rounded-xl border transition cursor-pointer ${
                        otaSource === 'local'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                          : 'bg-black/20 border-white/[0.06] text-slate-400 hover:bg-white/[0.03]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="otaSource"
                        value="local"
                        checked={otaSource === 'local'}
                        onChange={() => setOtaSource('local')}
                        disabled={isFlashingOta}
                        className="mt-0.5 accent-emerald-500"
                      />
                      <div className="text-xs">
                        <div className="font-semibold text-white flex items-center gap-2">
                          <span>Local PlatformIO Build</span>
                          {firmwareCheck?.local_binary_version && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold">
                              v{firmwareCheck.local_binary_version.replace(/^v/, '')}
                            </span>
                          )}
                          {firmwareCheck?.local_binary_size && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                              {Math.round(firmwareCheck.local_binary_size / 1024)} KB
                            </span>
                          )}
                        </div>
                        <div className="text-slate-400 text-[11px] mt-0.5">
                          {firmwareCheck?.local_binary_path
                            ? 'Flash latest locally compiled firmware.bin'
                            : 'Run npm run bridge:build or npm run bridge:ota to generate local binary'}
                        </div>
                      </div>
                    </label>
                  )}

                  {/* Custom file option */}
                  <label
                    className={`flex items-start space-x-3 p-3 rounded-xl border transition cursor-pointer ${
                      otaSource === 'file'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-white'
                        : 'bg-black/20 border-white/[0.06] text-slate-400 hover:bg-white/[0.03]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="otaSource"
                      value="file"
                      checked={otaSource === 'file'}
                      onChange={() => setOtaSource('file')}
                      disabled={isFlashingOta}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div className="text-xs w-full">
                      <div className="font-semibold text-white">Custom Binary File (.bin)</div>
                      <div className="text-slate-400 text-[11px] mt-0.5">
                        Select or enter path to an external ESP32-S3 firmware image
                      </div>
                      {otaSource === 'file' && (
                        <div className="mt-2">
                          <input
                            type="text"
                            placeholder="C:\path\to\firmware.bin"
                            value={customBinaryPath}
                            onChange={(e) => setCustomBinaryPath(e.target.value)}
                            disabled={isFlashingOta}
                            className="w-full px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
                          />
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <PrimaryButton
                  onClick={handleFlashOta}
                  disabled={
                    isFlashingOta ||
                    (otaSource === 'github' && !firmwareCheck?.download_url) ||
                    (otaSource === 'local' && !firmwareCheck?.local_binary_path) ||
                    (otaSource === 'file' && !customBinaryPath)
                  }
                  icon={<Zap className={`w-4 h-4 ${isFlashingOta ? 'animate-pulse text-amber-400' : ''}`} />}
                  className="w-full justify-center py-2.5"
                >
                  {isFlashingOta ? 'Flashing Bridge Wirelessly...' : 'Flash Firmware Wirelessly'}
                </PrimaryButton>
              </div>

              {/* Live Multi-Stage Progress Visualizer */}
              {(isFlashingOta || otaProgress) && (
                <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white flex items-center gap-2">
                      {isFlashingOta && <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />}
                      <span className="capitalize">{otaProgress?.phase || 'Processing'}</span>
                    </span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {otaProgress?.percentage ?? 0}%
                    </span>
                  </div>

                  {/* Multi-stage bar */}
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        otaProgress?.phase === 'error'
                          ? 'bg-rose-500'
                          : otaProgress?.phase === 'success'
                          ? 'bg-emerald-400'
                          : 'bg-gradient-to-r from-emerald-500 to-cyan-400'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, otaProgress?.percentage ?? 0))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate pr-2">
                      {otaProgress?.message || 'Executing wireless update pipeline...'}
                    </span>
                    {otaProgress?.total_bytes ? (
                      <span className="font-mono shrink-0">
                        {Math.round((otaProgress.bytes_transferred || 0) / 1024)} /{' '}
                        {Math.round(otaProgress.total_bytes / 1024)} KB
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            {/* Card: PlatformIO CLI Alternative (Developer Mode Only) */}
            {isDev && (
              <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Terminal className="w-4 h-4 text-cyan-400" />
                    <h4 className="text-sm font-semibold text-white">PlatformIO CLI Flashing Alternative</h4>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">Port 3232</span>
                </div>
                <p className="text-xs text-slate-400">
                  Developers can also flash wireless updates directly from terminal using PlatformIO's <code className="text-cyan-300">espota</code> protocol:
                </p>
                <div className="p-3 rounded-xl bg-black/50 border border-white/[0.06] font-mono text-xs text-emerald-400 flex items-center justify-between">
                  <span>npm run bridge:ota</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('npm run bridge:ota');
                      toast.success('Copied CLI command to clipboard');
                    }}
                    className="p-1 hover:text-white transition cursor-pointer text-slate-400"
                    title="Copy command"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-[11px] text-slate-500">
                  Uses authentication token configured in <code className="text-slate-400">.env</code>.
                </div>
              </div>
            )}
          </div>

          {/* Hardware Status LED Diagnostic Guide */}
          <BridgeLedGuide />
        </div>
      )}

      {/* ── Firmware Changelog Modal (On-Demand GitHub Fetch) ────────────── */}
      {isChangelogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-2xl max-h-[85vh] rounded-2xl bg-[#1a1d24] border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-white/[0.07] flex items-center justify-between bg-black/20">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Bridge Firmware Changelog</h3>
                  <p className="text-xs text-slate-400">
                    Live version history from <code className="text-cyan-300">Sandakan/UPSED</code> on GitHub
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => fetchChangelog()}
                  disabled={isChangelogLoading}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer disabled:opacity-50"
                  title="Refresh changelog"
                >
                  <RefreshCw className={`w-4 h-4 ${isChangelogLoading ? 'animate-spin text-cyan-400' : ''}`} />
                </button>
                <button
                  onClick={() => setIsChangelogOpen(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer"
                  title="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4">
              {isChangelogLoading ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3 text-slate-400">
                  <RefreshCw className="w-7 h-7 animate-spin text-cyan-400" />
                  <span className="text-xs">Fetching latest changelog from GitHub...</span>
                </div>
              ) : changelogError ? (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 space-y-3">
                  <div className="flex items-center space-x-2.5 text-red-400">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span className="text-xs font-semibold">Unable to Load Changelog</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{changelogError}</p>
                  <div className="pt-1">
                    <button
                      onClick={() => fetchChangelog()}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition cursor-pointer"
                    >
                      Retry Connection
                    </button>
                  </div>
                </div>
              ) : changelogContent ? (
                <div
                  className="changelog-markdown text-xs text-slate-300 leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: marked.parse(changelogContent, { gfm: true, breaks: true }) as string,
                  }}
                />
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-black/30 border-t border-white/[0.07] flex items-center justify-between">
              <a
                href="https://github.com/Sandakan/UPSED/blob/main/upsed-bridge/CHANGELOG.md"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-xl border border-white/[0.08] transition cursor-pointer"
              >
                <span>View on GitHub</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </a>

              <PrimaryButton onClick={() => setIsChangelogOpen(false)} size="sm">
                Close
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* ── Wireless OTA Confirmation Modal ───────────────────────────────── */}
      {isOtaConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-lg rounded-2xl bg-[#1a1d24] border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-white/[0.07] flex items-center justify-between bg-black/20">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Wireless Firmware Flash</h3>
                  <p className="text-xs text-slate-400">
                    Target: ESP32-S3 Bridge ({status?.ip || 'Wi-Fi Link'})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOtaConfirmOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-xs text-slate-300">
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Firmware Source:</span>
                  <span className="text-white font-medium capitalize">
                    {otaSource === 'local' ? 'Local PlatformIO Build' : otaSource === 'github' ? 'Official GitHub Release' : 'Custom Local File'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Target Version:</span>
                  <span className="text-cyan-400 font-mono font-bold">
                    {otaSource === 'local'
                      ? (firmwareCheck?.local_binary_version ? `v${firmwareCheck.local_binary_version.replace(/^v/, '')}` : 'v1.3.0')
                      : otaSource === 'github'
                      ? (firmwareCheck?.latest_version || 'Latest')
                      : 'Custom Binary'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Size:</span>
                  <span className="text-slate-300 font-mono">
                    {otaSource === 'local' && firmwareCheck?.local_binary_size
                      ? `${Math.round(firmwareCheck.local_binary_size / 1024)} KB`
                      : otaSource === 'github' && firmwareCheck?.binary_size
                      ? `${Math.round(firmwareCheck.binary_size / 1024)} KB`
                      : 'Verified'}
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-slate-400">
                <div className="font-semibold text-slate-200">During flashing:</div>
                <ul className="space-y-1.5 list-disc list-inside leading-relaxed text-[11px]">
                  <li>The bridge opens an on-demand leased OTA server on port 8080.</li>
                  <li>RS-232 telemetry polling is paused to prevent serial collisions.</li>
                  <li>The onboard RGB LED blinks magenta during authentication, pulses magenta while streaming, and flashes solid green before rebooting.</li>
                  <li>Upon completion, the bridge will reboot and automatically reconnect.</li>
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-black/30 border-t border-white/[0.07] flex items-center justify-end space-x-3">
              <button
                onClick={() => setIsOtaConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition border border-white/[0.08]"
              >
                Cancel
              </button>
              <PrimaryButton onClick={executeFlashOta} size="sm">
                {!isAuthenticated ? <Lock className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                <span>Confirm & Flash Wirelessly</span>
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* ── Purge Backlog Confirmation Modal ──────────────────────────────── */}
      {isPurgeConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-md rounded-2xl bg-[#1a1d24] border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-white/[0.07] flex items-center justify-between bg-black/20">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Purge ESP32 Telemetry Buffer</h3>
                  <p className="text-xs text-slate-400">Reset in-memory rotating telemetry</p>
                </div>
              </div>
              <button
                onClick={() => setIsPurgeConfirmOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 text-xs text-slate-300 leading-relaxed">
              Are you sure you want to purge all telemetry records buffered in the ESP32 PSRAM ring buffer? This cannot be undone.
            </div>
            <div className="p-4 bg-black/30 border-t border-white/[0.07] flex items-center justify-end space-x-3">
              <button
                onClick={() => setIsPurgeConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition border border-white/[0.08]"
              >
                Cancel
              </button>
              <button
                onClick={executeClearBacklog}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition shadow-sm cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Purge Records</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

