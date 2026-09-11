import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Battery, Clock, Shield, Save, Check, Zap, Bell, Monitor } from 'lucide-react';
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from '@tauri-apps/plugin-autostart';
import { api } from '../lib/tauri';
import { UpsMetadata } from '../lib/types';
import {
  calculateActiveWatts,
  BatteryChemistry,
} from '../lib/battery';

interface SettingsProps {
  pollInterval: number;
  onPollIntervalChange: (val: number) => void;
  batteryBridgeActive: boolean;
  onBatteryBridgeChange: (val: boolean) => void;
  metadata?: UpsMetadata | null;
  onUpdateMetadata?: (val: UpsMetadata) => void;
  osNotificationsEnabled: boolean;
  onOsNotificationsChange: (val: boolean) => void;
  inAppToastsEnabled: boolean;
  onInAppToastsChange: (val: boolean) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  pollInterval,
  onPollIntervalChange,
  batteryBridgeActive,
  onBatteryBridgeChange,
  metadata,
  onUpdateMetadata,
  osNotificationsEnabled,
  onOsNotificationsChange,
  inAppToastsEnabled,
  onInAppToastsChange,
}) => {
  const [intervalVal, setIntervalVal] = useState(pollInterval);
  const [bridgeVal, setBridgeVal] = useState(batteryBridgeActive);
  const [osNotifVal, setOsNotifVal] = useState(osNotificationsEnabled);
  const [inAppToastVal, setInAppToastVal] = useState(inAppToastsEnabled);
  const [autostartVal, setAutostartVal] = useState(false);
  const [startMinimizedVal, setStartMinimizedVal] = useState(true);
  const [closeToMinimizeVal, setCloseToMinimizeVal] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    isAutostartEnabled().then(setAutostartVal).catch(console.error);
    api.getCloseToMinimize().then(setCloseToMinimizeVal).catch(console.error);
    api.getStartMinimized().then(setStartMinimizedVal).catch(console.error);
  }, []);

  // UPS Profile state
  const [upsName, setUpsName] = useState(metadata?.name || 'Connected UPS');
  const [ratedVa, setRatedVa] = useState(metadata?.rated_va || 1000);
  const [powerFactor, setPowerFactor] = useState(metadata?.power_factor || 0.8);
  const [batteryVoltage, setBatteryVoltage] = useState(metadata?.battery_voltage || 24);
  const [batteryCapacityAh, setBatteryCapacityAh] = useState(metadata?.battery_capacity_ah || 9.0);
  const [batteryChemistry, setBatteryChemistry] = useState<BatteryChemistry>(
    (metadata?.battery_chemistry as BatteryChemistry) || 'VRLA_SLA'
  );
  const [topology, setTopology] = useState(metadata?.topology || 'Online');

  useEffect(() => {
    if (metadata) {
      setUpsName(metadata.name);
      setRatedVa(metadata.rated_va);
      setPowerFactor(metadata.power_factor || 0.8);
      setBatteryVoltage(metadata.battery_voltage);
      setBatteryCapacityAh(metadata.battery_capacity_ah);
      setBatteryChemistry((metadata.battery_chemistry as BatteryChemistry) || 'VRLA_SLA');
      setTopology(metadata.topology || 'Online');
    }
  }, [metadata]);

  const derivedWatts = calculateActiveWatts(ratedVa, powerFactor);

  const handleSave = async () => {
    onPollIntervalChange(intervalVal);
    onBatteryBridgeChange(bridgeVal);
    onOsNotificationsChange(osNotifVal);
    onInAppToastsChange(inAppToastVal);
    try {
      await api.setBatteryBridgeStatus(bridgeVal);
      await api.setCloseToMinimize(closeToMinimizeVal);
      await api.setStartMinimized(startMinimizedVal);

      if (autostartVal) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }

      if (metadata) {
        const updatedMeta: UpsMetadata = {
          ...metadata,
          name: upsName.trim() || 'Connected UPS',
          rated_va: Math.max(50, Number(ratedVa)),
          power_factor: Number(powerFactor),
          rated_watts: derivedWatts,
          battery_voltage: Number(batteryVoltage),
          battery_capacity_ah: Number(batteryCapacityAh),
          battery_chemistry: batteryChemistry,
          topology,
          updated_at: new Date().toISOString(),
        };
        await api.saveUpsMetadata(updatedMeta);
        onUpdateMetadata?.(updatedMeta);
      }
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

      {/* UPS Profile & Capacity Specifications */}
      {metadata && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-slate-200">
              <Zap className="w-4 h-4 text-amber-400" />
              <h4 className="text-sm font-semibold">Active UPS Profile & Specifications</h4>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
              ID: {metadata.unique_id}
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Rated power and battery specifications are used to derive real-time active wattage, load current,
            and backup battery estimation.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                UPS Display Name
              </label>
              <input
                type="text"
                value={upsName}
                onChange={(e) => setUpsName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Rated Apparent Power (VA)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="50"
                  max="100000"
                  step="50"
                  value={ratedVa}
                  onChange={(e) => setRatedVa(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500 transition"
                />
                <span className="text-xs font-mono text-slate-400">VA</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Power Factor (PF) & Active Power
              </label>
              <div className="flex items-center space-x-2">
                <select
                  value={powerFactor}
                  onChange={(e) => setPowerFactor(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
                >
                  <option value={0.6}>0.6 (Desktop / Line-Interactive)</option>
                  <option value={0.8}>0.8 (Business / Server Prosumer)</option>
                  <option value={0.9}>0.9 (Online Double-Conversion)</option>
                  <option value={1.0}>1.0 (Enterprise Unity)</option>
                </select>
                <span className="text-xs font-mono text-emerald-400 whitespace-nowrap">
                  = {derivedWatts}W
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Battery Chemistry
              </label>
              <select
                value={batteryChemistry}
                onChange={(e) => setBatteryChemistry(e.target.value as BatteryChemistry)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value="VRLA_SLA">Standard Lead-Acid (VRLA / AGM)</option>
                <option value="GEL">Gel Cell Lead-Acid</option>
                <option value="LIFEPO4">Lithium Iron Phosphate (LiFePO4)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Nominal Battery Bank Voltage
              </label>
              <select
                value={batteryVoltage}
                onChange={(e) => setBatteryVoltage(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value={12}>12V (1 Battery)</option>
                <option value={24}>24V (2 Batteries - Standard)</option>
                <option value={36}>36V (3 Batteries)</option>
                <option value={48}>48V (4 Batteries)</option>
                <option value={72}>72V (6 Batteries)</option>
                <option value={96}>96V (8 Batteries)</option>
                <option value={192}>192V (16 Batteries - PRO906/910 Bank)</option>
                <option value={240}>240V (20 Batteries)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Battery Capacity (Ah)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="1.0"
                  max="500.0"
                  step="0.5"
                  value={batteryCapacityAh}
                  onChange={(e) => setBatteryCapacityAh(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500 transition"
                />
                <span className="text-xs font-mono text-slate-400">Ah</span>
              </div>
            </div>
          </div>
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
          Changes take effect <strong>immediately</strong> in the background monitor.
        </p>

        <div className="flex items-center space-x-3 pt-2">
          {[2, 5, 10, 30, 60].map((sec) => (
            <button
              key={sec}
              onClick={() => {
                setIntervalVal(sec);
                onPollIntervalChange(sec);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                intervalVal === sec
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {sec}s {sec === 10 ? '(Default)' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* OS Native Battery Bridge & Tray Monitor */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-200">
            <Battery className="w-4 h-4 text-emerald-400" />
            <h4 className="text-sm font-semibold">OS Native Battery Bridge & Tray Monitor</h4>
          </div>
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
            Active by Default
          </span>
        </div>

        <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
          Exposes your connected desktop UPS to the operating system as a native battery and taskbar icon.
          When active:
          <br />
          • <strong>Windows:</strong> Updates the system tray battery fill gauge and live tooltip.
          <br />
          • <strong>Linux:</strong> Bridges through <code className="text-cyan-300">/dev/uhid</code> into UPower for native taskbar indicators.
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
            {bridgeVal ? 'Enabled (Active)' : 'Disabled'}
          </span>
        </div>
      </div>

      {/* System Startup & Window Behavior */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-200">
            <Monitor className="w-4 h-4 text-cyan-400" />
            <h4 className="text-sm font-semibold">System Startup & Window Behavior</h4>
          </div>
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            Background Service
          </span>
        </div>

        <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
          Configure how VoltWatch runs on machine startup and manages its desktop window when dismissed.
        </p>

        <div className="space-y-4 pt-1">
          {/* Autostart Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <div>
              <p className="text-xs font-semibold text-slate-200">Start with System Login</p>
              <p className="text-[11px] text-slate-400">
                Launch VoltWatch automatically in the background when you log in to your computer.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autostartVal}
                onChange={(e) => setAutostartVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>

          {/* Start Minimized Sub-option */}
          {autostartVal && (
            <div className="flex items-center justify-between p-3 ml-4 bg-slate-950/40 rounded-xl border border-slate-800/80">
              <div>
                <p className="text-xs font-semibold text-slate-200">Start Minimized to System Tray</p>
                <p className="text-[11px] text-slate-400">
                  Starts quietly in the system tray at login without popping up the application window.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={startMinimizedVal}
                  onChange={(e) => setStartMinimizedVal(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
              </label>
            </div>
          )}

          {/* Close to Minimize Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <div>
              <p className="text-xs font-semibold text-slate-200">Close Window to Minimize to Tray</p>
              <p className="text-[11px] text-slate-400">
                Clicking the window close button (×) hides the window to the system tray so background telemetry,
                outage logging, and safety automations continue running 24/7. Quit anytime via tray right-click.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={closeToMinimizeVal}
                onChange={(e) => setCloseToMinimizeVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Notifications & Hardware Alarms */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-200">
            <Bell className="w-4 h-4 text-cyan-400" />
            <h4 className="text-sm font-semibold">Notifications & Hardware Alarms</h4>
          </div>
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            Real-time
          </span>
        </div>

        <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
          Configure how critical UPS state transitions, power outages, and alarms are delivered.
        </p>

        <div className="space-y-4 pt-1">
          <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <div>
              <p className="text-xs font-semibold text-slate-200">Native OS Desktop Notifications</p>
              <p className="text-[11px] text-slate-400">
                Trigger Windows Action Center banners with sound when VoltWatch is out of focus, minimized, or in tray.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={osNotifVal}
                onChange={(e) => setOsNotifVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <div>
              <p className="text-xs font-semibold text-slate-200">Custom In-App Toasts</p>
              <p className="text-[11px] text-slate-400">
                Display floating glassmorphic alerts in the bottom-right corner during live monitoring.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={inAppToastVal}
                onChange={(e) => setInAppToastVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>
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

