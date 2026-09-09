import React from 'react';
import {
  Zap,
  Battery,
  Gauge,
  Thermometer,
  AlertTriangle,
  Activity,
  CheckCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Q1Status, TelemetryRecord } from '../lib/types';

interface DashboardProps {
  status: Q1Status | null;
  history: TelemetryRecord[];
  portName: string | null;
  lastError?: string | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ status, history, portName, lastError }) => {
  if (!portName || !status) {
    return (
      <div className="h-full flex-1 flex flex-col items-center justify-center p-8 text-center">
        {lastError ? (
          <>
            <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
            <h3 className="text-lg font-semibold text-slate-200">Connecting to UPS...</h3>
            <div className="mt-3 p-3 max-w-md bg-slate-900 border border-amber-500/30 rounded-xl text-left text-xs font-mono text-amber-300">
              <span className="text-slate-400 block mb-1 font-sans font-medium">Diagnostic status:</span>
              {lastError}
            </div>
            <p className="text-xs text-slate-400 max-w-sm mt-3">
              VoltWatch identified the UPS on {portName}. Detailed logs are written to stdout and the log file.
            </p>
          </>
        ) : (
          <>
            <Activity className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
            <h3 className="text-lg font-semibold text-slate-300">No Active UPS Telemetry</h3>
            <p className="text-sm text-slate-500 max-w-sm mt-1">
              Select or scan for a connected Voltronic UPS from the sidebar to start live monitoring.
            </p>
          </>
        )}
      </div>
    );
  }

  // Calculate approximate battery percentage from 24V or 48V nominal
  const nominalBat = status.battery_voltage_v > 30 ? 48.0 : 24.0;
  const minBat = nominalBat * 0.85;
  const maxBat = nominalBat * 1.15;
  const batPct = Math.min(
    100,
    Math.max(0, Math.round(((status.battery_voltage_v - minBat) / (maxBat - minBat)) * 100))
  );

  const chartData = history.slice(-20).map((h) => ({
    time: h.timestamp.split('T')[1]?.substring(0, 8) || '',
    load: h.load_pct,
    voltage: h.output_voltage,
    battery: h.battery_voltage,
  }));

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
      {/* Top Stat Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Grid Input Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">AC Input Grid</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-slate-100 font-mono">
              {status.grid_voltage_v.toFixed(1)}
            </span>
            <span className="text-sm text-slate-400">V</span>
          </div>
          <div className="text-xs text-slate-400 font-mono mt-1 flex justify-between">
            <span>Freq: {status.grid_frequency_hz.toFixed(1)} Hz</span>
            <span className={status.utility_fail ? 'text-rose-400' : 'text-emerald-400'}>
              {status.utility_fail ? 'FAIL' : 'OK'}
            </span>
          </div>
        </div>

        {/* Output Load Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Output Load</span>
            <Gauge className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-slate-100 font-mono">
              {status.output_load_pct}
            </span>
            <span className="text-sm text-slate-400">%</span>
            <span className="text-xs text-slate-500 font-mono ml-auto">
              {status.output_watts} W
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                status.output_load_pct > 80
                  ? 'bg-rose-500'
                  : status.output_load_pct > 60
                  ? 'bg-amber-500'
                  : 'bg-cyan-500'
              }`}
              style={{ width: `${Math.min(status.output_load_pct, 100)}%` }}
            />
          </div>
        </div>

        {/* Battery State Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Battery Bank</span>
            <Battery
              className={`w-4 h-4 ${status.battery_low ? 'text-rose-400' : 'text-emerald-400'}`}
            />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-slate-100 font-mono">
              {status.battery_voltage_v.toFixed(1)}
            </span>
            <span className="text-sm text-slate-400">V</span>
            <span className="text-xs text-slate-500 font-mono ml-auto">
              ~{batPct}%
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                status.battery_low ? 'bg-rose-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${batPct}%` }}
            />
          </div>
        </div>

        {/* Internal Thermals Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Inverter Temp</span>
            <Thermometer className="w-4 h-4 text-orange-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-slate-100 font-mono">
              {status.temperature_c}
            </span>
            <span className="text-sm text-slate-400">°C</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Output: {status.output_voltage_v.toFixed(1)}V @ {status.output_frequency_hz.toFixed(1)}Hz
          </p>
        </div>
      </div>

      {/* Real-Time Telemetry Chart */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Live Load & Voltage Telemetry</h3>
            <p className="text-xs text-slate-400">Continuous hardware sampling</p>
          </div>
          <div className="flex items-center space-x-4 text-xs font-mono">
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 rounded-full bg-cyan-500" />
              <span className="text-slate-300">Load %</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-slate-300">Output Voltage (V)</span>
            </div>
          </div>
        </div>

        <div className="h-64 w-full">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
              Collecting telemetry points...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="voltGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="load"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#loadGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="voltage"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#voltGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Warnings and Status Bit Flags */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
          <h4 className="text-sm font-semibold text-slate-200 mb-3 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>Hardware Status Flags</span>
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between ${
                status.utility_fail
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400'
              }`}
            >
              <span>AC Utility Grid</span>
              <span className="font-semibold">{status.utility_fail ? 'FAILED' : 'NORMAL'}</span>
            </div>

            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between ${
                status.battery_low
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400'
              }`}
            >
              <span>Battery Level</span>
              <span className="font-semibold">{status.battery_low ? 'LOW' : 'OK'}</span>
            </div>

            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between ${
                status.bypass_active
                  ? 'bg-blue-950/40 border-blue-800/60 text-blue-300'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400'
              }`}
            >
              <span>Bypass Relay</span>
              <span className="font-semibold">{status.bypass_active ? 'ACTIVE' : 'OFF'}</span>
            </div>

            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between ${
                status.ups_failed
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-300 animate-pulse'
                  : 'bg-slate-950/40 border-slate-800 text-slate-400'
              }`}
            >
              <span>Inverter Diagnostics</span>
              <span className="font-semibold">{status.ups_failed ? 'FAULT' : 'HEALTHY'}</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-200 mb-2 flex items-center space-x-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>Safety & Clean-Room Architecture</span>
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              VoltWatch operates directly over serial/USB with zero embedded web servers, RMI, or
              Struts2 middleware. All protocol communication is strictly validated and safety-gated
              to protect device firmware.
            </p>
          </div>
          <div className="text-[11px] font-mono text-slate-500 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 mt-3">
            Hardware Port: {portName} • Baud: 2400 8N1 • Protocol: Voltronic Q1
          </div>
        </div>
      </div>
    </div>
  );
};

