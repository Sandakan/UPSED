import React, { useState } from 'react';
import { Wrench, ShieldAlert, Save, Check, XCircle } from 'lucide-react';
import { UnlockStage, VoltronicCommand } from '../lib/types';
import { api } from '../lib/tauri';

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
    <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
      {/* Safety Gate Alert */}
      {isLocked && (
        <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-800/60 flex items-start space-x-3">
          <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <h4 className="font-semibold text-amber-300">
              Configuration Writes are Locked (Stage {safetyStage})
            </h4>
            <p className="text-slate-400 mt-0.5 leading-relaxed">
              Writing parameters alters the UPS EEPROM/flash memory. To unlock configuration writes,
              advance the Safety Gate to <strong>Stage T3 (Config Write)</strong> on the Hardware
              Control page after automated verification.
            </p>
          </div>
        </div>
      )}

      {statusMessage && (
        <div
          className={`p-3 rounded-xl border text-xs font-mono flex items-center space-x-2 ${
            statusMessage.startsWith('Success')
              ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
              : 'bg-rose-950/60 border-rose-800/80 text-rose-300'
          }`}
        >
          {statusMessage.startsWith('Success') ? (
            <Check className="w-4 h-4 flex-shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Battery Charger Parameters */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center space-x-2 mb-4">
          <Wrench className="w-4 h-4 text-cyan-400" />
          <h3 className="text-base font-semibold text-slate-100">
            Battery & Charging Parameters
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Max Charge Current */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 block">
              Maximum Solar & Utility Charge Current (Amps)
            </label>
            <p className="text-[11px] text-slate-500">
              Valid range: 10A to 80A depending on inverter rating (MCHGC)
            </p>
            <div className="flex space-x-3">
              <input
                type="number"
                min="10"
                max="80"
                step="5"
                value={chargeCurrent}
                onChange={(e) => setChargeCurrent(Number(e.target.value))}
                disabled={isLocked || isSaving}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-100 disabled:opacity-40"
              />
              <button
                onClick={() =>
                  handleSaveParam(
                    { type: 'SetChargeCurrentAmps', payload: chargeCurrent },
                    `Charge Current ${chargeCurrent}A`
                  )
                }
                disabled={isLocked || isSaving}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-cyan-900/30"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Apply</span>
              </button>
            </div>
          </div>

          {/* Battery Low Cutoff Voltage */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 block">
              Battery Low Shutdown Cutoff Voltage (Volts)
            </label>
            <p className="text-[11px] text-slate-500">
              Minimum battery cutoff threshold before power shutdown (PSDV)
            </p>
            <div className="flex space-x-3">
              <input
                type="number"
                min="18.0"
                max="54.0"
                step="0.5"
                value={batteryCutoff}
                onChange={(e) => setBatteryCutoff(Number(e.target.value))}
                disabled={isLocked || isSaving}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-100 disabled:opacity-40"
              />
              <button
                onClick={() =>
                  handleSaveParam(
                    { type: 'SetBatteryLowShutdownVoltage', payload: batteryCutoff },
                    `Battery Cutoff ${batteryCutoff}V`
                  )
                }
                disabled={isLocked || isSaving}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-cyan-900/30"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Apply</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bypass Window Parameters */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-100 mb-4">
          AC Bypass Voltage Window
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Bypass High Voltage */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 block">
              Bypass High Voltage Limit (PBVH)
            </label>
            <p className="text-[11px] text-slate-500">Upper acceptable threshold (180V - 270V)</p>
            <div className="flex space-x-3">
              <input
                type="number"
                min="240"
                max="270"
                step="5"
                value={bypassHigh}
                onChange={(e) => setBypassHigh(Number(e.target.value))}
                disabled={isLocked || isSaving}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-100 disabled:opacity-40"
              />
              <button
                onClick={() =>
                  handleSaveParam(
                    { type: 'SetBypassHighVoltage', payload: bypassHigh },
                    `Bypass High ${bypassHigh}V`
                  )
                }
                disabled={isLocked || isSaving}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-cyan-900/30"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Apply</span>
              </button>
            </div>
          </div>

          {/* Bypass Low Voltage */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 block">
              Bypass Low Voltage Limit (PBVL)
            </label>
            <p className="text-[11px] text-slate-500">Lower acceptable threshold (170V - 220V)</p>
            <div className="flex space-x-3">
              <input
                type="number"
                min="170"
                max="220"
                step="5"
                value={bypassLow}
                onChange={(e) => setBypassLow(Number(e.target.value))}
                disabled={isLocked || isSaving}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-100 disabled:opacity-40"
              />
              <button
                onClick={() =>
                  handleSaveParam(
                    { type: 'SetBypassLowVoltage', payload: bypassLow },
                    `Bypass Low ${bypassLow}V`
                  )
                }
                disabled={isLocked || isSaving}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-cyan-900/30"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Apply</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

