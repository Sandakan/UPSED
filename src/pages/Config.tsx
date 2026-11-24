import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, XCircle, Sliders, Lock, Unlock } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { UnlockStage, VoltronicCommand } from '../lib/types';
import { api } from '../lib/tauri';
import { PrimaryButton } from '../components/PrimaryButton';

interface ConfigProps {
  portName: string | null;
  upsId?: string | null;
  safetyStage: UnlockStage;
}

export const Config: React.FC<ConfigProps> = ({ portName, upsId, safetyStage: _safetyStage }) => {
  const { t } = useTranslation(['config', 'common']);
  const auth = useAuth();
  const [bypassHigh, setBypassHigh] = useState<number>(260);
  const [bypassLow, setBypassLow] = useState<number>(190);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isLocked = !auth.status?.authenticated;

  const handleSaveParam = async (cmd: VoltronicCommand, label: string) => {
    if (!portName) {
      setStatusMessage(t('config:feedback.noDevice', 'Error: No active UPS device selected or device is offline'));
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const resp = await api.sendCommand(portName, cmd, upsId || undefined);
      setStatusMessage(t('config:feedback.success', { label, resp, defaultValue: `Success: ${label} saved to UPS EEPROM (Response: ${resp})` }));
    } catch (err: any) {
      setStatusMessage(t('config:feedback.failed', { error: err?.message || String(err), defaultValue: `Failed: ${err?.message || String(err)}` }));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)] custom-scrollbar min-w-0">
      {/* Protected Access Alert */}
      {isLocked && (
        <div className="p-4 rounded-2xl bg-indigo-500/[0.08] border border-indigo-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start space-x-3.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="text-xs">
              <h4 className="font-semibold text-indigo-300">
                {t('config:alert.lockedTitle', 'Configuration Writes are Protected')}
              </h4>
              <p className="text-slate-400 mt-1 leading-relaxed">
                {t(
                  'config:alert.lockedDesc',
                  'Writing parameters alters the UPS EEPROM/flash memory. Log in as administrator to unlock parameter writes.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => auth.requireAuth(() => {}, 'Unlock Configuration Writes')}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-950/40 transition cursor-pointer shrink-0 self-start sm:self-auto flex items-center gap-1.5"
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>
              {auth.status?.os_auth_available
                ? `Unlock with ${auth.status.provider_name}`
                : t('config:alert.unlockBtn', 'Log In to Unlock')}
            </span>
          </button>
        </div>
      )}

      {statusMessage && (
        <div
          className={`p-3 rounded-xl border text-xs font-mono flex items-center space-x-2 ${
            statusMessage.startsWith('Success')
              ? 'bg-emerald-950/30 border-emerald-700/40 text-emerald-300'
              : 'bg-rose-950/30 border-rose-700/40 text-rose-300'
          }`}
        >
          {statusMessage.startsWith('Success') ? (
            <Check className="w-4 h-4 flex-shrink-0 text-emerald-400" />
          ) : (
            <XCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
          )}
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Bypass Window Parameters */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center space-x-2.5 mb-4">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              {t('config:bypassSection.title', 'AC Bypass Voltage Window')}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('config:bypassSection.desc', 'Define the acceptable grid voltage boundaries for automatic bypass transfer.')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Bypass High Voltage */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-2">
            <label className="text-xs font-semibold text-slate-200 block">
              {t('config:bypassSection.highLabel', 'Bypass High Voltage Limit (PHV)')}
            </label>
            <p className="text-[11px] text-slate-400">{t('config:bypassSection.highDesc', 'Upper acceptable threshold (180V - 270V)')}</p>
            <div className="flex space-x-2 pt-1">
              <input
                type="number"
                min="240"
                max="270"
                step="5"
                value={bypassHigh}
                onChange={(e) => setBypassHigh(Number(e.target.value))}
                disabled={isLocked || isSaving}
                className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 disabled:opacity-40 focus:outline-none focus:border-emerald-500/60 transition"
              />
              <PrimaryButton
                onClick={() =>
                  auth.requireAuth(() =>
                    handleSaveParam(
                      { type: 'SetBypassHighVoltage', payload: bypassHigh },
                      `Bypass High ${bypassHigh}V`
                    )
                  )
                }
                disabled={isSaving}
              >
                <span>{t('common:buttons.apply', 'Apply')}</span>
              </PrimaryButton>
            </div>
          </div>

          {/* Bypass Low Voltage */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-2">
            <label className="text-xs font-semibold text-slate-200 block">
              {t('config:bypassSection.lowLabel', 'Bypass Low Voltage Limit (PLV)')}
            </label>
            <p className="text-[11px] text-slate-400">{t('config:bypassSection.lowDesc', 'Lower acceptable threshold (170V - 220V)')}</p>
            <div className="flex space-x-2 pt-1">
              <input
                type="number"
                min="170"
                max="220"
                step="5"
                value={bypassLow}
                onChange={(e) => setBypassLow(Number(e.target.value))}
                disabled={isLocked || isSaving}
                className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 disabled:opacity-40 focus:outline-none focus:border-emerald-500/60 transition"
              />
              <PrimaryButton
                onClick={() =>
                  auth.requireAuth(() =>
                    handleSaveParam(
                      { type: 'SetBypassLowVoltage', payload: bypassLow },
                      `Bypass Low ${bypassLow}V`
                    )
                  )
                }
                disabled={isSaving}
              >
                <span>{t('common:buttons.apply', 'Apply')}</span>
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Config;
