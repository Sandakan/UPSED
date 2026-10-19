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
  Server,
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
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { listen } from '@tauri-apps/api/event';
import { api } from '../lib/tauri';
import {
  BridgeStatus,
  BridgeLogEntry,
  WifiScanNetwork,
  WsTestResult,
  WifiProvisionStatusEvent,
} from '../lib/types';
import { PrimaryButton } from '../components/PrimaryButton';

export interface IoTProps {
  portName?: string | null;
}

export const IoT: React.FC<IoTProps> = ({ portName }) => {
  const queryClient = useQueryClient();
  // Status & Telemetry
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [activeTab, setActiveTab] = useState<'wifi' | 'ws' | 'backlog' | 'logs' | 'smart-home'>('wifi');

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

  // WebSocket Failover & Discovery
  const [fallbackHost, setFallbackHost] = useState('upsed-bridge.local');
  const [isSavingHost, setIsSavingHost] = useState(false);
  const [wsTestResult, setWsTestResult] = useState<WsTestResult | null>(null);
  const [isTestingWs, setIsTestingWs] = useState(false);
  const [isDiscoveringLan, setIsDiscoveringLan] = useState(false);

  // Backlog Manager
  const [isSyncingBacklog, setIsSyncingBacklog] = useState(false);
  const [isClearingBacklog, setIsClearingBacklog] = useState(false);

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
    setIsLoadingStatus(true);
    try {
      const [st, savedHost] = await Promise.all([
        api.getBridgeStatus(portName ?? undefined).catch(() => null),
        api.getBridgeFallbackHost().catch(() => 'upsed-bridge.local'),
      ]);
      setStatus(st);
      if (savedHost) {
        setFallbackHost(savedHost);
      }
      if (st?.ssid && !ssid) {
        setSsid(st.ssid);
      }
    } finally {
      setIsLoadingStatus(false);
    }
  }, [portName, ssid]);

  // Initial load: status and log history
  useEffect(() => {
    refreshStatus();
    api.getBridgeLogHistory()
      .then((history) => {
        if (history && history.length > 0) {
          setLogs(history);
        }
      })
      .catch(() => {});
  }, [refreshStatus]);

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
    } finally {
      setIsSavingHost(false);
    }
  };

  // Sync Backlog
  const handleSyncBacklog = async () => {
    setIsSyncingBacklog(true);
    try {
      const imported = await api.syncBridgeBacklog(portName ?? undefined);
      await refreshStatus();
      toast.custom(
        JSON.stringify({
          title: 'ESP32 Offline Backlog Synced',
          description:
            imported > 0
              ? `Imported ${imported} MessagePack telemetry samples from ESP32 PSRAM into UPSED History.`
              : 'ESP32 ring buffer is already up to date (0 pending offline samples).',
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
          title: 'Backlog Sync Failed',
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
  const handleClearBacklog = async () => {
    if (!window.confirm('Are you sure you want to purge all offline telemetry records buffered in ESP32 PSRAM?')) {
      return;
    }
    setIsClearingBacklog(true);
    try {
      await api.clearBridgeBacklog(portName ?? undefined);
      await refreshStatus();
      toast.custom(
        JSON.stringify({
          title: 'ESP32 Backlog Cleared',
          description: 'PSRAM ring buffer has been reset to 0 records.',
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
          title: 'Failed to Clear Backlog',
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
            Real-time JSON-RPC 2.0 telemetry bridge, Wi-Fi provisioning, WebSocket failover & PSRAM MessagePack backlog.
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
              <span>FW: <strong className="text-slate-200">{status?.fw || '—'}</strong></span>
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

        {/* Card 3: PSRAM Offline Backlog */}
        <div className="rounded-2xl p-4 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">PSRAM Backlog</span>
            <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
              (status?.backlog_records ?? 0) > 0
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            }`}>
              {(status?.backlog_records ?? 0) > 0 ? `${status?.backlog_records} Pending` : 'In Sync'}
            </span>
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-white font-mono">
              {(status?.backlog_records ?? 0).toLocaleString()} <span className="text-xs font-normal text-slate-400">/ {(status?.backlog_capacity ?? 50000).toLocaleString()}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-slate-500" />
              <span>
                PSRAM: {status?.psram_active ? `${Math.round((status.psram_free ?? 0) / 1024)} KB free` : 'Disabled'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Uptime & Diagnostics */}
        <div className="rounded-2xl p-4 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ESP32 Uptime</span>
            <span className="text-[11px] font-mono text-slate-400">
              Seq #{status?.log_seq ?? 0}
            </span>
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-white font-mono">
              {status?.uptime_sec ? formatUptime(status.uptime_sec) : '0s'}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-mono">Port {status?.ws_port ?? 81} • wsServer</span>
            </div>
          </div>
        </div>
      </div>

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
          onClick={() => setActiveTab('backlog')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
            activeTab === 'backlog'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>MessagePack Backlog</span>
          {(status?.backlog_records ?? 0) > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-black font-bold">
              {status?.backlog_records}
            </span>
          )}
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
                    <Send className="w-3.5 h-3.5 mr-1.5" />
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Target Host Settings */}
          <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2.5 mb-4">
                <Globe className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-semibold text-white">WebSocket Host & Failover Endpoint</h3>
              </div>

              <p className="text-xs text-slate-400 mb-4">
                When USB serial is unplugged or disconnected, UPSED seamlessly switches transport to WebSocket via this address (port 81).
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Bridge Hostname or Static IP
                  </label>
                  <input
                    type="text"
                    value={fallbackHost}
                    onChange={(e) => setFallbackHost(e.target.value)}
                    placeholder="upsed-bridge.local or 192.168.1.150"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-500/50"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Default is <code className="text-slate-400">upsed-bridge.local</code> via mDNS multicast.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSaveFallbackHost}
                    disabled={isSavingHost}
                    className="px-3.5 py-2 rounded-xl text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-500 transition cursor-pointer disabled:opacity-50"
                  >
                    {isSavingHost ? 'Saving...' : 'Save Failover Host'}
                  </button>

                  <button
                    onClick={handleDiscoverLan}
                    disabled={isDiscoveringLan}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isDiscoveringLan ? 'animate-spin text-cyan-400' : ''}`} />
                    <span>{isDiscoveringLan ? 'Sweeping Subnet...' : 'Fast LAN Subnet Discovery'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-white/[0.08] text-[11px] text-slate-500 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Host persistence stored in UPSED SQLite database app settings table.</span>
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
      )}

      {/* 3. MessagePack Offline Backlog Tab */}
      {activeTab === 'backlog' && (
        <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2.5">
                <Database className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-semibold text-white">ESP32 PSRAM Offline Ring Buffer</h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                When the host PC is powered down or asleep, the ESP32 autonomously polls the UPS every 10 seconds and buffers telemetry in 8MB PSRAM using binary MessagePack formatting.
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={handleClearBacklog}
                disabled={isClearingBacklog || (status?.backlog_records ?? 0) === 0}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition cursor-pointer disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Buffer</span>
              </button>

              <PrimaryButton
                onClick={handleSyncBacklog}
                disabled={isSyncingBacklog || (status?.backlog_records ?? 0) === 0}
                variant="primary"
                className="text-xs"
              >
                {isSyncingBacklog ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Syncing Records...
                  </>
                ) : (
                  <>
                    <Database className="w-3.5 h-3.5 mr-1.5" />
                    Sync into UPSED History
                  </>
                )}
              </PrimaryButton>
            </div>
          </div>

          {/* Buffer Capacity Visualizer */}
          <div className="p-5 rounded-xl bg-black/30 border border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Buffer Utilization</span>
              <span className="text-white font-bold">
                {status?.backlog_records ?? 0} / {status?.backlog_capacity ?? 50000} records (
                {Math.round(((status?.backlog_records ?? 0) / (status?.backlog_capacity ?? 50000)) * 100)}%)
              </span>
            </div>
            <div className="w-full h-3 rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  ((status?.backlog_records ?? 0) / (status?.backlog_capacity ?? 50000)) > 0.8
                    ? 'bg-rose-500'
                    : ((status?.backlog_records ?? 0) / (status?.backlog_capacity ?? 50000)) > 0.5
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(2, (((status?.backlog_records ?? 0) / (status?.backlog_capacity ?? 50000)) * 100)))}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>0 Records</span>
              <span>50,000 Capacity (~138 Hours @ 10s cadence)</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <span className="text-slate-400 block mb-1">Encoding Format</span>
              <strong className="text-white font-mono">MessagePack (Binary)</strong>
              <p className="text-slate-500 text-[11px] mt-1">
                4× more compact than JSON; fits over 50,000 full telemetry snapshots in 8MB PSRAM.
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
      )}

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
          {/* Home Assistant MQTT Card */}
          <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <Share2 className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-semibold text-white">Home Assistant MQTT Auto-Discovery</h3>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                MQTT JSON-RPC
              </span>
            </div>

            <p className="text-xs text-slate-400">
              UPSED publishes MQTT Home Assistant discovery payloads so your Voltronic UPS appears instantly as a native battery and sensor device in Home Assistant without custom YAML.
            </p>

            <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] font-mono text-xs space-y-2 text-slate-300">
              <div className="text-slate-500 uppercase tracking-wider text-[10px]">Discovery Topic:</div>
              <div className="text-cyan-300 break-all">homeassistant/sensor/upsed_ups/state</div>
              <div className="text-slate-500 uppercase tracking-wider text-[10px] mt-2">Mapped Entities:</div>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-400">
                <div>• sensor.ups_grid_voltage</div>
                <div>• sensor.ups_output_voltage</div>
                <div>• sensor.ups_load_percent</div>
                <div>• sensor.ups_battery_voltage</div>
                <div>• binary_sensor.ups_on_battery</div>
                <div>• binary_sensor.ups_beeper</div>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Full MQTT broker connector available in upcoming v0.2.0 release.</span>
            </div>
          </div>

          {/* Tuya Cloud / Matter IoT Card */}
          <div className="rounded-2xl p-5 border border-white/[0.08] bg-[#1e232d]/80 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <Radio className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-semibold text-white">Tuya Smart & Matter IoT Bridge</h3>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Roadmap
              </span>
            </div>

            <p className="text-xs text-slate-400">
              Enables local Matter over Wi-Fi commissioning directly on the ESP32-S3, allowing Apple HomeKit, Google Home, and Tuya Smart Life apps to view UPS power metrics and receive grid fail alarms.
            </p>

            <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] text-xs space-y-2 text-slate-300">
              <div className="font-semibold text-white">Features in Active Development:</div>
              <ul className="list-disc list-inside space-y-1 text-slate-400 text-[11px]">
                <li>Apple Home / Google Home native Matter Power Source cluster</li>
                <li>Tuya IoT Developer Platform TuyaLink telemetry stream</li>
                <li>Grid outage push notifications to iOS and Android smartphones</li>
                <li>Hardware outlet group toggle from smart home dashboard</li>
              </ul>
            </div>

            <div className="pt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Built on the same JSON-RPC 2.0 and PSRAM ring-buffer architecture.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
