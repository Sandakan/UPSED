import React from 'react';
import {
  Zap,
  Battery,
  ShieldCheck,
  AlertTriangle,
  Activity,
  Gauge,
  Thermometer,
} from 'lucide-react';
import { Q1Status, UpsMetadata } from '../lib/types';
import {
  calculateActiveWatts,
  calculateBatterySoC,
  calculateEstimatedRuntime,
  detectNominalVoltage,
} from '../lib/battery';

interface PowerFlowDiagramProps {
  status: Q1Status;
  portName?: string | null;
  metadata?: UpsMetadata | null;
}

const PowerFlowDiagramComponent: React.FC<PowerFlowDiagramProps> = ({ status, metadata }) => {
  // Operational mode determination
  const isFault = status.ups_failed;
  const isBypass = !isFault && status.bypass_active;
  const isBatteryMode = !isFault && !isBypass && status.utility_fail;
  const isLineMode = !isFault && !isBypass && !status.utility_fail;

  // Battery metrics using configured nominal voltage if available
  const nominalBat = metadata?.battery_voltage
    ? Number(metadata.battery_voltage)
    : detectNominalVoltage(status.battery_voltage_v);
  const batPct = calculateBatterySoC(
    status.battery_voltage_v,
    nominalBat,
    metadata?.battery_chemistry ?? 'VRLA_SLA'
  );

  // Rated active power (Watts)
  const ratedW =
    metadata?.rated_watts ||
    (metadata?.rated_va
      ? calculateActiveWatts(metadata.rated_va, metadata.power_factor || 0.8)
      : 600);
  const effectiveWatts =
    status.output_watts > 0
      ? status.output_watts
      : Math.round((status.output_load_pct / 100) * ratedW);

  // Backup runtime estimate (mins) using calibrated Peukert + inverter efficiency
  const estRuntime = calculateEstimatedRuntime(
    batPct,
    nominalBat,
    metadata?.battery_capacity_ah ?? 9.0,
    effectiveWatts,
    metadata?.topology ?? 'Online',
    metadata?.battery_chemistry ?? 'VRLA_SLA'
  );

  // Output current calculation (A)
  const currentA =
    status.output_voltage_v > 0
      ? (effectiveWatts / status.output_voltage_v).toFixed(1)
      : '0.0';

  // Conduit stroke colors and styles
  const inputActive = !status.utility_fail;
  const rectifierActive = isLineMode;
  const inverterActive = isLineMode || isBatteryMode;
  const batteryCharging = isLineMode && batPct < 98;
  const batteryDischarging = isBatteryMode;
  const outputActive = isLineMode || isBatteryMode || isBypass;

  const getPathClass = (active: boolean, colorClass: string, reverse: boolean = false) => {
    if (!active) return 'stroke-slate-800 transition-colors duration-500';
    return `${colorClass} ${reverse ? 'flow-active-reverse' : 'flow-active'} transition-colors duration-500`;
  };

  return (
    <div className="rounded-2xl p-5 shadow-sm border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
      {/* Top Header Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 bg-cyan-950/60 border border-cyan-800/60 rounded-lg text-cyan-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center space-x-2">
              <span>UPS Power Flow Topology</span>
            </h3>
            <p className="text-xs text-slate-400">Real-time electrical single-line schematic</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono">
          {/* Mode Pill */}
          {isFault ? (
            <span className="px-2.5 py-1 rounded-lg bg-rose-950/70 border border-rose-800 text-rose-400 flex items-center space-x-1.5 font-sans font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>UPS Fault</span>
            </span>
          ) : isBypass ? (
            <span className="px-2.5 py-1 rounded-lg bg-purple-950/70 border border-purple-800 text-purple-400 flex items-center space-x-1.5 font-sans font-medium">
              <Zap className="w-3.5 h-3.5" />
              <span>Bypass Mode</span>
            </span>
          ) : isBatteryMode ? (
            <span className="px-2.5 py-1 rounded-lg bg-amber-950/70 border border-amber-800 text-amber-400 flex items-center space-x-1.5 font-sans font-medium animate-pulse">
              <Battery className="w-3.5 h-3.5" />
              <span>Battery Mode (AC Fail)</span>
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-950/70 border border-emerald-800 text-emerald-400 flex items-center space-x-1.5 font-sans font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Line Mode (Online)</span>
            </span>
          )}

          {/* Thermals */}
          <div className="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-300 flex items-center space-x-1.5">
            <Thermometer className="w-3.5 h-3.5 text-orange-400" />
            <span>{status.temperature_c}°C</span>
          </div>
        </div>
      </div>

      {/* SVG Topology Schematic */}
      <div className="w-full overflow-x-auto py-2">
        <svg
          viewBox="0 0 940 290"
          className="w-full h-auto min-w-[720px] select-none"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* -------------------- CONDUIT PATHS -------------------- */}

          {/* 1. AC Input to Junction: X=50 to X=190, Y=140 */}
          <line
            x1="50"
            y1="140"
            x2="85"
            y2="140"
            strokeWidth="3"
            className={getPathClass(inputActive, 'stroke-emerald-400')}
          />
          <line
            x1="135"
            y1="140"
            x2="190"
            y2="140"
            strokeWidth="3"
            className={getPathClass(inputActive, 'stroke-emerald-400')}
          />

          {/* 2. Bypass Route:
              From (190, 140) -> UP to (190, 50) -> ACROSS to (750, 50) -> DOWN to (750, 140) */}
          <path
            d="M 190 140 L 190 50 L 750 50 L 750 140"
            strokeWidth="3"
            className={getPathClass(isBypass, 'stroke-purple-400')}
          />

          {/* Bypass switch status badge in center of bypass line */}
          <g transform="translate(470, 50)">
            <rect
              x="-45"
              y="-12"
              width="90"
              height="24"
              rx="6"
              className={
                isBypass
                  ? 'fill-purple-950 stroke-purple-500'
                  : 'fill-slate-950 stroke-slate-800'
              }
              strokeWidth="1.5"
            />
            <text
              x="0"
              y="4"
              textAnchor="middle"
              className={`text-[10px] font-mono font-semibold ${
                isBypass ? 'fill-purple-300' : 'fill-slate-500'
              }`}
            >
              {isBypass ? 'BYPASS ON' : 'BYPASS OFF'}
            </text>
          </g>

          {/* 3. Main Line: Junction (190, 140) to Rectifier (285, 140) */}
          <line
            x1="190"
            y1="140"
            x2="285"
            y2="140"
            strokeWidth="3"
            className={getPathClass(inputActive && !isBypass, 'stroke-emerald-400')}
          />

          {/* 4. Rectifier to Central DC Bus (355, 140) -> (470, 140) */}
          <line
            x1="355"
            y1="140"
            x2="470"
            y2="140"
            strokeWidth="3"
            className={getPathClass(rectifierActive, 'stroke-emerald-400')}
          />

          {/* 5. Central DC Bus to Inverter (470, 140) -> (585, 140) */}
          <line
            x1="470"
            y1="140"
            x2="585"
            y2="140"
            strokeWidth="3"
            className={getPathClass(inverterActive, isBatteryMode ? 'stroke-amber-400' : 'stroke-cyan-400')}
          />

          {/* 6. DC Bus down to Battery (470, 140) -> (470, 225) */}
          <line
            x1="470"
            y1="140"
            x2="470"
            y2="225"
            strokeWidth="3"
            className={
              batteryDischarging
                ? getPathClass(true, 'stroke-amber-400', true)
                : batteryCharging
                ? getPathClass(true, 'stroke-emerald-400', false)
                : 'stroke-slate-800'
            }
          />

          {/* 7. Inverter to Output Junction (655, 140) -> (750, 140) */}
          <line
            x1="655"
            y1="140"
            x2="750"
            y2="140"
            strokeWidth="3"
            className={getPathClass(inverterActive, isBatteryMode ? 'stroke-amber-400' : 'stroke-cyan-400')}
          />

          {/* 8. Output Junction to Output Node (750, 140) -> (805, 140) & beyond */}
          <line
            x1="750"
            y1="140"
            x2="805"
            y2="140"
            strokeWidth="3"
            className={getPathClass(outputActive, isBypass ? 'stroke-purple-400' : 'stroke-cyan-400')}
          />
          <line
            x1="855"
            y1="140"
            x2="890"
            y2="140"
            strokeWidth="3"
            className={getPathClass(outputActive, isBypass ? 'stroke-purple-400' : 'stroke-cyan-400')}
          />

          {/* Junction Dots */}
          <circle
            cx="190"
            cy="140"
            r="4"
            className={inputActive ? 'fill-emerald-400' : 'fill-slate-700'}
          />
          <circle
            cx="470"
            cy="140"
            r="5"
            className={
              isBatteryMode
                ? 'fill-amber-400'
                : rectifierActive
                ? 'fill-emerald-400'
                : 'fill-slate-700'
            }
          />
          <circle
            cx="750"
            cy="140"
            r="4"
            className={outputActive ? (isBypass ? 'fill-purple-400' : 'fill-cyan-400') : 'fill-slate-700'}
          />

          {/* -------------------- NODES & BLOCKS -------------------- */}

          {/* NODE 1: AC Input (110, 140) */}
          <g transform="translate(110, 140)">
            <circle
              cx="0"
              cy="0"
              r="25"
              className={
                inputActive
                  ? 'fill-slate-900 stroke-emerald-500 shadow-lg'
                  : 'fill-slate-900 stroke-rose-800/80'
              }
              strokeWidth="2.5"
            />
            {/* Sine wave path inside circle */}
            <path
              d="M -12 0 Q -6 -10 0 0 Q 6 10 12 0"
              className={inputActive ? 'stroke-emerald-400' : 'stroke-rose-400'}
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <text
              x="0"
              y="38"
              textAnchor="middle"
              className="fill-slate-300 text-[11px] font-semibold tracking-wider uppercase"
            >
              Input
            </text>
          </g>

          {/* BLOCK 2: Rectifier (AC -> DC) centered at (320, 140) */}
          <g transform="translate(320, 140)">
            <rect
              x="-35"
              y="-35"
              width="70"
              height="70"
              rx="12"
              className={
                rectifierActive
                  ? 'fill-slate-900 stroke-emerald-500/80'
                  : 'fill-slate-950 stroke-slate-800'
              }
              strokeWidth="2"
            />
            {/* Diagonal division line */}
            <line x1="-35" y1="35" x2="35" y2="-35" stroke="#334155" strokeWidth="1.5" />
            {/* AC Sine wave (top-left) */}
            <path
              d="M -22 -14 Q -16 -20 -10 -14 Q -4 -8 2 -14"
              className={rectifierActive ? 'stroke-emerald-400' : 'stroke-slate-600'}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            {/* DC Symbol = (bottom-right) */}
            <line
              x1="6"
              y1="12"
              x2="22"
              y2="12"
              className={rectifierActive ? 'stroke-emerald-400' : 'stroke-slate-600'}
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="6"
              y1="18"
              x2="22"
              y2="18"
              className={rectifierActive ? 'stroke-emerald-400' : 'stroke-slate-600'}
              strokeWidth="2"
              strokeDasharray="2 2"
            />
            <text
              x="0"
              y="48"
              textAnchor="middle"
              className="fill-slate-400 text-[10px] font-medium uppercase tracking-wider"
            >
              Rectifier
            </text>
          </g>

          {/* NODE 3: Battery Bank centered at (470, 245) */}
          <g transform="translate(470, 245)">
            <circle
              cx="0"
              cy="0"
              r="22"
              className={
                isBatteryMode
                  ? 'fill-slate-900 stroke-amber-400'
                  : batPct < 20
                  ? 'fill-slate-900 stroke-rose-500'
                  : 'fill-slate-900 stroke-cyan-500'
              }
              strokeWidth="2.5"
            />
            {/* Minimal Battery glyph [ + - ] */}
            <rect
              x="-10"
              y="-6"
              width="20"
              height="12"
              rx="2"
              className={isBatteryMode ? 'stroke-amber-300' : 'stroke-cyan-300'}
              strokeWidth="1.5"
              fill="none"
            />
            <line
              x1="-5"
              y1="0"
              x2="-1"
              y2="0"
              className={isBatteryMode ? 'stroke-amber-300' : 'stroke-cyan-300'}
              strokeWidth="1.5"
            />
            <line
              x1="-3"
              y1="-2"
              x2="-3"
              y2="2"
              className={isBatteryMode ? 'stroke-amber-300' : 'stroke-cyan-300'}
              strokeWidth="1.5"
            />
            <line
              x1="2"
              y1="0"
              x2="6"
              y2="0"
              className={isBatteryMode ? 'stroke-amber-300' : 'stroke-cyan-300'}
              strokeWidth="1.5"
            />
            <text
              x="0"
              y="34"
              textAnchor="middle"
              className="fill-slate-300 text-[11px] font-semibold tracking-wider uppercase"
            >
              Battery
            </text>
          </g>

          {/* BLOCK 4: Inverter (DC -> AC) centered at (620, 140) */}
          <g transform="translate(620, 140)">
            <rect
              x="-35"
              y="-35"
              width="70"
              height="70"
              rx="12"
              className={
                inverterActive
                  ? isBatteryMode
                    ? 'fill-slate-900 stroke-amber-500/80'
                    : 'fill-slate-900 stroke-cyan-500/80'
                  : 'fill-slate-950 stroke-slate-800'
              }
              strokeWidth="2"
            />
            {/* Diagonal division line */}
            <line x1="-35" y1="35" x2="35" y2="-35" stroke="#334155" strokeWidth="1.5" />
            {/* DC Symbol = (top-left) */}
            <line
              x1="-22"
              y1="-16"
              x2="-6"
              y2="-16"
              className={
                inverterActive
                  ? isBatteryMode
                    ? 'stroke-amber-400'
                    : 'stroke-cyan-400'
                  : 'stroke-slate-600'
              }
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="-22"
              y1="-10"
              x2="-6"
              y2="-10"
              className={
                inverterActive
                  ? isBatteryMode
                    ? 'stroke-amber-400'
                    : 'stroke-cyan-400'
                  : 'stroke-slate-600'
              }
              strokeWidth="2"
              strokeDasharray="2 2"
            />
            {/* AC Sine wave (bottom-right) */}
            <path
              d="M 6 16 Q 12 10 18 16 Q 24 22 30 16"
              className={
                inverterActive
                  ? isBatteryMode
                    ? 'stroke-amber-400'
                    : 'stroke-cyan-400'
                  : 'stroke-slate-600'
              }
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            <text
              x="0"
              y="48"
              textAnchor="middle"
              className="fill-slate-400 text-[10px] font-medium uppercase tracking-wider"
            >
              Inverter
            </text>
          </g>

          {/* NODE 5: AC Output (830, 140) */}
          <g transform="translate(830, 140)">
            <circle
              cx="0"
              cy="0"
              r="25"
              className={
                outputActive
                  ? isBypass
                    ? 'fill-slate-900 stroke-purple-500'
                    : 'fill-slate-900 stroke-cyan-500'
                  : 'fill-slate-900 stroke-slate-700'
              }
              strokeWidth="2.5"
            />
            {/* Sine wave path inside circle */}
            <path
              d="M -12 0 Q -6 -10 0 0 Q 6 10 12 0"
              className={
                outputActive
                  ? isBypass
                    ? 'stroke-purple-400'
                    : 'stroke-cyan-400'
                  : 'stroke-slate-500'
              }
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <text
              x="0"
              y="38"
              textAnchor="middle"
              className="fill-slate-300 text-[11px] font-semibold tracking-wider uppercase"
            >
              Output
            </text>
          </g>
        </svg>
      </div>

      {/* Modern 3-Column Glassmorphism HUD Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2 pt-3 border-t border-white/[0.06]">
        {/* Card 1: Input Information */}
        <div className="rounded-xl p-3 shadow-inner border border-white/[0.06] bg-black/20">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-2 uppercase tracking-wider">
            <span className="flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Input Stage</span>
            </span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                status.utility_fail
                  ? 'bg-rose-950/80 text-rose-400'
                  : 'bg-emerald-950/80 text-emerald-400'
              }`}
            >
              {status.utility_fail ? 'FAIL' : 'OK'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2 rounded-lg border border-white/[0.05] bg-white/[0.02]">
              <span className="text-slate-500 text-[11px] block">Voltage</span>
              <span className="text-sm font-bold text-slate-200">
                {status.grid_voltage_v.toFixed(1)} <span className="text-slate-500 font-normal">V</span>
              </span>
            </div>
            <div className="p-2 rounded-lg border border-white/[0.05] bg-white/[0.02]">
              <span className="text-slate-500 text-[11px] block">Frequency</span>
              <span className="text-sm font-bold text-slate-200">
                {status.grid_frequency_hz.toFixed(1)} <span className="text-slate-500 font-normal">Hz</span>
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Battery Information */}
        <div className="rounded-xl p-3 shadow-inner border border-white/[0.06] bg-black/20">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-2 uppercase tracking-wider">
            <span className="flex items-center space-x-1.5">
              <Battery className="w-3.5 h-3.5 text-cyan-400" />
              <span>Battery Bank</span>
            </span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                status.battery_low
                  ? 'bg-rose-950/80 text-rose-400'
                  : 'bg-cyan-950/80 text-cyan-400'
              }`}
            >
              {status.battery_low ? 'LOW' : `${status.battery_voltage_v.toFixed(1)} V`}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <div className="p-2 rounded-lg border border-white/[0.05] bg-white/[0.02]">
              <span className="text-slate-500 text-[11px] block">Capacity</span>
              <span className="text-sm font-bold text-cyan-300">{batPct}%</span>
            </div>
            <div className="p-2 rounded-lg border border-white/[0.05] bg-white/[0.02]">
              <span className="text-slate-500 text-[11px] block">Voltage</span>
              <span className="text-sm font-bold text-slate-200">
                {status.battery_voltage_v.toFixed(1)} <span className="text-slate-500 font-normal">V</span>
              </span>
            </div>
            <div className="p-2 rounded-lg border border-white/[0.05] bg-white/[0.02]">
              <span className="text-slate-500 text-[11px] block">Est. Runtime</span>
              <span className="text-sm font-bold text-emerald-400">~{estRuntime}m</span>
            </div>
          </div>
        </div>

        {/* Card 3: Output Information */}
        <div className="rounded-xl p-3 shadow-inner border border-white/[0.06] bg-black/20">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-2 uppercase tracking-wider">
            <span className="flex items-center space-x-1.5">
              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
              <span>Output Load</span>
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 border border-white/[0.06]">
              {effectiveWatts} W • {currentA} A
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-slate-500 text-[11px] block">Voltage</span>
              <span className="text-sm font-bold text-slate-200">
                {status.output_voltage_v.toFixed(1)} <span className="text-slate-500 font-normal">V</span>
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-slate-500 text-[11px] block">Frequency</span>
              <span className="text-sm font-bold text-slate-200">
                {status.output_frequency_hz.toFixed(1)} <span className="text-slate-500 font-normal">Hz</span>
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-slate-500 text-[11px] block">Load Level</span>
              <span
                className={`text-sm font-bold ${
                  status.output_load_pct > 80
                    ? 'text-rose-400'
                    : status.output_load_pct > 60
                    ? 'text-amber-400'
                    : 'text-cyan-400'
                }`}
              >
                {status.output_load_pct}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PowerFlowDiagram = React.memo(PowerFlowDiagramComponent, (prev, next) => {
  return (
    prev.portName === next.portName &&
    prev.status.grid_voltage_v === next.status.grid_voltage_v &&
    prev.status.output_voltage_v === next.status.output_voltage_v &&
    prev.status.grid_frequency_hz === next.status.grid_frequency_hz &&
    prev.status.output_frequency_hz === next.status.output_frequency_hz &&
    prev.status.output_load_pct === next.status.output_load_pct &&
    prev.status.output_watts === next.status.output_watts &&
    prev.status.battery_voltage_v === next.status.battery_voltage_v &&
    prev.status.temperature_c === next.status.temperature_c &&
    prev.status.utility_fail === next.status.utility_fail &&
    prev.status.battery_low === next.status.battery_low &&
    prev.status.bypass_active === next.status.bypass_active &&
    prev.status.ups_failed === next.status.ups_failed &&
    prev.metadata?.battery_voltage === next.metadata?.battery_voltage &&
    prev.metadata?.rated_watts === next.metadata?.rated_watts &&
    prev.metadata?.rated_va === next.metadata?.rated_va &&
    prev.metadata?.battery_capacity_ah === next.metadata?.battery_capacity_ah &&
    prev.metadata?.battery_chemistry === next.metadata?.battery_chemistry &&
    prev.metadata?.topology === next.metadata?.topology
  );
});

