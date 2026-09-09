import React, { useState } from 'react';
import { ShieldCheck, Zap, Battery, Sparkles, X, Info, Gauge } from 'lucide-react';
import { DiscoveredDevice, Q1Status, UpsMetadata } from '../lib/types';
import {
  calculateActiveWatts,
  calculateBatterySoC,
  calculateEstimatedRuntime,
  detectNominalVoltage,
  formatRuntime,
  POWER_FACTOR_PRESETS,
  CHEMISTRY_SPECS,
  BatteryChemistry,
} from '../lib/battery';

interface UpsSetupModalProps {
  device: DiscoveredDevice;
  status: Q1Status | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (metadata: UpsMetadata) => void;
}

const VA_PRESETS = [650, 1000, 1500, 2000, 3000, 6000, 10000];

export const UpsSetupModal: React.FC<UpsSetupModalProps> = ({
  device,
  status,
  isOpen,
  onClose,
  onSave,
}) => {
  // Auto-detect sensible nominal battery voltage from live telemetry if available
  const detectedBatVolt = detectNominalVoltage(status?.battery_voltage_v ?? 0);

  // Auto-suggest Online double-conversion if protocol indicates P01 or online, otherwise desktop
  const isOnlineHint = device.protocol_id?.toLowerCase().includes('p01') ||
                       device.protocol_id?.toLowerCase().includes('online');
  const initialPf = isOnlineHint ? 0.9 : 0.8;
  const initialTopology = isOnlineHint ? 'Online' : 'LineInteractive';

  const [name, setName] = useState(
    device.serial_number ? `UPS ${device.serial_number}` : 'My Connected UPS'
  );
  const [ratedVa, setRatedVa] = useState<number>(1000);
  const [powerFactor, setPowerFactor] = useState<number>(initialPf);
  const [batteryVoltage, setBatteryVoltage] = useState<number>(detectedBatVolt);
  const [batteryCapacityAh, setBatteryCapacityAh] = useState<number>(9.0);
  const [batteryChemistry, setBatteryChemistry] = useState<BatteryChemistry>('VRLA_SLA');
  const [topology, setTopology] = useState<string>(initialTopology);

  if (!isOpen) return null;

  const derivedWatts = calculateActiveWatts(ratedVa, powerFactor);

  // Live preview metrics
  const liveVoltage = status?.battery_voltage_v ?? 0;
  const liveSoc = liveVoltage > 0
    ? calculateBatterySoC(liveVoltage, batteryVoltage, batteryChemistry)
    : 100;
  const liveLoadWatts = status
    ? (status.output_watts > 0 ? status.output_watts : Math.round((status.output_load_pct / 100) * derivedWatts))
    : Math.round(0.2 * derivedWatts);
  const liveRuntime = calculateEstimatedRuntime(
    liveSoc,
    batteryVoltage,
    batteryCapacityAh,
    liveLoadWatts,
    topology,
    batteryChemistry
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      unique_id: device.unique_id,
      name: name.trim() || 'Connected UPS',
      rated_va: Math.max(50, ratedVa),
      power_factor: powerFactor,
      rated_watts: derivedWatts,
      battery_voltage: batteryVoltage,
      battery_capacity_ah: batteryCapacityAh,
      battery_chemistry: batteryChemistry,
      topology,
      updated_at: new Date().toISOString(),
    });
  };

  const handleApplyDefaults = () => {
    const defaultVa = 1000;
    const defaultPf = 0.8;
    onSave({
      unique_id: device.unique_id,
      name: name.trim() || 'Connected UPS',
      rated_va: defaultVa,
      power_factor: defaultPf,
      rated_watts: calculateActiveWatts(defaultVa, defaultPf),
      battery_voltage: detectedBatVolt,
      battery_capacity_ah: 9.0,
      battery_chemistry: 'VRLA_SLA',
      topology: initialTopology,
      updated_at: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-950/70 border border-emerald-800/60 rounded-xl text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">Configure Your UPS</h2>
              <p className="text-xs text-slate-400">First-time profile for accurate capacity (%) & runtime</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Hardware Identification Banner */}
        <div className="p-3.5 mx-5 mt-4 bg-slate-950/70 border border-slate-800/80 rounded-xl text-xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Detected Hardware</span>
            <span className="font-mono text-emerald-400">{device.port_name}</span>
          </div>
          <div className="font-mono text-[11px] text-slate-300 break-all bg-slate-900/90 p-2 rounded-lg border border-slate-800/50">
            {device.unique_id}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
            <span>Protocol: {device.protocol_id}</span>
            {device.firmware_version && <span>FW: {device.firmware_version}</span>}
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Friendly Name */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              UPS Model / Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Prolink PRO906-ES / Workstation UPS"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              required
            />
          </div>

          {/* 1. Apparent Power (VA) - Marketing Standard */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-300 flex items-center space-x-1.5">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span>Rated Capacity (Apparent Power)</span>
              </label>
              <span className="text-[11px] font-mono text-slate-500">Commercial Standard: VA</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {VA_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRatedVa(preset)}
                  className={`px-2.5 py-1 text-xs font-mono rounded-lg border transition ${
                    ratedVa === preset
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-600'
                      : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {preset >= 1000 ? `${preset / 1000}kVA` : `${preset}VA`}
                </button>
              ))}
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                min="50"
                max="100000"
                step="50"
                value={ratedVa}
                onChange={(e) => setRatedVa(Number(e.target.value))}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-cyan-500 transition"
                required
              />
              <span className="text-xs text-slate-400 font-mono font-medium">Volt-Amps (VA)</span>
            </div>
          </div>

          {/* 2. Inverter Power Factor (PF) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-300 flex items-center space-x-1.5">
                <Gauge className="w-3.5 h-3.5 text-amber-400" />
                <span>Inverter Class / Power Factor (PF)</span>
              </label>
              <span className="text-[11px] font-mono text-amber-400">
                Active Power: <strong className="text-white font-semibold">{derivedWatts}W</strong>
              </span>
            </div>
            <div className="space-y-1.5">
              {POWER_FACTOR_PRESETS.map((item) => (
                <label
                  key={item.pf}
                  className={`flex items-start space-x-3 p-2 rounded-xl border cursor-pointer transition text-xs ${
                    powerFactor === item.pf
                      ? 'bg-amber-950/30 border-amber-800/80 text-slate-200'
                      : 'bg-slate-950/40 border-slate-800/60 text-slate-400 hover:bg-slate-850'
                  }`}
                >
                  <input
                    type="radio"
                    name="powerFactor"
                    checked={powerFactor === item.pf}
                    onChange={() => {
                      setPowerFactor(item.pf);
                      if (item.pf === 0.9) setTopology('Online');
                      else if (item.pf === 0.6) setTopology('LineInteractive');
                    }}
                    className="mt-0.5 text-amber-500 focus:ring-amber-500"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-slate-200">{item.label}</div>
                    <div className="text-[11px] text-slate-500">{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 3. Battery Chemistry & Voltage */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Chemistry */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center space-x-1.5">
                <Battery className="w-3.5 h-3.5 text-emerald-400" />
                <span>Battery Chemistry</span>
              </label>
              <select
                value={batteryChemistry}
                onChange={(e) => setBatteryChemistry(e.target.value as BatteryChemistry)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value="VRLA_SLA">Standard VRLA / AGM (Default)</option>
                <option value="GEL">Gel Cell Lead-Acid</option>
                <option value="LIFEPO4">Lithium Iron Phosphate (LiFePO4)</option>
              </select>
              <p className="text-[10px] text-slate-500 mt-1">
                {CHEMISTRY_SPECS[batteryChemistry]?.description || 'Sealed Lead-Acid'}
              </p>
            </div>

            {/* Pack Voltage */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Pack Nominal Voltage
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
                <option value={192}>192V (16 Batteries - PRO906/910 High Voltage)</option>
                <option value={240}>240V (20 Batteries)</option>
              </select>
              {liveVoltage > 0 && (
                <p className="text-[10px] text-emerald-400 mt-1 font-mono">
                  Live: {liveVoltage}V (Auto-detected: {detectedBatVolt}V)
                </p>
              )}
            </div>
          </div>

          {/* Battery Ah */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-300">
                Battery Capacity (Ah per block)
              </label>
              <span className="text-[11px] font-mono text-slate-500">Default: 9.0 Ah</span>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                min="1.0"
                max="500.0"
                step="0.5"
                value={batteryCapacityAh}
                onChange={(e) => setBatteryCapacityAh(Number(e.target.value))}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-cyan-500 transition"
                required
              />
              <span className="text-xs text-slate-400 font-mono">Ampere-Hours (Ah)</span>
            </div>
          </div>

          {/* Live Preview / Calibration Banner */}
          {liveVoltage > 0 && (
            <div className="p-3 bg-emerald-950/30 border border-emerald-800/60 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2 text-emerald-300">
                <Info className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Live Calibration Preview:</span>
              </div>
              <div className="flex items-center space-x-4 font-mono">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase block">Capacity</span>
                  <span className="text-emerald-400 font-bold text-sm">{liveSoc}%</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase block">Est. Runtime</span>
                  <span className="text-cyan-400 font-bold text-sm">{formatRuntime(liveRuntime)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <button
              type="button"
              onClick={handleApplyDefaults}
              className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition"
            >
              Apply Standard Defaults (1kVA / 0.8 PF)
            </button>
            <div className="flex items-center space-x-2">
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5 shadow-md shadow-emerald-950 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Save & Start Monitoring</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

