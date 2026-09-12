import React, { useState } from 'react';
import {
  Volume2,
  Clock,
  Power,
  XCircle,
  ShieldAlert,
  Unlock,
  AlertOctagon,
  Check,
} from 'lucide-react';
import { UnlockStage, VoltronicCommand } from '../lib/types';
import { api } from '../lib/tauri';

interface ControlProps {
  portName: string | null;
  safetyStage: UnlockStage;
  onRefreshStage: () => void;
}

const getStagePillStyle = (stage: UnlockStage) => {
  switch (stage) {
    case 'T1ReadOnly':       return 'bg-emerald-950/80 text-emerald-400 border-emerald-700/40';
    case 'T2NonDestructive': return 'bg-blue-950/80    text-blue-400    border-blue-700/40';
    case 'T3ConfigWrite':    return 'bg-amber-950/80   text-amber-400   border-amber-700/40';
    case 'T4PowerControl':   return 'bg-rose-950/80    text-rose-400    border-rose-700/40';
  }
};

export const Control: React.FC<ControlProps> = ({
  portName,
  safetyStage,
  onRefreshStage,
}) => {
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [confirmShutdown, setConfirmShutdown] = useState(false);

  const handleSendCommand = async (cmd: VoltronicCommand, label: string) => {
    if (!portName) {
      setCommandFeedback('Error: No active UPS device selected');
      return;
    }

    setIsExecuting(true);
    setCommandFeedback(null);

    try {
      const resp = await api.sendCommand(portName, cmd);
      setCommandFeedback(`Success: ${label} returned '${resp}'`);
    } catch (err: any) {
      setCommandFeedback(`Blocked or Failed: ${err?.message || String(err)}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleUnlockStage = async (target: UnlockStage) => {
    try {
      await api.unlockSafetyStage(target);
      onRefreshStage();
      setCommandFeedback(`Safety stage updated to ${target}`);
    } catch (err: any) {
      setCommandFeedback(`Stage advance failed: ${err?.message || String(err)}`);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)]">
      {/* ── Safety Gate Status Card ─────────────────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="text-sm font-semibold text-slate-100">
                  Firmware Safety Gate
                </h3>
                <span
                  className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${getStagePillStyle(
                    safetyStage
                  )}`}
                >
                  {safetyStage}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-xl leading-relaxed">
                To prevent firmware corruption or accidental load drop, commands are strictly
                categorized by risk. Each stage unlocks sequentially.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {safetyStage === 'T1ReadOnly' && (
              <button
                type="button"
                onClick={() => handleUnlockStage('T2NonDestructive')}
                className="px-3.5 py-2 rounded-xl bg-[#22c55e] hover:bg-green-600 active:bg-green-700 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-md shadow-green-950/30 cursor-pointer"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Unlock Stage T2</span>
              </button>
            )}
            {safetyStage === 'T2NonDestructive' && (
              <button
                type="button"
                onClick={() => handleUnlockStage('T3ConfigWrite')}
                className="px-3.5 py-2 rounded-xl bg-[#22c55e] hover:bg-green-600 active:bg-green-700 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-md shadow-green-950/30 cursor-pointer"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Unlock Stage T3</span>
              </button>
            )}
            {safetyStage === 'T3ConfigWrite' && (
              <button
                type="button"
                onClick={() => handleUnlockStage('T4PowerControl')}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-md shadow-rose-950/30 cursor-pointer"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Unlock Stage T4</span>
              </button>
            )}
            {safetyStage === 'T4PowerControl' && (
              <button
                type="button"
                onClick={() => handleUnlockStage('T1ReadOnly')}
                className="px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Relock to T1</span>
              </button>
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

      {/* ── Stage T2: Non-Destructive Diagnostics Card ───────── */}
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
                Stage T2: Non-Destructive Actions
              </h4>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Low Risk
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Diagnostic actions that do not alter flash/EEPROM or drop live load power.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Buzzer Toggle */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Volume2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold">Alarm Buzzer</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Toggles the internal hardware alarm beeper on or off.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSendCommand({ type: 'BuzzerToggle' }, 'Toggle Buzzer')}
              disabled={isExecuting || safetyStage === 'T1ReadOnly'}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border border-white/[0.08] text-xs font-medium transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              Toggle Buzzer (BUZZER)
            </button>
          </div>

          {/* 10-Second Battery Test */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold">10s Battery Test</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Discharges battery for 10 seconds under load to verify battery health.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSendCommand({ type: 'TenSecondTest' }, 'Start 10s Test')}
              disabled={isExecuting || safetyStage === 'T1ReadOnly'}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-[#22c55e] hover:bg-green-600 active:bg-green-700 text-white text-xs font-semibold transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-green-950/30"
            >
              Start 10s Test (T)
            </button>
          </div>

          {/* Cancel Running Test */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <XCircle className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-semibold">Cancel Self-Test</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Immediately terminates any ongoing battery discharge test.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSendCommand({ type: 'CancelTest' }, 'Cancel Test')}
              disabled={isExecuting || safetyStage === 'T1ReadOnly'}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 border border-white/[0.08] text-xs font-medium transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              Cancel Test (CT)
            </button>
          </div>
        </div>
      </div>

      {/* ── Stage T4: Live Power Control Card ────────────────── */}
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
                Stage T4: Live Power Control
              </h4>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                High Risk
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Commands that can cut load output or trigger hardware shutdown.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Shutdown with Delay */}
          <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.03] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-rose-300 mb-1">
                <AlertOctagon className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-semibold">Emergency Shutdown</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Shuts down UPS output after a 0.3m (~18 seconds) delay.
              </p>
            </div>

            {confirmShutdown ? (
              <div className="mt-4 space-y-2">
                <p className="text-[11px] text-rose-400 font-semibold text-center">
                  Are you sure? Connected equipment will lose power!
                </p>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmShutdown(false);
                      handleSendCommand(
                        { type: 'ShutdownWithDelay', payload: { minutes: 0.3 } },
                        'Shutdown UPS Output'
                      );
                    }}
                    className="flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl transition cursor-pointer"
                  >
                    Confirm Shutdown
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmShutdown(false)}
                    className="py-2 px-3 bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 border border-white/[0.08] text-xs rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmShutdown(true)}
                disabled={isExecuting || safetyStage !== 'T4PowerControl'}
                className="mt-4 w-full py-2 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold transition cursor-pointer"
              >
                Initiate Shutdown (S.3)
              </button>
            )}
          </div>

          {/* Cancel Shutdown */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Power className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold">Cancel Pending Shutdown</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Cancels any active shutdown countdown timer immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSendCommand({ type: 'CancelShutdown' }, 'Cancel Shutdown')}
              disabled={isExecuting || safetyStage !== 'T4PowerControl'}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-emerald-400 border border-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold transition cursor-pointer"
            >
              Cancel Shutdown (CS)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Control;
