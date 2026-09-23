import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
  RefreshCw,
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
  ReferenceArea,
} from 'recharts';
import { Q1Status, TelemetryRecord, UpsMetadata, EventLogRecord } from '../lib/types';
import { MetricChartCard } from './MetricChartCard';
import {
  calculateActiveWatts,
  calculateBatterySoC,
  calculateEstimatedRuntime,
  detectNominalVoltage,
} from '../lib/battery';
import { detectOutageDetails } from '../lib/outage';
import { api } from '../lib/tauri';
import { DurationPickerModal, CustomDurationRange } from './DurationPickerModal';

interface MetricGraphsHubProps {
  status: Q1Status;
  history: TelemetryRecord[];
  metadata?: UpsMetadata | null;
  events?: EventLogRecord[];
  showOutageHighlights?: boolean;
  portName?: string | null;
}

type ViewMode = 'grid' | 'categories';
type CategoryTab = 'voltage' | 'frequency' | 'power' | 'battery' | 'temperature' | 'runtime';
type GridColsMode = 'auto' | '2' | '3' | '4' | '5';
type GridFilterMode = 'all' | 'grid' | 'power' | 'battery' | 'thermal';

const MetricGraphsHubComponent: React.FC<MetricGraphsHubProps> = ({
  status,
  history,
  metadata,
  events = [],
  showOutageHighlights = true,
  portName,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('categories');
  const [activeCategory, setActiveCategory] = useState<CategoryTab>('voltage');
  const [windowLimit, setWindowLimit] = useState<number>(50);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [frozenHistory, setFrozenHistory] = useState<TelemetryRecord[]>([]);
  const [gridCols, setGridCols] = useState<GridColsMode>('auto');
  const [gridFilter, setGridFilter] = useState<GridFilterMode>('all');

  const [selectedDuration, setSelectedDuration] = useState<'live' | '1h' | '6h' | '24h' | 'custom'>('live');
  const [customRange, setCustomRange] = useState<CustomDurationRange | null>(null);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState<boolean>(false);
  const [rangeHistory, setRangeHistory] = useState<TelemetryRecord[]>([]);
  const [isLoadingRange, setIsLoadingRange] = useState<boolean>(false);

  const fetchRangeData = useCallback(async () => {
    if (!portName || selectedDuration === 'live') return;
    setIsLoadingRange(true);
    try {
      let startIso: string;
      let endIso: string;
      const now = new Date();

      if (selectedDuration === '1h') {
        startIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        endIso = now.toISOString();
      } else if (selectedDuration === '6h') {
        startIso = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
        endIso = now.toISOString();
      } else if (selectedDuration === '24h') {
        startIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        endIso = now.toISOString();
      } else if (selectedDuration === 'custom' && customRange) {
        startIso = customRange.startIso;
        endIso = customRange.endIso;
      } else {
        setIsLoadingRange(false);
        return;
      }

      const records = await api.getTelemetryRange(portName, startIso, endIso, 1500);
      setRangeHistory(records);
    } catch (err) {
      console.error('Failed to query telemetry range for graphs:', err);
    } finally {
      setIsLoadingRange(false);
    }
  }, [portName, selectedDuration, customRange]);

  useEffect(() => {
    if (selectedDuration !== 'live') {
      fetchRangeData();
    }
  }, [selectedDuration, customRange, portName, fetchRangeData]);

  const togglePause = () => {
    if (!isPaused) {
      setFrozenHistory([...history]);
    }
    setIsPaused(!isPaused);
  };

  const activeHistory = selectedDuration === 'live'
    ? (isPaused ? frozenHistory : history)
    : rangeHistory;

  // Sliced data points based on limit
  const visibleHistory = useMemo(() => {
    return selectedDuration === 'live'
      ? activeHistory.slice(-windowLimit)
      : activeHistory;
  }, [selectedDuration, activeHistory, windowLimit]);

  // Check if visible history spans more than 24 hours to format time axis labels cleanly
  const isMultiDay = useMemo(() => {
    if (visibleHistory.length < 2) return false;
    const first = new Date(visibleHistory[0].timestamp).getTime();
    const last = new Date(visibleHistory[visibleHistory.length - 1].timestamp).getTime();
    return Math.abs(last - first) > 24 * 60 * 60 * 1000;
  }, [visibleHistory]);

  // Nominal battery and rated watts calculation
  const nominalBat = metadata?.battery_voltage
    ? Number(metadata.battery_voltage)
    : detectNominalVoltage(status.battery_voltage_v);

  const ratedW =
    metadata?.rated_watts ||
    (metadata?.rated_va
      ? calculateActiveWatts(metadata.rated_va, metadata.power_factor || 0.8)
      : 600);

  // Detect outage intervals and per-sample states
  const { intervals: outageIntervals, isOutageMap } = useMemo(() => {
    const samples = visibleHistory.map((rec) => {
      let timeStr: string;
      if (rec.timestamp.includes('T')) {
        const [dPart, tPart] = rec.timestamp.split('T');
        timeStr = isMultiDay ? `${dPart.slice(5)} ${tPart.slice(0, 5)}` : tPart.slice(0, 8);
      } else {
        timeStr = rec.timestamp.slice(-8);
      }
      return {
        time: timeStr,
        grid_voltage: rec.grid_voltage,
        rawTimestamp: rec.timestamp,
      };
    });
    return detectOutageDetails(samples, events, status.utility_fail);
  }, [visibleHistory, events, status.utility_fail, isMultiDay]);

  // Map history records into clean data points for all 10 metrics
  const telemetryData = useMemo(() => {
    return visibleHistory.map((rec, idx) => {
      let timeStr: string;
      if (rec.timestamp.includes('T')) {
        const [dPart, tPart] = rec.timestamp.split('T');
        timeStr = isMultiDay ? `${dPart.slice(5)} ${tPart.slice(0, 5)}` : tPart.slice(0, 8);
      } else {
        timeStr = rec.timestamp.slice(-8);
      }

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
        isOutage: isOutageMap[idx] ?? false,
      };
    });
  }, [visibleHistory, nominalBat, ratedW, metadata, status.grid_frequency_hz, status.output_frequency_hz, isOutageMap]);

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

  // Transform data series for individual charts (memoized to prevent allocating new objects every render)
  const {
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
    voltageCombined,
    frequencyCombined,
  } = useMemo(() => {
    return {
      gridVData: telemetryData.map((d) => ({ time: d.time, value: d.grid_voltage, isOutage: d.isOutage })),
      outVData: telemetryData.map((d) => ({ time: d.time, value: d.output_voltage, isOutage: d.isOutage })),
      gridFData: telemetryData.map((d) => ({ time: d.time, value: d.grid_frequency, isOutage: d.isOutage })),
      outFData: telemetryData.map((d) => ({ time: d.time, value: d.output_frequency, isOutage: d.isOutage })),
      loadData: telemetryData.map((d) => ({ time: d.time, value: d.load_pct, isOutage: d.isOutage })),
      wattsData: telemetryData.map((d) => ({ time: d.time, value: d.output_watts, isOutage: d.isOutage })),
      batVData: telemetryData.map((d) => ({ time: d.time, value: d.battery_voltage, isOutage: d.isOutage })),
      batSocData: telemetryData.map((d) => ({ time: d.time, value: d.battery_soc, isOutage: d.isOutage })),
      tempData: telemetryData.map((d) => ({ time: d.time, value: d.temperature_c, isOutage: d.isOutage })),
      runtimeData: telemetryData.map((d) => ({ time: d.time, value: d.runtime_mins, isOutage: d.isOutage })),
      voltageCombined: telemetryData.map((d) => ({
        time: d.time,
        value: d.grid_voltage,
        value2: d.output_voltage,
        isOutage: d.isOutage,
      })),
      frequencyCombined: telemetryData.map((d) => ({
        time: d.time,
        value: d.grid_frequency,
        value2: d.output_frequency,
        isOutage: d.isOutage,
      })),
    };
  }, [telemetryData]);

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

  const cardDefinitions = useMemo(
    () => [
      { id: 'grid-v', category: 'grid' as const },
      { id: 'out-v', category: 'power' as const },
      { id: 'grid-f', category: 'grid' as const },
      { id: 'out-f', category: 'power' as const },
      { id: 'load', category: 'power' as const },
      { id: 'watts', category: 'power' as const },
      { id: 'bat-v', category: 'battery' as const },
      { id: 'bat-soc', category: 'battery' as const },
      { id: 'temp', category: 'thermal' as const },
      { id: 'runtime', category: 'battery' as const },
    ],
    []
  );

  const filteredCardIds = useMemo(() => {
    if (gridFilter === 'all') return cardDefinitions.map((c) => c.id);
    return cardDefinitions.filter((c) => c.category === gridFilter).map((c) => c.id);
  }, [cardDefinitions, gridFilter]);

  const renderGridCard = (id: string) => {
    switch (id) {
      case 'grid-v':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'out-v':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'grid-f':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'out-f':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'load':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'watts':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'bat-v':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'bat-soc':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'temp':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      case 'runtime':
        return (
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
            outageIntervals={outageIntervals}
            showOutageHighlights={showOutageHighlights}
          />
        );
      default:
        return null;
    }
  };


  return (
    <div
      className="rounded-2xl p-3.5 sm:p-5 shadow-sm space-y-4 min-w-0 border"
      style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      {/* Top Header & Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
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
          {/* Duration Selector */}
          <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-xl p-0.5">
            <button
              onClick={() => setSelectedDuration('live')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                selectedDuration === 'live'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Live
            </button>
            {(['1h', '6h', '24h'] as const).map((dur) => (
              <button
                key={dur}
                onClick={() => setSelectedDuration(dur)}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  selectedDuration === dur
                    ? 'bg-cyan-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {dur}
              </button>
            ))}
            <button
              onClick={() => setIsCustomModalOpen(true)}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                selectedDuration === 'custom'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {selectedDuration === 'custom' && customRange ? customRange.label : 'Custom...'}
            </button>
          </div>

          {/* If Live: show Points limit selector and Pause button */}
          {selectedDuration === 'live' ? (
            <>
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
            </>
          ) : (
            <button
              onClick={fetchRangeData}
              disabled={isLoadingRange}
              className="p-1.5 rounded-xl border bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              title="Refresh time range"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRange ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          )}

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
          <div className="flex items-center gap-1.5 pb-1.5 overflow-x-auto scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-nowrap -mx-1 px-1">
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
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const isOutage = payload[0]?.payload?.isOutage;
                        return (
                          <div
                            className="rounded-xl p-2.5 shadow-lg border text-xs"
                            style={{
                              backgroundColor: '#0f172a',
                              borderColor: isOutage ? 'rgba(239, 68, 68, 0.4)' : '#334155',
                              color: '#f8fafc',
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] text-slate-400 font-mono">{label}</span>
                              {isOutage && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60">
                                  Power Outage (Battery Mode)
                                </span>
                              )}
                            </div>
                            {payload.map((item, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                                <span style={{ color: item.color }}>{item.name}:</span>
                                <span className="font-semibold text-slate-100">
                                  {item.value} V
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    {showOutageHighlights &&
                      outageIntervals.map((interval, idx) => (
                        <ReferenceArea
                          key={`outage-v-${idx}`}
                          x1={interval.start}
                          x2={interval.end}
                          fill="#ef4444"
                          fillOpacity={0.16}
                          stroke="#ef4444"
                          strokeOpacity={0.35}
                          strokeDasharray="3 3"
                          ifOverflow="extendDomain"
                          label={{
                            value: interval.isActive ? 'Outage (Active)' : 'Power Outage',
                            position: 'insideTop',
                            fill: '#f87171',
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        />
                      ))}
                    <Area
                      type="monotone"
                      dataKey="value"
                      name="Input Grid Voltage"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fill="url(#gridVGrad)"
                      unit="V"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="value2"
                      name="Output Voltage"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#outVGrad)"
                      unit="V"
                      isAnimationActive={false}
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
                  outageIntervals={outageIntervals}
                  showOutageHighlights={showOutageHighlights}
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
                  outageIntervals={outageIntervals}
                  showOutageHighlights={showOutageHighlights}
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
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const isOutage = payload[0]?.payload?.isOutage;
                        return (
                          <div
                            className="rounded-xl p-2.5 shadow-lg border text-xs"
                            style={{
                              backgroundColor: '#0f172a',
                              borderColor: isOutage ? 'rgba(239, 68, 68, 0.4)' : '#334155',
                              color: '#f8fafc',
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] text-slate-400 font-mono">{label}</span>
                              {isOutage && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60">
                                  Power Outage (Battery Mode)
                                </span>
                              )}
                            </div>
                            {payload.map((item, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                                <span style={{ color: item.color }}>{item.name}:</span>
                                <span className="font-semibold text-slate-100">
                                  {item.value} Hz
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    {showOutageHighlights &&
                      outageIntervals.map((interval, idx) => (
                        <ReferenceArea
                          key={`outage-f-${idx}`}
                          x1={interval.start}
                          x2={interval.end}
                          fill="#ef4444"
                          fillOpacity={0.16}
                          stroke="#ef4444"
                          strokeOpacity={0.35}
                          strokeDasharray="3 3"
                          ifOverflow="extendDomain"
                          label={{
                            value: interval.isActive ? 'Outage (Active)' : 'Power Outage',
                            position: 'insideTop',
                            fill: '#f87171',
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        />
                      ))}
                    <Area
                      type="monotone"
                      dataKey="value"
                      name="Input Grid Frequency"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      fill="url(#gridFGrad)"
                      unit="Hz"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="value2"
                      name="Output Frequency"
                      stroke="#818cf8"
                      strokeWidth={2}
                      fill="url(#outFGrad)"
                      unit="Hz"
                      isAnimationActive={false}
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
                  outageIntervals={outageIntervals}
                  showOutageHighlights={showOutageHighlights}
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
                  outageIntervals={outageIntervals}
                  showOutageHighlights={showOutageHighlights}
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
                  outageIntervals={outageIntervals}
                  showOutageHighlights={showOutageHighlights}
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
                  outageIntervals={outageIntervals}
                  showOutageHighlights={showOutageHighlights}
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
                  outageIntervals={outageIntervals}
                  showOutageHighlights={showOutageHighlights}
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
                  outageIntervals={outageIntervals}
                  showOutageHighlights={showOutageHighlights}
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
                outageIntervals={outageIntervals}
                showOutageHighlights={showOutageHighlights}
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
                outageIntervals={outageIntervals}
                showOutageHighlights={showOutageHighlights}
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
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5 max-w-full">
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
            {filteredCardIds.map((id) => renderGridCard(id))}
          </div>
        </div>
      )}

      {/* Custom Duration Range Picker Modal */}
      <DurationPickerModal
        isOpen={isCustomModalOpen}
        onClose={() => setIsCustomModalOpen(false)}
        onApply={(range) => {
          setCustomRange(range);
          setSelectedDuration('custom');
          setIsCustomModalOpen(false);
        }}
      />
    </div>
  );
};

export const MetricGraphsHub = React.memo(MetricGraphsHubComponent);
