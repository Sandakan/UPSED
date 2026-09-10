import React, { useState, useMemo } from 'react';
import {
  Zap,
  Activity,
  Battery,
  Thermometer,
  Clock,
  Gauge,
  LayoutGrid,
  Columns2,
  Pause,
  Play,
  TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Q1Status, TelemetryRecord, UpsMetadata } from '../lib/types';
import { MetricChartCard, MetricDataPoint } from './MetricChartCard';
import {
  calculateActiveWatts,
  calculateBatterySoC,
  calculateEstimatedRuntime,
  detectNominalVoltage,
} from '../lib/battery';

interface MetricGraphsHubProps {
  status: Q1Status;
  history: TelemetryRecord[];
  metadata?: UpsMetadata | null;
}

type ViewMode = 'grid' | 'categories';
type CategoryTab = 'voltage' | 'frequency' | 'power' | 'battery' | 'temperature' | 'runtime';
type GridColsMode = 'auto' | '2' | '3' | '4' | '5';
type GridFilterMode = 'all' | 'grid' | 'power' | 'battery' | 'thermal';

export const MetricGraphsHub: React.FC<MetricGraphsHubProps> = ({
  status,
  history,
  metadata,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('categories');
  const [activeCategory, setActiveCategory] = useState<CategoryTab>('voltage');
  const [windowLimit, setWindowLimit] = useState<number>(50);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [frozenHistory, setFrozenHistory] = useState<TelemetryRecord[]>([]);
  const [gridCols, setGridCols] = useState<GridColsMode>('auto');
  const [gridFilter, setGridFilter] = useState<GridFilterMode>('all');

  const togglePause = () => {
    if (!isPaused) {
      setFrozenHistory([...history]);
    }
    setIsPaused(!isPaused);
  };

  const activeHistory = isPaused ? frozenHistory : history;

  // Sliced data points based on limit
  const visibleHistory = useMemo(() => {
    return activeHistory.slice(-windowLimit);
  }, [activeHistory, windowLimit]);

  // Nominal battery and rated watts calculation
  const nominalBat = metadata?.battery_voltage
    ? Number(metadata.battery_voltage)
    : detectNominalVoltage(status.battery_voltage_v);

  const ratedW =
    metadata?.rated_watts ||
    (metadata?.rated_va
      ? calculateActiveWatts(metadata.rated_va, metadata.power_factor || 0.8)
      : 600);

  // Map history records into clean data points for all 10 metrics
  const telemetryData = useMemo(() => {
    return visibleHistory.map((rec) => {
      const timeStr = rec.timestamp.includes('T')
        ? rec.timestamp.split('T')[1].slice(0, 8)
        : rec.timestamp.slice(-8);

      const batPct = calculateBatterySoC(
        rec.battery_voltage,
        nominalBat,
        metadata?.battery_chemistry ?? 'VRLA_SLA'
      );

      const watts =
        rec.output_watts && rec.output_watts > 0
          ? rec.output_watts
          : Math.round((rec.load_pct / 100) * ratedW);

      const runtimeMins = calculateEstimatedRuntime(
        batPct,
        nominalBat,
        metadata?.battery_capacity_ah ?? 9.0,
        watts,
        metadata?.topology ?? 'Online',
        metadata?.battery_chemistry ?? 'VRLA_SLA'
      );

      return {
        time: timeStr,
        grid_voltage: Number(rec.grid_voltage.toFixed(1)),
        output_voltage: Number(rec.output_voltage.toFixed(1)),
        grid_frequency: Number((rec.grid_frequency ?? status.grid_frequency_hz).toFixed(1)),
        output_frequency: Number((rec.output_frequency ?? status.output_frequency_hz).toFixed(1)),
        load_pct: rec.load_pct,
        output_watts: watts,
        battery_voltage: Number(rec.battery_voltage.toFixed(1)),
        battery_soc: batPct,
        temperature_c: rec.temperature_c,
        runtime_mins: runtimeMins,
      };
    });
  }, [visibleHistory, nominalBat, ratedW, metadata, status.grid_frequency_hz, status.output_frequency_hz]);

  // Current calculated metrics
  const currentBatPct = calculateBatterySoC(
    status.battery_voltage_v,
    nominalBat,
    metadata?.battery_chemistry ?? 'VRLA_SLA'
  );
  const currentWatts =
    status.output_watts > 0
      ? status.output_watts
      : Math.round((status.output_load_pct / 100) * ratedW);

  const currentRuntime = calculateEstimatedRuntime(
    currentBatPct,
    nominalBat,
    metadata?.battery_capacity_ah ?? 9.0,
    currentWatts,
    metadata?.topology ?? 'Online',
    metadata?.battery_chemistry ?? 'VRLA_SLA'
  );

  // Transform data series for individual charts
  const gridVData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.grid_voltage }));
  const outVData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.output_voltage }));
  const gridFData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.grid_frequency }));
  const outFData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.output_frequency }));
  const loadData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.load_pct }));
  const wattsData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.output_watts }));
  const batVData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.battery_voltage }));
  const batSocData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.battery_soc }));
  const tempData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.temperature_c }));
  const runtimeData: MetricDataPoint[] = telemetryData.map((d) => ({ time: d.time, value: d.runtime_mins }));

  // Combined category data
  const voltageCombined = telemetryData.map((d) => ({
    time: d.time,
    value: d.grid_voltage,
    value2: d.output_voltage,
  }));

  const frequencyCombined = telemetryData.map((d) => ({
    time: d.time,
    value: d.grid_frequency,
    value2: d.output_frequency,
  }));

  const gridColsClass = useMemo(() => {
    switch (gridCols) {
      case '2':
        return 'grid-cols-1 md:grid-cols-2';
      case '3':
        return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';
      case '4':
        return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4';
      case '5':
        return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';
      default:
        return '';
    }
  }, [gridCols]);

  const allCards = useMemo(
    () => [
      {
        id: 'grid-v',
        category: 'grid' as const,
        component: (
          <MetricChartCard
            key="grid-v"
            title="Input Grid Voltage"
            icon={<Zap className="w-4 h-4 text-amber-400" />}
            currentValue={status.grid_voltage_v.toFixed(1)}
            unit="V"
            data={gridVData}
            color="#f59e0b"
            name1="Grid V"
            gradientId="all-grid-v"
            height={150}
          />
        ),
      },
      {
        id: 'out-v',
        category: 'power' as const,
        component: (
          <MetricChartCard
            key="out-v"
            title="Output Voltage"
            icon={<Zap className="w-4 h-4 text-blue-400" />}
            currentValue={status.output_voltage_v.toFixed(1)}
            unit="V"
            data={outVData}
            color="#3b82f6"
            name1="Output V"
            gradientId="all-out-v"
            height={150}
          />
        ),
      },
      {
        id: 'grid-f',
        category: 'grid' as const,
        component: (
          <MetricChartCard
            key="grid-f"
            title="Input Frequency"
            icon={<Activity className="w-4 h-4 text-cyan-400" />}
            currentValue={status.grid_frequency_hz.toFixed(1)}
            unit="Hz"
            data={gridFData}
            color="#06b6d4"
            name1="Input Hz"
            gradientId="all-grid-f"
            height={150}
          />
        ),
      },
      {
        id: 'out-f',
        category: 'power' as const,
        component: (
          <MetricChartCard
            key="out-f"
            title="Output Frequency"
            icon={<Activity className="w-4 h-4 text-indigo-400" />}
            currentValue={status.output_frequency_hz.toFixed(1)}
            unit="Hz"
            data={outFData}
            color="#818cf8"
            name1="Output Hz"
            gradientId="all-out-f"
            height={150}
          />
        ),
      },
      {
        id: 'load',
        category: 'power' as const,
        component: (
          <MetricChartCard
            key="load"
            title="Output Load"
            icon={<Gauge className="w-4 h-4 text-cyan-400" />}
            currentValue={status.output_load_pct}
            unit="%"
            data={loadData}
            color="#06b6d4"
            name1="Load %"
            domain={[0, 100]}
            gradientId="all-load"
            height={150}
          />
        ),
      },
      {
        id: 'watts',
        category: 'power' as const,
        component: (
          <MetricChartCard
            key="watts"
            title="Active Power"
            icon={<Zap className="w-4 h-4 text-emerald-400" />}
            currentValue={currentWatts}
            unit="W"
            data={wattsData}
            color="#10b981"
            name1="Watts"
            gradientId="all-watts"
            height={150}
          />
        ),
      },
      {
        id: 'bat-v',
        category: 'battery' as const,
        component: (
          <MetricChartCard
            key="bat-v"
            title="Battery Voltage"
            icon={<Battery className="w-4 h-4 text-teal-400" />}
            currentValue={status.battery_voltage_v.toFixed(1)}
            unit="V"
            data={batVData}
            color="#14b8a6"
            name1="Battery V"
            gradientId="all-bat-v"
            height={150}
          />
        ),
      },
      {
        id: 'bat-soc',
        category: 'battery' as const,
        component: (
          <MetricChartCard
            key="bat-soc"
            title="Battery Capacity"
            icon={<Battery className="w-4 h-4 text-emerald-400" />}
            currentValue={currentBatPct}
            unit="%"
            data={batSocData}
            color="#10b981"
            name1="SoC %"
            domain={[0, 100]}
            gradientId="all-bat-soc"
            height={150}
          />
        ),
      },
      {
        id: 'temp',
        category: 'thermal' as const,
        component: (
          <MetricChartCard
            key="temp"
            title="Temperature"
            icon={<Thermometer className="w-4 h-4 text-orange-400" />}
            currentValue={status.temperature_c}
            unit="°C"
            data={tempData}
            color="#f97316"
            name1="Temp °C"
            gradientId="all-temp"
            height={150}
          />
        ),
      },
      {
        id: 'runtime',
        category: 'battery' as const,
        component: (
          <MetricChartCard
            key="runtime"
            title="Est. Runtime"
            icon={<Clock className="w-4 h-4 text-purple-400" />}
            currentValue={currentRuntime}
            unit="mins"
            data={runtimeData}
            color="#a855f7"
            name1="Runtime"
            gradientId="all-runtime"
            height={150}
          />
        ),
      },
    ],
    [
      status.grid_voltage_v,
      status.output_voltage_v,
      status.grid_frequency_hz,
      status.output_frequency_hz,
      status.output_load_pct,
      status.battery_voltage_v,
      status.temperature_c,
      currentWatts,
      currentBatPct,
      currentRuntime,
      gridVData,
      outVData,
      gridFData,
      outFData,
      loadData,
      wattsData,
      batVData,
      batSocData,
      tempData,
      runtimeData,
    ]
  );

  const filteredCards = useMemo(() => {
    if (gridFilter === 'all') return allCards;
    return allCards.filter((card) => card.category === gridFilter);
  }, [allCards, gridFilter]);


  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 sm:p-5 shadow-sm space-y-4 min-w-0">
      {/* Top Header & Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-cyan-950/60 border border-cyan-800/40 text-cyan-400 shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-semibold text-slate-100 truncate">UPS Metric Graphs</h3>
            <p className="text-xs text-slate-400 truncate">Real-time telemetry and hardware sensor trends</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Points limit selector */}
          <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-xl p-0.5">
            {[20, 50, 100].map((lim) => (
              <button
                key={lim}
                onClick={() => setWindowLimit(lim)}
                className={`px-2.5 py-1 rounded-lg font-mono font-medium transition ${
                  windowLimit === lim
                    ? 'bg-slate-800 text-cyan-400 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lim} pts
              </button>
            ))}
          </div>

          {/* Pause / Resume Button */}
          <button
            onClick={togglePause}
            className={`px-2.5 py-1 rounded-xl border font-medium flex items-center space-x-1.5 transition ${
              isPaused
                ? 'bg-amber-950/40 border-amber-700/60 text-amber-300 hover:bg-amber-950/60'
                : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
            title={isPaused ? 'Resume live graph stream' : 'Pause live stream to inspect data'}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 text-amber-400" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{isPaused ? 'Paused' : 'Live'}</span>
          </button>

          {/* Mode Switcher: Category View vs All Grid */}
          <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-xl p-0.5">
            <button
              onClick={() => setViewMode('categories')}
              className={`px-2.5 sm:px-3 py-1 rounded-lg font-medium flex items-center space-x-1.5 transition ${
                viewMode === 'categories'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Categories</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2.5 sm:px-3 py-1 rounded-lg font-medium flex items-center space-x-1.5 transition ${
                viewMode === 'grid'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>All (10)</span>
            </button>
          </div>
        </div>
      </div>

      {/* VIEW MODE 1: CATEGORY TABS & DETAILED COMPARISONS */}
      {viewMode === 'categories' && (
        <div className="space-y-4 min-w-0">
          {/* Category Tabs Pill Bar with horizontal scrolling */}
          <div className="flex items-center gap-1.5 pb-1.5 overflow-x-auto no-scrollbar flex-nowrap -mx-1 px-1">
            {[
              { id: 'voltage', label: 'Voltage (Grid vs Out)', icon: Zap },
              { id: 'frequency', label: 'Frequency (Hz)', icon: Activity },
              { id: 'power', label: 'Load & Active Watts', icon: Gauge },
              { id: 'battery', label: 'Battery (V & SoC%)', icon: Battery },
              { id: 'temperature', label: 'Temperature (°C)', icon: Thermometer },
              { id: 'runtime', label: 'Estimated Runtime', icon: Clock },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveCategory(tab.id as CategoryTab)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center space-x-2 transition shrink-0 whitespace-nowrap ${
                    isActive
                      ? 'bg-cyan-950/70 border-cyan-500/60 text-cyan-300 shadow-sm'
                      : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Category Detailed View */}
          {activeCategory === 'voltage' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono px-1">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-slate-300">Input Grid: {status.grid_voltage_v.toFixed(1)}V</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span className="text-slate-300">Output Line: {status.output_voltage_v.toFixed(1)}V</span>
                  </div>
                </div>
                <span className="text-slate-400">
                  Regulation Delta: {Math.abs(status.grid_voltage_v - status.output_voltage_v).toFixed(1)}V
                </span>
              </div>

              <div className="h-60 sm:h-72 w-full bg-slate-950/60 rounded-xl p-2 sm:p-3 border border-slate-800 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={voltageCombined}>
                    <defs>
                      <linearGradient id="gridVGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="outVGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="time" stroke="#64748b" fontSize={11} minTickGap={25} />
                    <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} unit="V" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                      }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="value"
                      name="Input Grid Voltage"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fill="url(#gridVGrad)"
                      unit="V"
                    />
                    <Area
                      type="monotone"
                      dataKey="value2"
                      name="Output Voltage"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#outVGrad)"
                      unit="V"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Mini Individual Split Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <MetricChartCard
                  title="Input Grid Voltage"
                  icon={<Zap className="w-4 h-4 text-amber-400" />}
                  currentValue={status.grid_voltage_v.toFixed(1)}
                  unit="V"
                  data={gridVData}
                  color="#f59e0b"
                  name1="Grid Voltage"
                  gradientId="card-grid-v"
                  height={130}
                />
                <MetricChartCard
                  title="Output Voltage"
                  icon={<Zap className="w-4 h-4 text-blue-400" />}
                  currentValue={status.output_voltage_v.toFixed(1)}
                  unit="V"
                  data={outVData}
                  color="#3b82f6"
                  name1="Output Voltage"
                  gradientId="card-out-v"
                  height={130}
                />
              </div>
            </div>
          )}

          {activeCategory === 'frequency' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono px-1">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                    <span className="text-slate-300">Input Frequency: {status.grid_frequency_hz.toFixed(1)}Hz</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
                    <span className="text-slate-300">Output Frequency: {status.output_frequency_hz.toFixed(1)}Hz</span>
                  </div>
                </div>
                <span className="text-emerald-400 font-semibold">Frequency Synchronized</span>
              </div>

              <div className="h-60 sm:h-72 w-full bg-slate-950/60 rounded-xl p-2 sm:p-3 border border-slate-800 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={frequencyCombined}>
                    <defs>
                      <linearGradient id="gridFGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="outFGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="time" stroke="#64748b" fontSize={11} minTickGap={25} />
                    <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} unit="Hz" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                      }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="value"
                      name="Input Grid Frequency"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      fill="url(#gridFGrad)"
                      unit="Hz"
                    />
                    <Area
                      type="monotone"
                      dataKey="value2"
                      name="Output Frequency"
                      stroke="#818cf8"
                      strokeWidth={2}
                      fill="url(#outFGrad)"
                      unit="Hz"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <MetricChartCard
                  title="Input Grid Frequency"
                  icon={<Activity className="w-4 h-4 text-cyan-400" />}
                  currentValue={status.grid_frequency_hz.toFixed(1)}
                  unit="Hz"
                  data={gridFData}
                  color="#06b6d4"
                  name1="Grid Hz"
                  gradientId="card-grid-f"
                  height={130}
                />
                <MetricChartCard
                  title="Output Frequency"
                  icon={<Activity className="w-4 h-4 text-indigo-400" />}
                  currentValue={status.output_frequency_hz.toFixed(1)}
                  unit="Hz"
                  data={outFData}
                  color="#818cf8"
                  name1="Output Hz"
                  gradientId="card-out-f"
                  height={130}
                />
              </div>
            </div>
          )}

          {activeCategory === 'power' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono px-1">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                    <span className="text-slate-300">Load: {status.output_load_pct}%</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <span className="text-slate-300">Active Power: {currentWatts}W</span>
                  </div>
                </div>
                <span className="text-slate-400 font-sans">
                  Rated capacity: {ratedW}W ({metadata?.rated_va || 1000}VA)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <MetricChartCard
                  title="Output Load"
                  icon={<Gauge className="w-4 h-4 text-cyan-400" />}
                  currentValue={status.output_load_pct}
                  unit="%"
                  data={loadData}
                  color="#06b6d4"
                  name1="Load %"
                  domain={[0, 100]}
                  gradientId="card-load"
                  height={220}
                />
                <MetricChartCard
                  title="Active Output Power"
                  icon={<Zap className="w-4 h-4 text-emerald-400" />}
                  currentValue={currentWatts}
                  unit="W"
                  data={wattsData}
                  color="#10b981"
                  name1="Active Watts"
                  gradientId="card-watts"
                  height={220}
                />
              </div>
            </div>
          )}

          {activeCategory === 'battery' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono px-1">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <span className="text-slate-300">State of Charge: {currentBatPct}%</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-teal-400" />
                    <span className="text-slate-300">Bus Terminal: {status.battery_voltage_v.toFixed(1)}V</span>
                  </div>
                </div>
                <span className="text-slate-400 font-sans">
                  Chemistry: {metadata?.battery_chemistry ?? 'VRLA/SLA'} • Nominal: {nominalBat}V
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <MetricChartCard
                  title="Battery State of Charge (SoC)"
                  icon={<Battery className="w-4 h-4 text-emerald-400" />}
                  currentValue={currentBatPct}
                  unit="%"
                  data={batSocData}
                  color="#10b981"
                  name1="SoC %"
                  domain={[0, 100]}
                  gradientId="card-bat-soc"
                  height={220}
                />
                <MetricChartCard
                  title="Battery Bus Voltage"
                  icon={<Battery className="w-4 h-4 text-teal-400" />}
                  currentValue={status.battery_voltage_v.toFixed(1)}
                  unit="V"
                  data={batVData}
                  color="#14b8a6"
                  name1="Battery Voltage"
                  gradientId="card-bat-v"
                  height={220}
                />
              </div>
            </div>
          )}

          {activeCategory === 'temperature' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono px-1">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-400" />
                  <span className="text-slate-300">Inverter / Heatsink: {status.temperature_c}°C</span>
                </div>
                <span className={status.temperature_c > 50 ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                  {status.temperature_c > 50 ? 'Thermal Warning' : 'Nominal Range'}
                </span>
              </div>

              <MetricChartCard
                title="UPS Internal Temperature"
                icon={<Thermometer className="w-4 h-4 text-orange-400" />}
                currentValue={status.temperature_c}
                unit="°C"
                data={tempData}
                color="#f97316"
                name1="Temperature"
                domain={[0, 70]}
                gradientId="card-temp"
                height={260}
              />
            </div>
          )}

          {activeCategory === 'runtime' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono px-1">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
                  <span className="text-slate-300">Estimated Backup Time: ~{currentRuntime} mins</span>
                </div>
                <span className="text-slate-400 font-sans">
                  Based on {metadata?.battery_capacity_ah || 9}Ah capacity @ {currentWatts}W draw
                </span>
              </div>

              <MetricChartCard
                title="Estimated Battery Runtime"
                icon={<Clock className="w-4 h-4 text-purple-400" />}
                currentValue={currentRuntime}
                unit="mins"
                data={runtimeData}
                color="#a855f7"
                name1="Runtime"
                gradientId="card-runtime"
                height={260}
              />
            </div>
          )}
        </div>
      )}

      {/* VIEW MODE 2: ALL 10 METRICS GRID */}
      {viewMode === 'grid' && (
        <div className="space-y-3 min-w-0">
          {/* Sub-toolbar for Grid view: Filter pills & Column preference */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5 pb-1 text-xs">
            {/* Category filter pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 max-w-full">
              {[
                { id: 'all', label: 'All', count: 10 },
                { id: 'grid', label: 'Grid', count: 2 },
                { id: 'power', label: 'Power & Load', count: 4 },
                { id: 'battery', label: 'Battery', count: 3 },
                { id: 'thermal', label: 'Thermal', count: 1 },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setGridFilter(f.id as GridFilterMode)}
                  className={`px-2.5 py-1 rounded-xl border text-xs font-medium transition shrink-0 ${
                    gridFilter === f.id
                      ? 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300 shadow-sm'
                      : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {f.label} <span className="opacity-60 text-[10px]">({f.count})</span>
                </button>
              ))}
            </div>

            {/* Column selector */}
            <div className="flex items-center space-x-1.5 shrink-0 ml-auto">
              <span className="text-[11px] text-slate-400 hidden sm:inline">Columns:</span>
              <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-xl p-0.5">
                {(['auto', '2', '3', '4', '5'] as GridColsMode[]).map((col) => (
                  <button
                    key={col}
                    onClick={() => setGridCols(col)}
                    className={`px-2 py-0.5 rounded-lg text-xs font-mono font-medium transition ${
                      gridCols === col
                        ? 'bg-slate-800 text-cyan-400 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title={col === 'auto' ? 'Fluid Auto-Fit (min 480px)' : `Fixed ${col} Columns`}
                  >
                    {col === 'auto' ? 'Auto' : `${col} Col`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Responsive Grid Container */}
          <div
            className={`grid gap-3.5 min-w-0 ${gridCols !== 'auto' ? gridColsClass : ''}`}
            style={
              gridCols === 'auto'
                ? {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 480px), 1fr))',
                  }
                : undefined
            }
          >
            {filteredCards.map((c) => c.component)}
          </div>
        </div>
      )}
    </div>
  );
};
