import React, { useMemo } from 'react';
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
} from 'recharts';
import { Q1Status, TelemetryRecord, UpsMetadata } from '../lib/types';
import { PowerFlowDiagram } from '../components/PowerFlowDiagram';
import { MetricGraphsHub } from '../components/MetricGraphsHub';
import {
  calculateActiveWatts,
  calculateBatterySoC,
  calculateEstimatedRuntime,
  detectNominalVoltage,
  formatRuntime,
} from '../lib/battery';

interface DashboardProps {
  status: Q1Status | null;
  history: TelemetryRecord[];
  portName: string | null;
  lastError?: string | null;
  metadata?: UpsMetadata | null;
}

export const Dashboard: React.FC<DashboardProps> = ({
  status,
  history,
  portName,
  lastError,
  metadata,
}) => {
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

  // Calculate battery percentage using calibrated cell curves
  const nominalBat = metadata?.battery_voltage
    ? Number(metadata.battery_voltage)
    : detectNominalVoltage(status.battery_voltage_v);
  const batPct = calculateBatterySoC(
    status.battery_voltage_v,
    nominalBat,
    metadata?.battery_chemistry ?? 'VRLA_SLA'
  );

  const ratedW =
    metadata?.rated_watts ||
    (metadata?.rated_va
      ? calculateActiveWatts(metadata.rated_va, metadata.power_factor || 0.8)
      : 600);
  const effectiveWatts =
    status.output_watts > 0
      ? status.output_watts
      : Math.round((status.output_load_pct / 100) * ratedW);

  const estRuntimeMins = calculateEstimatedRuntime(
    batPct,
    nominalBat,
    metadata?.battery_capacity_ah ?? 9.0,
    effectiveWatts,
    metadata?.topology ?? 'Online',
    metadata?.battery_chemistry ?? 'VRLA_SLA'
  );

  const sparkData = useMemo(() => {
    return history.slice(-15).map((h) => ({
      gridV: h.grid_voltage,
      load: h.load_pct,
      batV: h.battery_voltage,
      temp: h.temperature_c,
    }));
  }, [history]);

  return (
    <div className="p-3.5 sm:p-5 md:p-6 space-y-4 sm:space-y-6 overflow-y-auto max-h-[calc(100vh-4rem)] min-w-0">
      {/* Top Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-4">
        {/* Grid Input Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
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
              <span className={status.utility_fail ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                {status.utility_fail ? 'FAIL' : 'OK'}
              </span>
            </div>
          </div>

          {/* Mini Sparkline */}
          <div className="h-8 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sparkGridV" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="gridV" stroke="#f59e0b" strokeWidth={1.5} fill="url(#sparkGridV)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Output Load Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Output Load</span>
              <Gauge className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-slate-100 font-mono">
                {status.output_load_pct}
              </span>
              <span className="text-sm text-slate-400">%</span>
              <span className="text-xs text-slate-400 font-mono ml-auto" title="Active Output Power">
                {effectiveWatts} W
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2.5 overflow-hidden">
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

          {/* Mini Sparkline */}
          <div className="h-8 w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sparkLoad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="load" stroke="#06b6d4" strokeWidth={1.5} fill="url(#sparkLoad)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Battery State Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
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
              <div className="ml-auto text-right font-mono">
                <span className="text-xs text-emerald-400 font-semibold">{batPct}%</span>
                <span className="text-[11px] text-slate-500 block">~{formatRuntime(estRuntimeMins)}</span>
              </div>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  status.battery_low ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${batPct}%` }}
              />
            </div>
          </div>

          {/* Mini Sparkline */}
          <div className="h-8 w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sparkBat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="batV" stroke="#10b981" strokeWidth={1.5} fill="url(#sparkBat)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Internal Thermals Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
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

          {/* Mini Sparkline */}
          <div className="h-8 w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sparkTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={1.5} fill="url(#sparkTemp)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Modern UPS Single-Line Power Flow Topology Graphic */}
      <PowerFlowDiagram status={status} portName={portName} metadata={metadata} />

      {/* Real-Time Telemetry & Multi-Metric Graphs Hub */}
      <MetricGraphsHub status={status} history={history} metadata={metadata} />

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

