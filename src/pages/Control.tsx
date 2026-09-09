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
    <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
      {/* Safety Gate Warning & Control Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Firmware Safety Gate:{' '}
                <span className="text-cyan-400 font-mono">{safetyStage}</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-xl leading-relaxed">
                To prevent firmware corruption or accidental power disruption, commands are strictly
                categorized by risk. Each stage unlocks only after automated test verification.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {safetyStage === 'T1ReadOnly' && (
              <button
                onClick={() => handleUnlockStage('T2NonDestructive')}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-blue-900/30"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Unlock Stage T2</span>
              </button>
            )}
            {safetyStage === 'T2NonDestructive' && (
              <button
                onClick={() => handleUnlockStage('T3ConfigWrite')}
                className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-amber-900/30"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Unlock Stage T3</span>
              </button>
            )}
            {safetyStage === 'T3ConfigWrite' && (
              <button
                onClick={() => handleUnlockStage('T4PowerControl')}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-rose-900/30"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Unlock Stage T4</span>
              </button>
            )}
          </div>
        </div>

        {commandFeedback && (
          <div
            className={`mt-4 p-3 rounded-xl border text-xs font-mono flex items-center space-x-2 ${
              commandFeedback.startsWith('Success')
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
                : 'bg-rose-950/60 border-rose-800/80 text-rose-300'
            }`}
          >
            {commandFeedback.startsWith('Success') ? (
              <Check className="w-4 h-4 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{commandFeedback}</span>
          </div>
        )}
      </div>

      {/* Stage T2: Non-Destructive Controls */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="mb-4">
          <div className="flex items-center space-x-2">
            <h4 className="text-base font-semibold text-slate-100">
              Stage T2: Non-Destructive Actions
            </h4>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800/50">
              Low Risk
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Diagnostic actions that do not modify persistent settings or cut load power.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Buzzer Toggle */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Volume2 className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold">Alarm Buzzer</span>
              </div>
              <p className="text-xs text-slate-500">
                Toggles the internal alarm beeper on or off.
              </p>
            </div>
            <button
              onClick={() => handleSendCommand({ type: 'BuzzerToggle' }, 'Toggle Buzzer')}
              disabled={isExecuting || safetyStage === 'T1ReadOnly'}
              className="mt-4 w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-200 transition"
            >
              Toggle Buzzer (BUZZER)
            </button>
          </div>

          {/* 10-Second Battery Test */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Clock className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold">10s Battery Test</span>
              </div>
              <p className="text-xs text-slate-500">
                Briefly discharges battery for 10 seconds to verify health.
              </p>
            </div>
            <button
              onClick={() => handleSendCommand({ type: 'TenSecondTest' }, 'Start 10s Test')}
              disabled={isExecuting || safetyStage === 'T1ReadOnly'}
              className="mt-4 w-full py-2 px-3 rounded-lg bg-blue-600/80 hover:bg-blue-600 disabled:opacity-40 text-xs font-semibold text-white transition"
            >
              Start 10s Test (T)
            </button>
          </div>

          {/* Cancel Running Test */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <XCircle className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-semibold">Cancel Self-Test</span>
              </div>
              <p className="text-xs text-slate-500">
                Immediately cancels any active battery discharge test.
              </p>
            </div>
            <button
              onClick={() => handleSendCommand({ type: 'CancelTest' }, 'Cancel Test')}
              disabled={isExecuting || safetyStage === 'T1ReadOnly'}
              className="mt-4 w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-300 transition"
            >
              Cancel Test (CT)
            </button>
          </div>
        </div>
      </div>

      {/* Stage T4: High Risk Power Control */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="mb-4">
          <div className="flex items-center space-x-2">
            <h4 className="text-base font-semibold text-slate-100">
              Stage T4: Live Power Control
            </h4>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800/50">
              High Risk
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Commands that can cut load output or trigger UPS shutdown.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Shutdown with Delay */}
          <div className="p-4 rounded-xl border border-rose-900/40 bg-rose-950/20 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-rose-300 mb-1">
                <AlertOctagon className="w-4 h-4" />
                <span className="text-sm font-semibold">Emergency Shutdown</span>
              </div>
              <p className="text-xs text-slate-400">
                Shuts down UPS output after 0.3m (~18 seconds) delay.
              </p>
            </div>

            {confirmShutdown ? (
              <div className="mt-4 space-y-2">
                <p className="text-[11px] text-rose-400 font-semibold text-center">
                  Are you sure? Connected equipment will lose power!
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      setConfirmShutdown(false);
                      handleSendCommand(
                        { type: 'ShutdownWithDelay', payload: { minutes: 0.3 } },
                        'Shutdown UPS Output'
                      );
                    }}
                    className="flex-1 py-1.5 px-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition"
                  >
                    Confirm Shutdown
                  </button>
                  <button
                    onClick={() => setConfirmShutdown(false)}
                    className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmShutdown(true)}
                disabled={isExecuting || safetyStage !== 'T4PowerControl'}
                className="mt-4 w-full py-2 px-3 rounded-lg bg-rose-700/80 hover:bg-rose-600 disabled:opacity-30 text-xs font-bold text-white transition"
              >
                Initiate Shutdown (S.3)
              </button>
            )}
          </div>

          {/* Cancel Shutdown */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Power className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold">Cancel Pending Shutdown</span>
              </div>
              <p className="text-xs text-slate-500">
                Cancels any active shutdown countdown timer immediately.
              </p>
            </div>
            <button
              onClick={() => handleSendCommand({ type: 'CancelShutdown' }, 'Cancel Shutdown')}
              disabled={isExecuting || safetyStage !== 'T4PowerControl'}
              className="mt-4 w-full py-2 px-3 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 disabled:opacity-30 text-xs font-bold text-white transition"
            >
              Cancel Shutdown (CS)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
