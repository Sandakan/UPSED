import React, { useState } from 'react';
import { ShieldCheck, Zap, Battery, Sparkles, X } from 'lucide-react';
import { DiscoveredDevice, Q1Status, UpsMetadata } from '../lib/types';

interface UpsSetupModalProps {
  device: DiscoveredDevice;
  status: Q1Status | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (metadata: UpsMetadata) => void;
}

const WATT_PRESETS = [360, 600, 900, 1200, 1800, 2400];

export const UpsSetupModal: React.FC<UpsSetupModalProps> = ({
  device,
  status,
  isOpen,
  onClose,
  onSave,
}) => {
  // Auto-detect sensible nominal battery voltage from live telemetry if available
  const detectedBatVolt = status
    ? status.battery_voltage_v > 30
      ? 48
      : status.battery_voltage_v > 18
      ? 24
      : 12
    : 24;

  const [name, setName] = useState(
    device.serial_number ? `UPS ${device.serial_number}` : 'Desktop UPS'
  );
  const [ratedWatts, setRatedWatts] = useState<number>(600);
  const [ratedVa, setRatedVa] = useState<number>(1000);
  const [batteryVoltage, setBatteryVoltage] = useState<number>(detectedBatVolt);
  const [batteryCapacityAh, setBatteryCapacityAh] = useState<number>(9.0);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      unique_id: device.unique_id,
      name: name.trim() || 'Connected UPS',
      rated_watts: Math.max(50, ratedWatts),
      rated_va: Math.max(50, ratedVa),
      battery_voltage: batteryVoltage,
      battery_capacity_ah: batteryCapacityAh,
      updated_at: new Date().toISOString(),
    });
  };

  const handleApplyDefaults = () => {
    onSave({
      unique_id: device.unique_id,
      name: name.trim() || 'Connected UPS',
      rated_watts: 600,
      rated_va: 1000,
      battery_voltage: detectedBatVolt,
      battery_capacity_ah: 9.0,
      updated_at: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-950/70 border border-emerald-800/60 rounded-xl text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">Configure New UPS</h2>
              <p className="text-xs text-slate-400">First-time profile for accurate telemetry metrics</p>
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
        <div className="p-4 mx-5 mt-4 bg-slate-950/70 border border-slate-800/80 rounded-xl text-xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Detected Hardware ID</span>
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
              UPS Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Office Workstation UPS"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              required
            />
          </div>

          {/* Rated Power (Watts) with presets */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-300 flex items-center space-x-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Rated Active Power (Watts)</span>
              </label>
              <span className="text-[11px] font-mono text-slate-500">Typical: 360W - 1200W</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 mb-2">
              {WATT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setRatedWatts(preset);
                    setRatedVa(Math.round(preset / 0.6));
                  }}
                  className={`py-1 text-xs font-mono rounded-lg border transition ${
                    ratedWatts === preset
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                      : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {preset}W
                </button>
              ))}
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                min="50"
                max="50000"
                step="10"
                value={ratedWatts}
                onChange={(e) => setRatedWatts(Number(e.target.value))}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-cyan-500 transition"
                required
              />
              <span className="text-xs text-slate-400 font-mono">Watts</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Used to calculate output watts and load amps from hardware percentage load.
            </p>
          </div>

          {/* Rated Apparent Power (VA) & Battery Voltage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Rated VA
              </label>
              <input
                type="number"
                min="50"
                max="100000"
                step="50"
                value={ratedVa}
                onChange={(e) => setRatedVa(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-cyan-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center space-x-1.5">
                <Battery className="w-3.5 h-3.5 text-cyan-400" />
                <span>Battery Voltage</span>
              </label>
              <select
                value={batteryVoltage}
                onChange={(e) => setBatteryVoltage(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value={12}>12V (1 Battery)</option>
                <option value={24}>24V (2 Batteries)</option>
                <option value={36}>36V (3 Batteries)</option>
                <option value={48}>48V (4 Batteries)</option>
              </select>
            </div>
          </div>

          {/* Battery Ah */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Battery Bank Capacity (Ah)
            </label>
            <input
              type="number"
              min="1.0"
              max="500.0"
              step="0.5"
              value={batteryCapacityAh}
              onChange={(e) => setBatteryCapacityAh(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Typical standard desktop batteries are 7.0 Ah to 9.0 Ah.
            </p>
          </div>

          {/* Action buttons */}
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={handleApplyDefaults}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition"
            >
              Use 600W Defaults
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5 shadow-md shadow-cyan-950"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Save & Start Monitoring</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
