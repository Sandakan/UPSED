import React, { useState, useEffect } from 'react';
import { Battery, Clock, Shield, Save, Check, Zap, Bell, Monitor, Sun, Moon, AlertTriangle } from 'lucide-react';
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from '@tauri-apps/plugin-autostart';
import { api } from '../lib/tauri';
import { UpsMetadata, ThemeMode } from '../lib/types';
import { PrimaryButton } from '../components/PrimaryButton';
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
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
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
  themeMode,
  onThemeModeChange,
}) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(themeMode);
  const [intervalVal, setIntervalVal] = useState(pollInterval);
  const [bridgeVal, setBridgeVal] = useState(batteryBridgeActive);
  const [osNotifVal, setOsNotifVal] = useState(osNotificationsEnabled);
  const [inAppToastVal, setInAppToastVal] = useState(inAppToastsEnabled);
  const [autostartVal, setAutostartVal] = useState(false);
  const [startMinimizedVal, setStartMinimizedVal] = useState(true);
  const [closeToMinimizeVal, setCloseToMinimizeVal] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);
  const [isDev, setIsDev] = useState<boolean>(import.meta.env.DEV);

  useEffect(() => {
    setCurrentTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    api.isDevMode().then(setIsDev).catch(() => setIsDev(import.meta.env.DEV));
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
    onThemeModeChange(currentTheme);
    try {
      await api.setBatteryBridgeStatus(bridgeVal);
      await api.setCloseToMinimize(closeToMinimizeVal);
      await api.setStartMinimized(startMinimizedVal);

      if (!isDev) {
        if (autostartVal) {
          await enableAutostart();
        } else {
          await disableAutostart();
        }
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
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)] custom-scrollbar min-w-0">
      {savedNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-700/50 text-emerald-300 text-xs font-mono flex items-center space-x-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Settings successfully applied!</span>
        </div>
      )}

      {/* ── 1. Appearance & Color Theme ─────────────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-4"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Sun className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                Appearance & Color Theme
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Choose between dark, light, or automated OS preference syncing.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/[0.08]">
            {currentTheme === 'system' ? 'Syncing with OS' : `${currentTheme} mode`}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {/* System Option */}
          <button
            type="button"
            onClick={() => {
              setCurrentTheme('system');
              onThemeModeChange('system');
            }}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentTheme === 'system'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300">
                <Monitor className="w-4 h-4" />
              </div>
              {currentTheme === 'system' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">System Default</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Matches Windows color scheme
              </p>
            </div>
          </button>

          {/* Dark Option */}
          <button
            type="button"
            onClick={() => {
              setCurrentTheme('dark');
              onThemeModeChange('dark');
            }}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentTheme === 'dark'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300">
                <Moon className="w-4 h-4" />
              </div>
              {currentTheme === 'dark' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Dark Theme</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Obsidian & charcoal SaaS design
              </p>
            </div>
          </button>

          {/* Light Option */}
          <button
            type="button"
            onClick={() => {
              setCurrentTheme('light');
              onThemeModeChange('light');
            }}
            className={`p-4 rounded-xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
              currentTheme === 'light'
                ? 'border-emerald-500 bg-emerald-950/20 shadow-sm'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-white/[0.06] text-slate-300">
                <Sun className="w-4 h-4" />
              </div>
              {currentTheme === 'light' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Light Theme</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Crisp high-contrast daylight design
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* ── 2. Active UPS Profile & Specifications ───────────── */}
      {metadata && (
        <div
          className="rounded-2xl p-5 shadow-sm border transition space-y-4"
          style={{
            backgroundColor: 'var(--card-bg)',
            borderColor: 'var(--card-border)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5 text-slate-200">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-100">
                  Active UPS Profile & Specifications
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Calibrate rated power and battery banks to derive active watts and backup runtimes.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/[0.08]">
              ID: {metadata.unique_id}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                UPS Display Name
              </label>
              <input
                type="text"
                value={upsName}
                onChange={(e) => setUpsName(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
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
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
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
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
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
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
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
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
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
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60 transition"
                />
                <span className="text-xs font-mono text-slate-400">Ah</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. Telemetry Polling Interval ───────────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center space-x-2.5 text-slate-200">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-100">
              Telemetry Polling Interval
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Controls how frequently VoltWatch queries the hardware for live status (Q1). Takes effect immediately.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 pt-2">
          {[2, 5, 10, 30, 60].map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => {
                setIntervalVal(sec);
                onPollIntervalChange(sec);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                intervalVal === sec
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                  : 'bg-white/[0.03] border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
              }`}
            >
              {sec}s {sec === 10 ? '(Default)' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ── 4. OS Native Battery Bridge & Tray Monitor ──────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3.5"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Battery className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                OS Native Battery Bridge & Tray Monitor
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Exposes connected desktop UPS to the operating system as a native battery and taskbar icon.
              </p>
            </div>
          </div>
          <span className="text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Active by Default
          </span>
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <div>
            <p className="text-xs font-semibold text-slate-200">Emulate Native OS Battery</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Updates Windows tray fill gauge, Linux UPower (/dev/uhid), and macOS menu bar.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={bridgeVal}
              onChange={(e) => setBridgeVal(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
          </label>
        </div>
      </div>

      {/* ── 5. System Startup & Window Behavior ─────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3.5"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                System Startup & Window Behavior
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure background service behavior on computer boot and dismissal.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          {/* Dev Mode Autostart Warning Banner */}
          {isDev && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-300">Development Mode Active</p>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  Automatic startup on system login is disabled in development mode to prevent registering temporary debug binaries (<code className="px-1 py-0.5 rounded bg-black/30 text-amber-100 font-mono text-[10px]">target\debug\voltwatch.exe</code>) into Windows Startup.
                </p>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  Please install or run the production release build (<code className="px-1 py-0.5 rounded bg-black/30 text-amber-100 font-mono text-[10px]">voltwatch_0.1.0_x64-setup.exe</code>) to enable background autostart safely without requiring Vite.
                </p>
                {autostartVal && (
                  <button
                    type="button"
                    onClick={async () => {
                      await disableAutostart();
                      setAutostartVal(false);
                    }}
                    className="mt-1 px-2.5 py-1 text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-200 transition cursor-pointer"
                  >
                    Clean Up Stale Autostart Entry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Autostart Toggle */}
          <div className={`flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] ${isDev ? 'bg-white/[0.01] opacity-75' : 'bg-white/[0.02]'}`}>
            <div>
              <p className="text-xs font-semibold text-slate-200">Start with System Login</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isDev
                  ? 'Disabled in Dev Mode. Available in production release build.'
                  : 'Launch VoltWatch automatically in the background when you log in.'}
              </p>
            </div>
            <label className={`relative inline-flex items-center ${isDev ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={autostartVal}
                disabled={isDev}
                onChange={(e) => setAutostartVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
            </label>
          </div>

          {/* Start Minimized Sub-option */}
          {autostartVal && (
            <div className="flex items-center justify-between p-3.5 ml-4 rounded-xl border border-white/[0.07] bg-white/[0.02]">
              <div>
                <p className="text-xs font-semibold text-slate-200">Start Minimized to System Tray</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Starts quietly in the system tray at login without opening the application window.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={startMinimizedVal}
                  onChange={(e) => setStartMinimizedVal(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
              </label>
            </div>
          )}

          {/* Close to Minimize Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
            <div>
              <p className="text-xs font-semibold text-slate-200">Close Window to Minimize to Tray</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Clicking close (×) minimizes to tray so telemetry, outages, and automations run 24/7.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={closeToMinimizeVal}
                onChange={(e) => setCloseToMinimizeVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
            </label>
          </div>
        </div>
      </div>

      {/* ── 6. Notifications & Hardware Alarms ──────────────── */}
      <div
        className="rounded-2xl p-5 shadow-sm border transition space-y-3.5"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 text-slate-200">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-100">
                Notifications & Hardware Alarms
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure how critical UPS state transitions, blackouts, and warning flags are delivered.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
            <div>
              <p className="text-xs font-semibold text-slate-200">Native OS Desktop Notifications</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Send Windows Action Center banners with sound when VoltWatch is in tray or background.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={osNotifVal}
                onChange={(e) => setOsNotifVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
            <div>
              <p className="text-xs font-semibold text-slate-200">Custom In-App Toasts</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Display floating alerts in the bottom-right corner during live telemetry monitoring.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={inAppToastVal}
                onChange={(e) => setInAppToastVal(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/[0.1] border border-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#22c55e]"></div>
            </label>
          </div>
        </div>
      </div>

      {/* ── Save Settings Button ────────────────────────────── */}
      <div className="flex justify-end pt-1">
        <PrimaryButton
          onClick={handleSave}
          icon={<Save className="w-4 h-4" />}
          size="lg"
        >
          <span>Save Settings</span>
        </PrimaryButton>
      </div>

      {/* ── Legal & Clean-Room Notice ───────────────────────── */}
      <div
        className="rounded-2xl p-5 text-xs text-slate-400 space-y-2 border"
        style={{
          backgroundColor: 'var(--card-bg)',
          borderColor: 'var(--card-border)',
        }}
      >
        <div className="flex items-center space-x-2 text-slate-300 font-semibold">
          <Shield className="w-4 h-4 text-emerald-400" />
          <span>Legal Framework & Clean-Room Interoperability</span>
        </div>
        <p className="leading-relaxed text-[11px] text-slate-400">
          VoltWatch is an independent, clean-room reimplementation designed exclusively for hardware
          interoperability under the <strong>Digital Millennium Copyright Act (DMCA) §1201(f)</strong> and{' '}
          <strong>EU Directive 2009/24/EC Article 6</strong>. It contains no proprietary code, Java bytecode,
          or assets from Voltronic Power's ViewPower software.
        </p>
      </div>
    </div>
  );
};

export default Settings;
