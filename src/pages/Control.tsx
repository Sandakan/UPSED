import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { PrimaryButton } from '../components/PrimaryButton';

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
  const { t } = useTranslation(['control', 'common']);
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [timedDurationMinutes, setTimedDurationMinutes] = useState<number>(5);

  const handleSendCommand = async (cmd: VoltronicCommand, label: string) => {
    if (!portName) {
      setCommandFeedback(t('control:safetyGate.noDeviceError', 'Error: No active UPS device selected'));
      return;
    }

    setIsExecuting(true);
    setCommandFeedback(null);

    try {
      const resp = await api.sendCommand(portName, cmd);
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

  const handleUnlockStage = async (target: UnlockStage) => {
    try {
      await api.unlockSafetyStage(target);
      onRefreshStage();
      setCommandFeedback(t('control:safetyGate.feedbackUpdated', { target, defaultValue: `Safety stage updated to ${target}` }));
    } catch (err: any) {
      setCommandFeedback(t('control:safetyGate.feedbackAdvanceError', { error: err?.message || String(err), defaultValue: `Stage advance failed: ${err?.message || String(err)}` }));
    }
  };

  return (
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)] custom-scrollbar min-w-0">
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
                  {t('control:safetyGate.title', 'Firmware Safety Gate')}
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
                {t('control:safetyGate.desc', 'To prevent firmware corruption or accidental load drop, commands are strictly categorized by risk. Each stage unlocks sequentially.')}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {safetyStage === 'T1ReadOnly' && (
              <PrimaryButton
                onClick={() => handleUnlockStage('T2NonDestructive')}
                icon={<Unlock className="w-3.5 h-3.5" />}
              >
                <span>{t('control:safetyGate.unlockT2', 'Unlock Stage T2')}</span>
              </PrimaryButton>
            )}
            {safetyStage === 'T2NonDestructive' && (
              <PrimaryButton
                onClick={() => handleUnlockStage('T3ConfigWrite')}
                icon={<Unlock className="w-3.5 h-3.5" />}
              >
                <span>{t('control:safetyGate.unlockT3', 'Unlock Stage T3')}</span>
              </PrimaryButton>
            )}
            {safetyStage === 'T3ConfigWrite' && (
              <PrimaryButton
                variant="danger"
                onClick={() => handleUnlockStage('T4PowerControl')}
                icon={<Unlock className="w-3.5 h-3.5" />}
              >
                <span>{t('control:safetyGate.unlockT4', 'Unlock Stage T4')}</span>
              </PrimaryButton>
            )}
            {safetyStage === 'T4PowerControl' && (
              <PrimaryButton
                variant="secondary"
                onClick={() => handleUnlockStage('T1ReadOnly')}
                icon={<Unlock className="w-3.5 h-3.5" />}
              >
                <span>{t('control:safetyGate.relockT1', 'Relock to T1')}</span>
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
          {/* Buzzer Toggle */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Volume2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold">{t('control:stageT2.buzzerTitle', 'Alarm Buzzer')}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t('control:stageT2.buzzerDesc', 'Toggles the internal hardware alarm beeper on or off.')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSendCommand({ type: 'BuzzerToggle' }, 'Toggle Buzzer')}
              disabled={isExecuting || safetyStage === 'T1ReadOnly'}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border border-white/[0.08] text-xs font-medium transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              {t('control:stageT2.buzzerBtn', 'Toggle Buzzer (BUZZER)')}
            </button>
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
                onClick={() => handleSendCommand({ type: 'TenSecondTest' }, 'Start 10s Test')}
                disabled={isExecuting || safetyStage === 'T1ReadOnly'}
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
                    handleSendCommand(
                      { type: 'TestForMinutes', payload: timedDurationMinutes },
                      `Start ${timedDurationMinutes}m Test`
                    )
                  }
                  disabled={isExecuting || safetyStage === 'T1ReadOnly'}
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
              onClick={() => handleSendCommand({ type: 'CancelTest' }, 'Cancel Test')}
              disabled={isExecuting || safetyStage === 'T1ReadOnly'}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-white/[0.08] hover:border-rose-500/40 text-xs font-medium transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              {t('control:stageT2.cancelTestBtn', 'Cancel Test (CT)')}
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
                {t('control:stageT4.title', 'Stage T4: Live Power Control')}
              </h4>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                {t('control:stageT4.risk', 'High Risk')}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('control:stageT4.desc', 'Commands that can cut load output or trigger hardware shutdown.')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Shutdown with Delay */}
          <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.03] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-rose-300 mb-1">
                <AlertOctagon className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-semibold">{t('control:stageT4.shutdownTitle', 'Emergency Shutdown')}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t('control:stageT4.shutdownDesc', 'Shuts down UPS output after a 0.3m (~18 seconds) delay.')}
              </p>
            </div>

            {confirmShutdown ? (
              <div className="mt-4 space-y-2">
                <p className="text-[11px] text-rose-400 font-semibold text-center">
                  {t('control:stageT4.shutdownWarn', 'Are you sure? Connected equipment will lose power!')}
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
                    {t('control:stageT4.confirmBtn', 'Confirm Shutdown')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmShutdown(false)}
                    className="py-2 px-3 bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 border border-white/[0.08] text-xs rounded-xl transition cursor-pointer"
                  >
                    {t('common:buttons.cancel', 'Cancel')}
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
                {t('control:stageT4.initiateBtn', 'Initiate Shutdown (S.3)')}
              </button>
            )}
          </div>

          {/* Cancel Shutdown */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 mb-1">
                <Power className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold">{t('control:stageT4.cancelShutdownTitle', 'Cancel Pending Shutdown')}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {t('control:stageT4.cancelShutdownDesc', 'Cancels any active shutdown countdown timer immediately.')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSendCommand({ type: 'CancelShutdown' }, 'Cancel Shutdown')}
              disabled={isExecuting || safetyStage !== 'T4PowerControl'}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-emerald-400 border border-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold transition cursor-pointer"
            >
              {t('control:stageT4.cancelShutdownBtn', 'Cancel Shutdown (CS)')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Control;
