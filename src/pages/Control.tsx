import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Volume2,
  VolumeX,
  Clock,
  Power,
  XCircle,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  Check,
  Lock,
  Sliders,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { DiscoveredDevice, Q1Status, UnlockStage, VoltronicCommand } from '../lib/types';
import { api } from '../lib/tauri';
import { PrimaryButton } from '../components/PrimaryButton';
import { RefreshButton } from '../components/RefreshButton';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { PowerControlCard } from '../components/PowerControlCard';

interface ControlProps {
  portName: string | null;
  upsId?: string | null;
  safetyStage: UnlockStage;
  onRefreshStage: () => void;
  device?: DiscoveredDevice | null;
  deviceName?: string | null;
  status?: Q1Status | null;
}

interface HardwareFlagDef {
  key: string;
  name: string;
  category: 'audio' | 'startup' | 'modes' | 'safety';
  description: string;
}

const HARDWARE_FLAG_DEFS: HardwareFlagDef[] = [
  // Alarms & Audio
  {
    key: 'a',
    name: 'Audible Beeper Alarm',
    category: 'audio',
    description: 'Master acoustic beeper for alarms, transfers, and fault alerts.',
  },
  {
    key: 'b',
    name: 'Battery Mode Alarm',
    category: 'audio',
    description: 'Periodic warning chirp when operating from battery backup power.',
  },
  {
    key: 'p',
    name: 'Bypass / ECO Alarm',
    category: 'audio',
    description: 'Audible notification when the inverter switches to bypass or ECO mode.',
  },

  // Startup & Power Recovery
  {
    key: 'r',
    name: 'Auto-Restart on AC Recovery',
    category: 'startup',
    description: 'Automatically re-engages the inverter and output when AC mains returns.',
  },
  {
    key: 'z',
    name: 'Cold Start Capability',
    category: 'startup',
    description: 'Allows starting the UPS directly from battery without utility AC present.',
  },
  {
    key: 's',
    name: 'Startup Battery Self-Test',
    category: 'startup',
    description: 'Executes a brief 10-second self-diagnostic discharge test upon power-on.',
  },
  {
    key: 'o',
    name: 'Bypass When Switched Off',
    category: 'startup',
    description: 'Continues passing utility mains power to output outlets even when UPS switch is off.',
  },

  // Operational Modes
  {
    key: 'g',
    name: 'Generator Compatibility Mode',
    category: 'modes',
    description: 'Accepts broader voltage and frequency fluctuations typical of generator power.',
  },
  {
    key: 'h',
    name: 'High-Efficiency (ECO) Mode',
    category: 'modes',
    description: 'Activates ultra-high efficiency line-interactive bypass when utility power is clean.',
  },
  {
    key: 'c',
    name: 'Frequency Converter Mode',
    category: 'modes',
    description: 'Permits fixed frequency output synthesis (50 Hz <-> 60 Hz conversion).',
  },
  {
    key: 'v',
    name: 'Inverter Output Voltage Regulation',
    category: 'modes',
    description: 'Dynamic output voltage stabilization and inverter synthesis regulation.',
  },

  // Safety & Protection
  {
    key: 'e',
    name: 'Emergency Power Off (EPO)',
    category: 'safety',
    description: 'Hardware remote emergency cutoff loop logic active.',
  },
  {
    key: 'f',
    name: 'Fault Auto-Acknowledge',
    category: 'safety',
    description: 'Automatically clears transient fault latches once operating condition normalizes.',
  },
  {
    key: 'm',
    name: 'Multi-Module Parallel Mode',
    category: 'safety',
    description: 'Synchronizes frequency and phase angle for multi-unit parallel redundant operation.',
  },
];

const FLAG_CATEGORIES = [
  { id: 'audio', label: 'Audio & Alarms', icon: Volume2 },
  { id: 'startup', label: 'Startup & Power Recovery', icon: Power },
  { id: 'modes', label: 'Operational Modes', icon: Sliders },
  { id: 'safety', label: 'Safety & Protection', icon: ShieldAlert },
] as const;

export const Control: React.FC<ControlProps> = ({
  portName,
  upsId,
  safetyStage,
  onRefreshStage,
  device,
  deviceName,
  status,
}) => {
  const { t } = useTranslation(['control', 'common']);
  const auth = useAuth();
  const isAuthenticated = Boolean(auth.status?.authenticated);
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [timedDurationMinutes, setTimedDurationMinutes] = useState<number>(5);
  const [alarmEnabled, setAlarmEnabled] = useState<boolean | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null);
  const [isRefreshingFlags, setIsRefreshingFlags] = useState(false);

  const handleSendCommand = async (cmd: VoltronicCommand, label: string) => {
    if (!portName) {
      setCommandFeedback(t('control:safetyGate.noDeviceError', 'Error: No active UPS device selected or device is offline'));
      return;
    }

    setIsExecuting(true);
    setCommandFeedback(null);

    try {
      const resp = await api.sendCommand(portName, cmd, upsId || undefined);
      const successMsg = t('control:safetyGate.feedbackSuccess', { label, resp, defaultValue: `Success: ${label} returned '${resp}'` });
      setCommandFeedback(successMsg);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const fullError = t('control:safetyGate.feedbackError', { error: errMsg, defaultValue: `Blocked or Failed: ${errMsg}` });
      setCommandFeedback(fullError);
    } finally {
      setIsExecuting(false);
    }
  };

  // Query capability flags via QFLAG:
  // e.g. "(EpbrsghczDoavefm": letters after 'E' are enabled, letters after 'D' are disabled.
  const refreshFlags = useCallback(async () => {
    if (!portName) {
      setFlags(null);
      setAlarmEnabled(null);
      return;
    }
    setIsRefreshingFlags(true);
    try {
      const resp = await api.sendCommand(portName, { type: 'QueryFlags' }, upsId || undefined);
      const body = resp.trim().replace(/^\(/, '');
      if (!body.startsWith('E')) {
        setFlags(null);
        setAlarmEnabled(null);
        return;
      }
      const rest = body.slice(1);
      const dIndex = rest.indexOf('D');
      const enStr = (dIndex === -1 ? rest : rest.slice(0, dIndex)).toLowerCase();
      const disStr = (dIndex === -1 ? '' : rest.slice(dIndex + 1)).toLowerCase();

      const newMap: Record<string, boolean> = {};
      for (const ch of enStr) {
        newMap[ch] = true;
      }
      for (const ch of disStr) {
        newMap[ch] = false;
      }

      setFlags(newMap);
      setAlarmEnabled(newMap['a'] ?? null);
    } catch {
      // Keep existing flags if offline or blocked
    } finally {
      setIsRefreshingFlags(false);
    }
  }, [portName, upsId]);

  useEffect(() => {
    void refreshFlags();
  }, [refreshFlags]);

  const setAlarm = async (enable: boolean) => {
    await handleSendCommand(
      { type: 'SetAlarmEnabled', payload: enable },
      enable ? 'Enable Alarm' : 'Disable Alarm'
    );
    await refreshFlags();
  };

  return (
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)] custom-scrollbar min-w-0">
      {/* Access Control & Safety Barrier Card */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div
              className={`p-2.5 rounded-xl border shrink-0 ${
                isAuthenticated
                  ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                  : !auth.status?.configured
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-slate-500/10 border-slate-500/30 text-slate-400'
              }`}
            >
              {isAuthenticated ? (
                <ShieldCheck className="w-5 h-5 text-indigo-400" />
              ) : !auth.status?.configured ? (
                <ShieldAlert className="w-5 h-5 text-amber-400" />
              ) : (
                <Lock className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="text-sm font-semibold text-slate-100">
                  {isAuthenticated
                    ? t('control:auth.barrierUnlockedTitle', 'Hardware Safety Barrier — Unlocked')
                    : !auth.status?.configured
                    ? t('control:auth.barrierSetupTitle', 'Hardware Safety Barrier — Setup Required')
                    : t('control:auth.barrierLockedTitle', 'Hardware Safety Barrier — Protected')}
                </h3>
                <span
                  className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                    isAuthenticated
                      ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/50'
                      : !auth.status?.configured
                      ? 'bg-amber-950/80 text-amber-300 border-amber-700/50'
                      : 'bg-slate-900/80 text-slate-400 border-white/[0.1]'
                  }`}
                >
                  {isAuthenticated
                    ? `Authenticated (${auth.status?.username})`
                    : !auth.status?.configured
                    ? 'Setup Required'
                    : 'Protected · Read-Only'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-xl leading-relaxed">
                {isAuthenticated
                  ? t(
                      'control:auth.authenticatedDesc',
                      `Session active for ${auth.status?.username}. Diagnostic self-tests, persistent parameter modifications, and live power cuts are unlocked.`
                    )
                  : !auth.status?.configured
                  ? t(
                      'control:auth.setupRequiredDesc',
                      'No administrator credentials configured. Set up credentials to unlock control commands.'
                    )
                  : t(
                      'control:auth.protectedDesc',
                      'Stage T1 telemetry queries remain available to all users. Diagnostic self-tests, persistent parameter modifications, and live power cuts require authenticated credentials.'
                    )}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {isAuthenticated ? (
              <PrimaryButton
                variant="secondary"
                onClick={() => auth.logout()}
                icon={<Lock className="w-3.5 h-3.5" />}
              >
                <span>{t('control:auth.logOut', 'Log Out')}</span>
              </PrimaryButton>
            ) : !auth.status?.configured ? (
              <PrimaryButton
                onClick={() => auth.openLoginModal()}
                icon={<KeyRound className="w-3.5 h-3.5" />}
              >
                <span>{t('control:auth.setupCredentials', 'Set Up Credentials')}</span>
              </PrimaryButton>
            ) : (
              <PrimaryButton
                onClick={() => auth.openLoginModal()}
                icon={<Unlock className="w-3.5 h-3.5" />}
              >
                <span>{t('control:auth.logIn', 'Log In & Unlock')}</span>
              </PrimaryButton>
            )}
          </div>
        </div>

        {commandFeedback && (
          <div
            className={`mt-4 p-3 rounded-xl border text-xs font-mono flex items-center space-x-2 ${
              commandFeedback.startsWith('Success')
                ? 'bg-emerald-950/30 border-emerald-700/40 text-emerald-300'
                : 'bg-rose-950/30 border-rose-700/40 text-rose-300'
            }`}
          >
            {commandFeedback.startsWith('Success') ? (
              <Check className="w-4 h-4 flex-shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            )}
            <span>{commandFeedback}</span>
          </div>
        )}
      </div>

      {/*  Stage T2: Non-Destructive Diagnostics Card  */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-semibold text-slate-100">
                {t('control:stageT2.title', 'Stage T2: Non-Destructive Actions')}
              </h4>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {t('control:stageT2.risk', 'Low Risk')}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('control:stageT2.desc', 'Diagnostic actions that do not alter flash/EEPROM or drop live load power.')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Audible Alarm (persistent setting, T3) */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2 text-slate-200">
                  {alarmEnabled === false ? (
                    <VolumeX className="w-4 h-4 text-slate-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                  )}
                  <span className="text-xs font-semibold">{t('control:stageT2.buzzerTitle', 'Audible Alarm')}</span>
                </div>
                {alarmEnabled !== null && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    alarmEnabled
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  }`}>
                    {alarmEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t('control:stageT2.buzzerDesc', 'Saves the UPS audible-alarm setting (PEA / PDA). This is a persistent setting and requires Stage T3.')}
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <PrimaryButton
                onClick={() => auth.requireAuth(() => setAlarm(alarmEnabled === false))}
                disabled={isExecuting}
                fullWidth
              >
                <span>
                  {alarmEnabled === false
                    ? 'Enable Alarm (PEA)'
                    : 'Disable Alarm (PDA)'}
                </span>
              </PrimaryButton>
              {!isAuthenticated && (
                <p className="text-[10px] text-indigo-400/80 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  <span>{t('control:auth.needsAuthNotice', 'Requires authentication to modify.')}</span>
                </p>
              )}
            </div>
          </div>

          {/* Battery Self-Test */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold">{t('control:stageT2.test10sTitle', 'Battery Self-Test')}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t('control:stageT2.test10sDesc', 'Discharges battery under load to verify battery health and inverter transfer.')}
              </p>
            </div>

            <div className="mt-3 space-y-2.5">
              <PrimaryButton
                onClick={() =>
                  auth.requireAuth(() =>
                    handleSendCommand({ type: 'TenSecondTest' }, 'Start 10s Test')
                  )
                }
                disabled={isExecuting}
                fullWidth
              >
                <span>{t('control:stageT2.test10sBtn', 'Quick 10s Test (T)')}</span>
              </PrimaryButton>

              <div className="pt-2 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                  <span>{t('control:stageT2.timedDurationLabel', 'Timed Test Duration:')}</span>
                  <span className="font-mono text-emerald-400 font-medium">{timedDurationMinutes} min</span>
                </div>
                <div className="flex items-center space-x-1.5 mb-2">
                  {[1, 5, 10, 15].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTimedDurationMinutes(preset)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition cursor-pointer ${
                        timedDurationMinutes === preset
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-semibold'
                          : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {preset}m
                    </button>
                  ))}
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={timedDurationMinutes}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        setTimedDurationMinutes(Math.max(1, Math.min(99, val)));
                      }
                    }}
                    className="w-12 text-center text-xs py-0.5 px-1 rounded bg-white/[0.05] border border-white/[0.1] text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    auth.requireAuth(() =>
                      handleSendCommand(
                        { type: 'TestForMinutes', payload: timedDurationMinutes },
                        `Start ${timedDurationMinutes}m Test`
                      )
                    )
                  }
                  disabled={isExecuting}
                  className="w-full py-1.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-emerald-300 border border-emerald-500/30 text-xs font-medium transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  {t(
                    'control:stageT2.startTimedBtn',
                    `Start Timed Test (T${timedDurationMinutes.toString().padStart(2, '0')})`
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Cancel Running Test */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <XCircle className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-semibold">{t('control:stageT2.cancelTestTitle', 'Cancel Self-Test')}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t('control:stageT2.cancelTestDesc', 'Immediately terminates any ongoing battery discharge test and restores line mode.')}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                auth.requireAuth(() =>
                  handleSendCommand({ type: 'CancelTest' }, 'Cancel Test')
                )
              }
              disabled={isExecuting}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-white/[0.08] hover:border-rose-500/40 text-xs font-medium transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              {t('control:stageT2.cancelTestBtn', 'Cancel Test (CT)')}
            </button>
          </div>
        </div>
      </div>

      {/*  Device Features & Capabilities (Read-Only)  */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-semibold text-slate-100 flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>{t('control:flags.title', 'Device Features & Capabilities')}</span>
              </h4>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 flex items-center space-x-1">
                <Lock className="w-2.5 h-2.5" />
                <span>Read-Only</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {t(
                'control:flags.desc',
                'Hardware capabilities supported by your connected UPS.'
              )}
            </p>
          </div>

          <RefreshButton
            onClick={() => void refreshFlags()}
            disabled={!portName}
            isLoading={isRefreshingFlags}
            title="Refresh features from UPS"
          />
        </div>

        {/* Categorized Feature Groups */}
        <div className="space-y-5">
          {FLAG_CATEGORIES.map((cat) => {
            const catFlags = HARDWARE_FLAG_DEFS.filter((f) => f.category === cat.id);
            const CatIcon = cat.icon;
            return (
              <div key={cat.id} className="space-y-2.5">
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
                  <CatIcon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{cat.label}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {catFlags.map((flagDef) => {
                    const isEnabled = flags ? flags[flagDef.key] === true : false;

                    return (
                      <div
                        key={flagDef.key}
                        className="p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02] flex items-center justify-between gap-3 transition hover:bg-white/[0.03]"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-semibold text-slate-200 block truncate">
                            {flagDef.name}
                          </span>
                          <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">
                            {flagDef.description}
                          </p>
                        </div>

                        <div className="flex items-center space-x-2.5 shrink-0">
                          <span title="Read-only" className="text-slate-400">
                            <Lock className="w-3 h-3" />
                          </span>
                          <ToggleSwitch
                            checked={isEnabled}
                            readOnly
                            disabled
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stage T4: Live Power Control Card */}
      <PowerControlCard
        portName={portName}
        upsId={upsId || null}
        deviceName={deviceName}
        device={device}
        safetyStage={safetyStage}
        status={status}
        isExecuting={isExecuting}
        onSendCommand={handleSendCommand}
        onRefreshStage={onRefreshStage}
      />
    </div>
  );
};

export default Control;
