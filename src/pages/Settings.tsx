import React, { useState } from 'react';
import { Settings as SettingsIcon, Battery, Clock, Shield, Save, Check } from 'lucide-react';
import { api } from '../lib/tauri';

interface SettingsProps {
  pollInterval: number;
  onPollIntervalChange: (val: number) => void;
  batteryBridgeActive: boolean;
  onBatteryBridgeChange: (val: boolean) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  pollInterval,
  onPollIntervalChange,
  batteryBridgeActive,
  onBatteryBridgeChange,
}) => {
  const [intervalVal, setIntervalVal] = useState(pollInterval);
  const [bridgeVal, setBridgeVal] = useState(batteryBridgeActive);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = async () => {
    onPollIntervalChange(intervalVal);
    onBatteryBridgeChange(bridgeVal);
    try {
      await api.setBatteryBridgeStatus(bridgeVal);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
      <div className="flex items-center space-x-3 mb-2">
        <div className="p-2 bg-slate-800 rounded-xl text-slate-300">
          <SettingsIcon className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-100">Application Settings</h3>
          <p className="text-xs text-slate-400">Configure telemetry polling, hardware ports, and OS integration</p>
        </div>
      </div>

      {savedNotice && (
        <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-xs font-mono flex items-center space-x-2">
          <Check className="w-4 h-4" />
          <span>Settings successfully applied!</span>
        </div>
      )}

      {/* Telemetry Polling Interval */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-3">
        <div className="flex items-center space-x-2 text-slate-200">
          <Clock className="w-4 h-4 text-cyan-400" />
          <h4 className="text-sm font-semibold">Telemetry Polling Interval</h4>
        </div>
        <p className="text-xs text-slate-400 max-w-xl">
          Controls how frequently VoltWatch queries the UPS hardware for live status (Q1/QPIGS).
          Default is <strong>30 seconds</strong> (matching ViewPower standard).
        </p>

        <div className="flex items-center space-x-3 pt-2">
          {[5, 10, 30, 60].map((sec) => (
            <button
              key={sec}
              onClick={() => setIntervalVal(sec)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                intervalVal === sec
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {sec} seconds {sec === 30 ? '(Default)' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* OS Native Battery Bridge (Disabled by default) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-200">
            <Battery className="w-4 h-4 text-emerald-400" />
            <h4 className="text-sm font-semibold">OS Native Battery Bridge</h4>
          </div>
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            Opt-In (Default: Off)
          </span>
        </div>

        <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
          Exposes your connected desktop UPS to the operating system as a native laptop battery.
          When active:
          <br />
          • <strong>Windows:</strong> Updates the system tray battery fill gauge and tooltip.
          <br />
          • <strong>Linux:</strong> Bridges through <code className="text-cyan-300">/dev/uhid</code> into UPower for native GNOME/KDE taskbar indicators.
          <br />
          • <strong>macOS:</strong> Registers an IOPMLib power source in the menu bar.
        </p>

        <div className="flex items-center space-x-3 pt-1">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={bridgeVal}
              onChange={(e) => setBridgeVal(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
          <span className="text-xs font-semibold text-slate-300">
            {bridgeVal ? 'Enabled (Active)' : 'Disabled (Default)'}
          </span>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center space-x-2 transition shadow-lg shadow-cyan-900/30"
        >
          <Save className="w-4 h-4" />
          <span>Save Settings</span>
        </button>
      </div>

      {/* Legal & Clean-Room Fair Use Acknowledgment */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 text-xs text-slate-400 space-y-2">
        <div className="flex items-center space-x-2 text-slate-300 font-semibold">
          <Shield className="w-4 h-4 text-cyan-400" />
          <span>Legal Framework & Fair Use Notice</span>
        </div>
        <p className="leading-relaxed text-[11px] text-slate-500">
          VoltWatch is an independent, clean-room reimplementation designed exclusively for hardware
          interoperability under the <strong>Digital Millennium Copyright Act (DMCA) §1201(f)</strong> and{' '}
          <strong>EU Directive 2009/24/EC Article 6</strong>. It contains no proprietary code, Java bytecode,
          or assets from Voltronic Power's ViewPower software. Voltronic serial protocols are open hardware
          communication standards also supported by the Network UPS Tools (NUT) open-source community.
        </p>
      </div>
    </div>
  );
};

