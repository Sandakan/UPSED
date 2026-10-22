import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertOctagon,
  Power,
  RotateCcw,
  Zap,
  ZapOff,
  Sliders,
  RefreshCw,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  DiscoveredDevice,
  OutletState,
  Q1Status,
  UnlockStage,
  VoltronicCommand,
  isPSeries,
} from '../lib/types';
import { api } from '../lib/tauri';
import { TypedConfirmModal } from './TypedConfirmModal';

export interface PowerControlCardProps {
  portName: string | null;
  upsId: string | null;
  deviceName?: string | null;
  device?: DiscoveredDevice | null;
  safetyStage: UnlockStage;
  status?: Q1Status | null;
  isExecuting: boolean;
  onSendCommand: (cmd: VoltronicCommand, label: string) => Promise<void>;
  onRefreshStage?: () => void;
}

const PRESET_DELAYS = [
  { value: 0.3, label: '0.3m (~18s)' },
  { value: 1.0, label: '1 min' },
  { value: 2.0, label: '2 min' },
  { value: 5.0, label: '5 min' },
  { value: 10.0, label: '10 min' },
];

export const PowerControlCard: React.FC<PowerControlCardProps> = ({
  portName,
  upsId,
  deviceName,
  device,
  safetyStage: _safetyStage,
  status,
  isExecuting,
  onSendCommand,
}) => {
  const { t } = useTranslation(['control', 'common']);
  const auth = useAuth();
  const isAuthenticated = Boolean(auth.status?.authenticated);
  const confirmationTarget = deviceName?.trim() || 'SHUTDOWN';

  // Sub-card state
  const [selectedDelay, setSelectedDelay] = useState<number>(0.3);
  const [customDelayInput, setCustomDelayInput] = useState<string>('0.3');
  const [isCustomDelay, setIsCustomDelay] = useState<boolean>(false);

  // Auto-restore inputs
  const [restoreDelay, setRestoreDelay] = useState<number>(2);

  // Outlet states
  const [outletStates, setOutletStates] = useState<OutletState[]>([]);
  const [isLoadingOutlets, setIsLoadingOutlets] = useState<boolean>(false);

  // Countdown state
  const [countdownEnd, setCountdownEnd] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // Typed confirmation modal state
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    cmd: VoltronicCommand;
    label: string;
    title: string;
    description: React.ReactNode;
    confirmLabel?: string;
    variant?: 'danger' | 'warning';
  } | null>(null);

  // Capability checks
  const supportsPSeries = useMemo(() => {
    return isPSeries(device?.protocol_id);
  }, [device?.protocol_id]);

  const supportsOutlets = useMemo(() => {
    return Boolean(device?.capabilities?.supports_outlets || outletStates.length > 0);
  }, [device?.capabilities?.supports_outlets, outletStates.length]);

  // Query outlet states
  const refreshOutlets = useCallback(async () => {
    if (!portName) return;
    setIsLoadingOutlets(true);
    try {
      const states = await api.getOutletStates(upsId || undefined, portName);
      if (states && states.length > 0) {
        setOutletStates(states);
      }
    } catch {
      // Outlets not supported or offline
    } finally {
      setIsLoadingOutlets(false);
    }
  }, [portName, upsId]);

  useEffect(() => {
    refreshOutlets();
  }, [refreshOutlets]);

  // Sync hardware shutdown_active bit from telemetry
  useEffect(() => {
    if (status?.shutdown_active) {
      if (!countdownEnd) {
        // Telemetry shows shutdown active, initialize timer if not present
        const estSeconds = selectedDelay >= 1.0 ? selectedDelay * 60 : selectedDelay * 60;
        setCountdownEnd(Date.now() + estSeconds * 1000);
      }
    } else if (status?.shutdown_active === false && countdownEnd !== null) {
      // Telemetry confirmed shutdown is no longer active
      setCountdownEnd(null);
      setRemainingSeconds(null);
    }
  }, [status?.shutdown_active, countdownEnd, selectedDelay]);

  // Countdown ticker
  useEffect(() => {
    if (!countdownEnd) {
      setRemainingSeconds(null);
      return;
    }

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.round((countdownEnd - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [countdownEnd]);

  // Action execution after typed confirmation
  const handleConfirmAction = async () => {
    if (!modalConfig) return;
    const { cmd, label } = modalConfig;
    setModalConfig(null);

    // If starting a delayed shutdown, prime countdown
    if (cmd.type === 'ShutdownWithDelay') {
      const delayMs = (cmd.payload.minutes || 0.3) * 60 * 1000;
      setCountdownEnd(Date.now() + delayMs);
    } else if (cmd.type === 'ShutdownAndRestore') {
      const delayMs = (cmd.payload.minutes || 0.3) * 60 * 1000;
      setCountdownEnd(Date.now() + delayMs);
    } else if (cmd.type === 'CancelShutdown') {
      setCountdownEnd(null);
      setRemainingSeconds(null);
    }

    await onSendCommand(cmd, label);

    // Refresh outlet states if an outlet command was dispatched
    if (cmd.type === 'OutletOn' || cmd.type === 'OutletOff') {
      setTimeout(() => refreshOutlets(), 1000);
    }
  };

  const handleCancelCountdown = async () => {
    setCountdownEnd(null);
    setRemainingSeconds(null);
    await onSendCommand({ type: 'CancelShutdown' }, 'Cancel Pending Shutdown');
  };

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getEffectiveDelay = (): number => {
    if (isCustomDelay) {
      const val = parseFloat(customDelayInput);
      if (isNaN(val) || val < 0.1) return 0.1;
      if (val > 99) return 99;
      return val < 1.0 ? Math.round(val * 10) / 10 : Math.round(val);
    }
    return selectedDelay;
  };

  return (
    <div
      className="rounded-2xl p-5 shadow-sm border transition"
      style={{
        backgroundColor: 'var(--card-bg)',
        borderColor: 'var(--card-border)',
      }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center space-x-2">
            <h4 className="text-sm font-semibold text-slate-100">
              {t('control:stageT4.title', 'Stage T4: Live Power Control')}
            </h4>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
              {t('control:stageT4.risk', 'High Risk')}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {t(
              'control:stageT4.desc',
              'Commands that can cut load output or trigger hardware shutdown. Commands require typed confirmation.'
            )}
          </p>
        </div>

        {!isAuthenticated ? (
          <button
            type="button"
            onClick={() => auth.openLoginModal()}
            className="text-[11px] font-mono text-slate-300 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] px-2.5 py-1 rounded-xl flex items-center gap-1.5 self-start sm:self-auto cursor-pointer transition"
          >
            <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>{t('control:power.protectedNeedsLogin', 'Protected · Click to Log In')}</span>
          </button>
        ) : (
          <div className="text-[11px] font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-xl flex items-center gap-1.5 self-start sm:self-auto">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{t('control:power.authUnlocked', 'Unlocked · Typed confirmation required')}</span>
          </div>
        )}
      </div>

      {/* Active Shutdown Countdown Banner */}
      {(remainingSeconds !== null || status?.shutdown_active) && (
        <div className="mb-4 p-4 rounded-xl border border-rose-500/40 bg-rose-950/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <AlertOctagon className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-rose-200 uppercase tracking-wider">
                  {t('control:power.shutdownActiveTitle', 'Shutdown Sequence In Progress')}
                </span>
                {status?.shutdown_active && (
                  <span className="text-[10px] font-mono bg-rose-500/30 text-rose-200 px-1.5 py-0.5 rounded">
                    Hardware Bit Confirmed
                  </span>
                )}
              </div>
              <p className="text-[11px] text-rose-300">
                {t(
                  'control:power.shutdownActiveDesc',
                  'UPS output will be cut in: '
                )}
                <span className="font-mono font-bold text-white text-sm ml-1">
                  {remainingSeconds !== null ? formatCountdown(remainingSeconds) : 'Active'}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelCountdown}
            disabled={isExecuting}
            className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-lg shadow-emerald-950/40 border border-emerald-400/40 transition cursor-pointer flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('control:power.abortShutdown', 'Abort Shutdown (CS)')}</span>
          </button>
        </div>
      )}

      {/* Main Grid of Power Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Delayed Shutdown */}
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.03] flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 text-rose-300 mb-1">
              <AlertOctagon className="w-4 h-4 text-rose-400" />
              <span className="text-xs font-semibold">
                {t('control:power.delayedShutdownTitle', 'Delayed Output Shutdown (S)')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t(
                'control:power.delayedShutdownDesc',
                'Signals the UPS to cut inverter output after a specified delay.'
              )}
            </p>

            {/* Delay Selection */}
            <div className="mt-3 space-y-2">
              <label className="text-[10px] uppercase font-mono text-slate-400 block">
                {t('control:power.shutdownDelayLabel', 'Shutdown Delay')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_DELAYS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setSelectedDelay(preset.value);
                      setIsCustomDelay(false);
                    }}
                    className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition cursor-pointer ${
                      !isCustomDelay && selectedDelay === preset.value
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-semibold'
                        : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:bg-white/[0.07]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setIsCustomDelay(true)}
                  className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition cursor-pointer ${
                    isCustomDelay
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-semibold'
                      : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:bg-white/[0.07]'
                  }`}
                >
                  {t('control:power.custom', 'Custom...')}
                </button>
              </div>

              {isCustomDelay && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="number"
                    min="0.1"
                    max="99"
                    step="0.1"
                    value={customDelayInput}
                    onChange={(e) => setCustomDelayInput(e.target.value)}
                    className="w-24 px-2 py-1 text-xs rounded-lg border border-white/[0.1] bg-white/[0.04] text-slate-100 font-mono"
                  />
                  <span className="text-[11px] text-slate-400">
                    {t('control:power.minutesHint', 'minutes (0.1–0.9 or 1–99)')}
                  </span>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const effDelay = getEffectiveDelay();
              auth.requireAuth(() => {
                setModalConfig({
                  isOpen: true,
                  cmd: { type: 'ShutdownWithDelay', payload: { minutes: effDelay } },
                  label: `Delayed Shutdown (${effDelay} min)`,
                  title: t('control:power.confirmShutdownTitle', 'Confirm Output Shutdown'),
                  description: t(
                    'control:power.confirmShutdownDesc',
                    'The UPS will shut down AC output after {{delay}} minute(s). Connected equipment will lose power.',
                    { delay: effDelay }
                  ),
                  confirmLabel: t('control:power.confirmShutdownBtn', 'Execute Shutdown'),
                  variant: 'danger',
                });
              });
            }}
            disabled={isExecuting}
            className="mt-4 w-full py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold transition cursor-pointer"
          >
            {t('control:power.initiateShutdownBtn', 'Initiate Shutdown (S)')}
          </button>
        </div>

        {/* 2. Shutdown & Auto-Restore */}
        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.03] flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 text-amber-300 mb-1">
              <RotateCcw className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold">
                {t('control:power.shutdownRestoreTitle', 'Shutdown & Auto-Restore (S..R..)')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t(
                'control:power.shutdownRestoreDesc',
                'Shuts down output after delay, then automatically powers on once AC line returns and restore delay elapses.'
              )}
            </p>

            <div className="mt-2.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 leading-normal">
              {t(
                'control:power.restoreNote',
                'Notice: Auto-restart requires utility AC power to return. A fully off UPS without mains AC cannot be powered on remotely.'
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                  {t('control:power.shutdownDelay', 'Shutdown In')}
                </label>
                <div className="text-xs font-mono text-slate-200">
                  {getEffectiveDelay()} {t('control:power.min', 'min')}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
                  {t('control:power.restoreDelay', 'Restore After AC')}
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value={restoreDelay}
                    onChange={(e) => setRestoreDelay(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 px-2 py-0.5 text-xs rounded-lg border border-white/[0.1] bg-white/[0.04] text-slate-100 font-mono"
                  />
                  <span className="text-[11px] text-slate-400">{t('control:power.min', 'min')}</span>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const effDelay = getEffectiveDelay();
              auth.requireAuth(() => {
                setModalConfig({
                  isOpen: true,
                  cmd: {
                    type: 'ShutdownAndRestore',
                    payload: { minutes: effDelay, restore_minutes: restoreDelay },
                  },
                  label: `Shutdown (${effDelay}m) & Restore (${restoreDelay}m)`,
                  title: t('control:power.confirmRestoreTitle', 'Confirm Shutdown & Auto-Restart'),
                  description: t(
                    'control:power.confirmRestoreDesc',
                    'The UPS will shut down in {{delay}} minute(s). Output will automatically restore {{restore}} minute(s) after AC power is restored.',
                    { delay: effDelay, restore: restoreDelay }
                  ),
                  confirmLabel: t('control:power.confirmRestoreBtn', 'Execute Shutdown & Restore'),
                  variant: 'danger',
                });
              });
            }}
            disabled={isExecuting}
            className="mt-4 w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold transition cursor-pointer"
          >
            {t('control:power.initiateRestoreBtn', 'Shutdown with Auto-Restart')}
          </button>
        </div>

        {/* 3. Inverter Output Toggle (P-series SON / SOFF) */}
        {supportsPSeries && (
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Power className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-semibold">
                  {t('control:power.inverterOutputTitle', 'Inverter Output Toggle (SON / SOFF)')}
                </span>
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  P-Series
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t(
                  'control:power.inverterOutputDesc',
                  'Turns inverter output ON or OFF directly without powering off internal monitoring microcontrollers.'
                )}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  auth.requireAuth(() =>
                    onSendCommand({ type: 'OutputOn' }, 'Turn UPS Output ON (SON)')
                  )
                }
                disabled={isExecuting}
                className="py-2 px-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{t('control:power.outputOnBtn', 'Output ON (SON)')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  auth.requireAuth(() => {
                    setModalConfig({
                      isOpen: true,
                      cmd: { type: 'OutputOff' },
                      label: 'Turn UPS Output OFF (SOFF)',
                      title: t('control:power.confirmOutputOffTitle', 'Confirm Cut Output Power'),
                      description: t(
                        'control:power.confirmOutputOffDesc',
                        'This will immediately cut AC power to all connected equipment.'
                      ),
                      confirmLabel: t('control:power.confirmOutputOffBtn', 'Cut Output (SOFF)'),
                      variant: 'danger',
                    });
                  });
                }}
                disabled={isExecuting}
                className="py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <ZapOff className="w-3.5 h-3.5" />
                <span>{t('control:power.outputOffBtn', 'Output OFF (SOFF)')}</span>
              </button>
            </div>
          </div>
        )}

        {/* 4. Switchable Outlet Groups (SKON / SKOFF) */}
        {supportsOutlets && (
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2 text-slate-200">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-semibold">
                    {t('control:power.outletsTitle', 'Switchable Outlet Groups')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={refreshOutlets}
                  disabled={isLoadingOutlets}
                  className="text-slate-400 hover:text-slate-200 p-1 rounded transition"
                  title="Refresh Outlet States"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isLoadingOutlets ? 'animate-spin' : ''}`}
                  />
                </button>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t(
                  'control:power.outletsDesc',
                  'Independently switch outlet banks 1 and 2 (load shedding or peripheral power management).'
                )}
              </p>

              {/* Outlet Groups List */}
              <div className="mt-3 space-y-2">
                {[1, 2].map((grp) => {
                  const state = outletStates.find((o) => o.group === grp);
                  const isOn = state ? state.on : true;
                  return (
                    <div
                      key={grp}
                      className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isOn ? 'bg-emerald-400' : 'bg-rose-400'
                          }`}
                        />
                        <span className="text-xs text-slate-200 font-medium">
                          {t('control:power.outletGroup', 'Outlet Group {{group}}', {
                            group: grp,
                          })}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {isOn ? 'ON' : 'OFF'}
                        </span>
                      </div>

                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            auth.requireAuth(() => {
                              if (isOn) {
                                setModalConfig({
                                  isOpen: true,
                                  cmd: { type: 'OutletOff', payload: { group: grp } },
                                  label: `Turn Outlet Group ${grp} OFF`,
                                  title: t(
                                    'control:power.confirmOutletOffTitle',
                                    'Confirm Power Cut for Group {{group}}',
                                    { group: grp }
                                  ),
                                  description: t(
                                    'control:power.confirmOutletOffDesc',
                                    'Equipment plugged into Outlet Group {{group}} will lose power immediately.',
                                    { group: grp }
                                  ),
                                  confirmLabel: t(
                                    'control:power.confirmOutletOffBtn',
                                    'Turn OFF Group {{group}}',
                                    { group: grp }
                                  ),
                                  variant: 'warning',
                                });
                              } else {
                                onSendCommand(
                                  { type: 'OutletOn', payload: { group: grp } },
                                  `Turn Outlet Group ${grp} ON`
                                );
                                setTimeout(() => refreshOutlets(), 1000);
                              }
                            });
                          }}
                          disabled={isExecuting}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                            isOn
                              ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30'
                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          }`}
                        >
                          {isOn
                            ? t('control:power.turnOff', 'Turn OFF')
                            : t('control:power.turnOn', 'Turn ON')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 5. Cancel Pending Shutdown */}
        <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 text-slate-200 mb-1">
              <RotateCcw className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-semibold">
                {t('control:stageT4.cancelShutdownTitle', 'Cancel Pending Shutdown (CS)')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t(
                'control:stageT4.cancelShutdownDesc',
                'Cancels any active shutdown countdown timer immediately and preserves output.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => auth.requireAuth(() => handleCancelCountdown())}
            disabled={isExecuting}
            className="mt-4 w-full py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-emerald-400 border border-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('control:stageT4.cancelShutdownBtn', 'Cancel Shutdown (CS)')}</span>
          </button>
        </div>
      </div>

      {/* Typed Confirmation Modal */}
      {modalConfig && (
        <TypedConfirmModal
          isOpen={modalConfig.isOpen}
          onClose={() => setModalConfig(null)}
          onConfirm={handleConfirmAction}
          title={modalConfig.title}
          description={modalConfig.description}
          expectedConfirmationText={confirmationTarget}
          confirmLabel={modalConfig.confirmLabel}
          variant={modalConfig.variant || 'danger'}
          isLoading={isExecuting}
        />
      )}
    </div>
  );
};
