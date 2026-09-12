import React, { useState } from 'react';
import { Wrench, ShieldAlert, Check, XCircle, Sliders } from 'lucide-react';
import { UnlockStage, VoltronicCommand } from '../lib/types';
import { api } from '../lib/tauri';
import { PrimaryButton } from '../components/PrimaryButton';

interface ConfigProps {
  portName: string | null;
  safetyStage: UnlockStage;
}

export const Config: React.FC<ConfigProps> = ({ portName, safetyStage }) => {
  const [chargeCurrent, setChargeCurrent] = useState<number>(20);
  const [bypassHigh, setBypassHigh] = useState<number>(260);
  const [bypassLow, setBypassLow] = useState<number>(190);
  const [batteryCutoff, setBatteryCutoff] = useState<number>(21.0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isLocked = safetyStage === 'T1ReadOnly' || safetyStage === 'T2NonDestructive';

  const handleSaveParam = async (cmd: VoltronicCommand, label: string) => {
    if (!portName) {
      setStatusMessage('Error: No active UPS device selected');
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const resp = await api.sendCommand(portName, cmd);
      setStatusMessage(`Success: ${label} saved to UPS EEPROM (Response: ${resp})`);
    } catch (err: any) {
      setStatusMessage(`Failed: ${err?.message || String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)] custom-scrollbar min-w-0">
      {/* Safety Gate Alert */}
      {isLocked && (
        <div className="p-4 rounded-2xl bg-amber-500/[0.08] border border-amber-500/20 flex items-start space-x-3.5">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="text-xs">
            <h4 className="font-semibold text-amber-300">
              Configuration Writes are Locked (Stage {safetyStage})
            </h4>
            <p className="text-slate-400 mt-1 leading-relaxed">
              Writing parameters alters the UPS EEPROM/flash memory. To unlock configuration writes,
              advance the Safety Gate to <strong>Stage T3 (Config Write)</strong> on the Hardware
              Control page.
            </p>
          </div>
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

      {/* Battery Charger Parameters */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center space-x-2.5 mb-4">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Wrench className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Battery & Charging Parameters
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Calibrate charging current limits and battery cutoff voltages.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Max Charge Current */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-2">
            <label className="text-xs font-semibold text-slate-200 block">
              Maximum Solar & Utility Charge Current (Amps)
            </label>
            <p className="text-[11px] text-slate-400">
              Valid range: 10A to 80A depending on inverter rating (MCHGC)
            </p>
            <div className="flex space-x-2 pt-1">
              <input
                type="number"
                min="10"
                max="80"
                step="5"
                value={chargeCurrent}
                onChange={(e) => setChargeCurrent(Number(e.target.value))}
                disabled={isLocked || isSaving}
                className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 disabled:opacity-40 focus:outline-none focus:border-emerald-500/60 transition"
              />
              <PrimaryButton
                onClick={() =>
                  handleSaveParam(
                    { type: 'SetChargeCurrentAmps', payload: chargeCurrent },
                    `Charge Current ${chargeCurrent}A`
                  )
                }
                disabled={isLocked || isSaving}
              >
                <span>Apply</span>
              </PrimaryButton>
            </div>
          </div>

          {/* Battery Low Cutoff Voltage */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-2">
            <label className="text-xs font-semibold text-slate-200 block">
              Battery Low Shutdown Cutoff Voltage (Volts)
            </label>
            <p className="text-[11px] text-slate-400">
              Minimum battery cutoff threshold before power shutdown (PSDV)
            </p>
            <div className="flex space-x-2 pt-1">
              <input
                type="number"
                min="18.0"
                max="54.0"
                step="0.5"
                value={batteryCutoff}
                onChange={(e) => setBatteryCutoff(Number(e.target.value))}
                disabled={isLocked || isSaving}
                className="flex-1 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 disabled:opacity-40 focus:outline-none focus:border-emerald-500/60 transition"
              />
              <PrimaryButton
                onClick={() =>
                  handleSaveParam(
                    { type: 'SetBatteryLowShutdownVoltage', payload: batteryCutoff },
                    `Battery Cutoff ${batteryCutoff}V`
                  )
                }
                disabled={isLocked || isSaving}
              >
                <span>Apply</span>
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>

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
              AC Bypass Voltage Window
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Define the acceptable grid voltage boundaries for automatic bypass transfer.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Bypass High Voltage */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-2">
            <label className="text-xs font-semibold text-slate-200 block">
              Bypass High Voltage Limit (PBVH)
            </label>
            <p className="text-[11px] text-slate-400">Upper acceptable threshold (180V - 270V)</p>
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
                  handleSaveParam(
                    { type: 'SetBypassHighVoltage', payload: bypassHigh },
                    `Bypass High ${bypassHigh}V`
                  )
                }
                disabled={isLocked || isSaving}
              >
                <span>Apply</span>
              </PrimaryButton>
            </div>
          </div>

          {/* Bypass Low Voltage */}
          <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-2">
            <label className="text-xs font-semibold text-slate-200 block">
              Bypass Low Voltage Limit (PBVL)
            </label>
            <p className="text-[11px] text-slate-400">Lower acceptable threshold (170V - 220V)</p>
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
                  handleSaveParam(
                    { type: 'SetBypassLowVoltage', payload: bypassLow },
                    `Bypass Low ${bypassLow}V`
                  )
                }
                disabled={isLocked || isSaving}
              >
                <span>Apply</span>
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Config;
