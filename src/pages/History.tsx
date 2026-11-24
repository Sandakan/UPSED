import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  RefreshCw,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Search,
  Table,
  Activity,
  Clock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
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
import { EventLogRecord, TelemetryRecord } from '../lib/types';
import { detectOutageDetails, deriveVisibleOutageIntervals } from '../lib/outage';
import { detectDataGaps, injectGapAnchorPoints, deriveVisibleDataGaps, formatGapDuration } from '../lib/dataGaps';
import {
  formatTableTimestamp,
  formatChartAxisTimestamp,
  formatChartTooltipTimestamp,
  formatLocalCsvTimestamp,
} from '../lib/time';
import { api } from '../lib/tauri';
import { DurationPickerModal, CustomDurationRange } from '../components/DurationPickerModal';
import { useChartZoom } from '../lib/useChartZoom';
import { ChartZoomBadge } from '../components/ChartZoomBadge';
import { OutageReferenceArea } from '../components/OutageReferenceArea';
import { DataGapReferenceArea } from '../components/DataGapReferenceArea';

export type HistoryDuration = '1h' | '6h' | '24h' | '7d' | '30d' | 'all' | 'custom';

interface HistoryProps {
  telemetry: TelemetryRecord[];
  events: EventLogRecord[];
  onRefresh: () => void;
  isRefreshing: boolean;
  showOutageHighlights?: boolean;
  portName?: string | null;
  upsId?: string | null;
  downsamplingMaxPoints?: number;
}

const PAGE_SIZE = 12;

export const History: React.FC<HistoryProps> = ({
  telemetry,
  events,
  onRefresh,
  isRefreshing,
  showOutageHighlights = true,
  portName,
  upsId,
  downsamplingMaxPoints = 5000,
}) => {
  const { t } = useTranslation(['history', 'common']);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'events' | 'charts'>('telemetry');
  const [chartMetric, setChartMetric] = useState<'voltage' | 'frequency' | 'power' | 'battery' | 'temperature'>('voltage');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Sorting state - defaults to latest records on top (descending)
  type TelemetrySortField =
    | 'id'
    | 'timestamp'
    | 'ups_id'
    | 'grid_voltage'
    | 'grid_frequency'
    | 'output_voltage'
    | 'output_frequency'
    | 'load_pct'
    | 'output_watts'
    | 'battery_voltage'
    | 'temperature_c';

  type EventSortField = 'id' | 'timestamp' | 'ups_id' | 'event_type' | 'message';
  type SortDirection = 'asc' | 'desc';

  const [telemetrySortField, setTelemetrySortField] = useState<TelemetrySortField>('timestamp');
  const [telemetrySortDirection, setTelemetrySortDirection] = useState<SortDirection>('desc');
  const [eventSortField, setEventSortField] = useState<EventSortField>('timestamp');
  const [eventSortDirection, setEventSortDirection] = useState<SortDirection>('desc');
  const [eventFilterType, setEventFilterType] = useState<'all' | 'user' | 'system'>('all');

  const handleTelemetrySort = (field: TelemetrySortField) => {
    if (telemetrySortField === field) {
      setTelemetrySortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setTelemetrySortField(field);
      setTelemetrySortDirection('desc');
    }
    setCurrentPage(1);
  };

  const handleEventSort = (field: EventSortField) => {
    if (eventSortField === field) {
      setEventSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setEventSortField(field);
      setEventSortDirection('desc');
    }
    setCurrentPage(1);
  };

  const renderTelemetrySortIcon = (field: TelemetrySortField) => {
    if (telemetrySortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-500 opacity-40 group-hover:opacity-100 transition" />;
    }
    return telemetrySortDirection === 'desc' ? (
      <ArrowDown className="w-3 h-3 text-emerald-400" />
    ) : (
      <ArrowUp className="w-3 h-3 text-emerald-400" />
    );
  };

  const renderEventSortIcon = (field: EventSortField) => {
    if (eventSortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-500 opacity-40 group-hover:opacity-100 transition" />;
    }
    return eventSortDirection === 'desc' ? (
      <ArrowDown className="w-3 h-3 text-emerald-400" />
    ) : (
      <ArrowUp className="w-3 h-3 text-emerald-400" />
    );
  };

  // Duration filtering state
  const [selectedDuration, setSelectedDuration] = useState<HistoryDuration>('24h');
  const [customRange, setCustomRange] = useState<CustomDurationRange | null>(null);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState<boolean>(false);
  const [loadedTelemetry, setLoadedTelemetry] = useState<TelemetryRecord[]>([]);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState<boolean>(false);

  const activeTimeRange = useMemo(() => {
    if (selectedDuration === 'all') return null;
    const now = new Date();
    if (selectedDuration === '1h') {
      return { startIso: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), endIso: now.toISOString() };
    }
    if (selectedDuration === '6h') {
      return { startIso: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(), endIso: now.toISOString() };
    }
    if (selectedDuration === '24h') {
      return { startIso: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), endIso: now.toISOString() };
    }
    if (selectedDuration === '7d') {
      return { startIso: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), endIso: now.toISOString() };
    }
    if (selectedDuration === '30d') {
      return { startIso: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), endIso: now.toISOString() };
    }
    if (selectedDuration === 'custom' && customRange) {
      return { startIso: customRange.startIso, endIso: customRange.endIso };
    }
    return null;
  }, [selectedDuration, customRange]);

  const rangeBounds = useMemo(() => {
    if (!activeTimeRange) return undefined;
    return {
      startMs: Date.parse(activeTimeRange.startIso),
      endMs: Date.parse(activeTimeRange.endIso),
    };
  }, [activeTimeRange]);

  const fetchTelemetryHistory = useCallback(async () => {
    const target = upsId || portName;
    if (!target) return;
    setIsLoadingTelemetry(true);
    try {
      if (selectedDuration === 'all' || !activeTimeRange) {
        const limit = downsamplingMaxPoints === 0 ? 50000 : downsamplingMaxPoints;
        const records = await api.getRecentTelemetry(target, limit, upsId || undefined);
        setLoadedTelemetry(records);
      } else {
        const records = await api.getTelemetryRange(
          target,
          activeTimeRange.startIso,
          activeTimeRange.endIso,
          downsamplingMaxPoints,
          upsId || undefined
        );
        setLoadedTelemetry(records);
      }
    } catch (err) {
      console.error('Failed to fetch telemetry history range:', err);
    } finally {
      setIsLoadingTelemetry(false);
    }
  }, [portName, upsId, selectedDuration, activeTimeRange, downsamplingMaxPoints]);

  useEffect(() => {
    fetchTelemetryHistory();
  }, [fetchTelemetryHistory]);

  // Active telemetry source: database range records when upsId or portName is available, fallback to telemetry prop
  const activeTelemetry = (upsId || portName) ? loadedTelemetry : telemetry;

  // Filtered Telemetry
  const filteredTelemetry = useMemo(() => {
    if (!searchQuery.trim()) return activeTelemetry;
    const q = searchQuery.toLowerCase();
    return activeTelemetry.filter(
      (t) =>
        t.ups_id.toLowerCase().includes(q) ||
        t.timestamp.toLowerCase().includes(q) ||
        String(t.grid_voltage).includes(q) ||
        String(t.load_pct).includes(q)
    );
  }, [activeTelemetry, searchQuery]);

  const userActionCount = useMemo(() => events.filter((e) => e.event_type === 'USER_ACTION').length, [events]);
  const systemEventCount = useMemo(() => events.filter((e) => e.event_type !== 'USER_ACTION').length, [events]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    let list = events;
    if (eventFilterType === 'user') {
      list = list.filter((e) => e.event_type === 'USER_ACTION');
    } else if (eventFilterType === 'system') {
      list = list.filter((e) => e.event_type !== 'USER_ACTION');
    }

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (e) =>
        (e.ups_id && e.ups_id.toLowerCase().includes(q)) ||
        e.event_type.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        e.timestamp.toLowerCase().includes(q)
    );
  }, [events, eventFilterType, searchQuery]);

  // Sorted Telemetry for DataTable (defaults to newest records first on top)
  const sortedTelemetry = useMemo(() => {
    const list = [...filteredTelemetry];
    list.sort((a, b) => {
      let cmp = 0;
      if (telemetrySortField === 'timestamp') {
        const timeA = Date.parse(a.timestamp) || 0;
        const timeB = Date.parse(b.timestamp) || 0;
        cmp = timeA - timeB;
      } else if (telemetrySortField === 'ups_id') {
        cmp = a.ups_id.localeCompare(b.ups_id);
      } else if (telemetrySortField === 'id') {
        cmp = (a.id ?? 0) - (b.id ?? 0);
      } else {
        const valA = (a[telemetrySortField] ?? 0) as number;
        const valB = (b[telemetrySortField] ?? 0) as number;
        cmp = valA - valB;
      }
      return telemetrySortDirection === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [filteredTelemetry, telemetrySortField, telemetrySortDirection]);

  // Sorted Events for DataTable (defaults to newest records first on top)
  const sortedEvents = useMemo(() => {
    const list = [...filteredEvents];
    list.sort((a, b) => {
      let cmp = 0;
      if (eventSortField === 'timestamp') {
        const timeA = Date.parse(a.timestamp) || 0;
        const timeB = Date.parse(b.timestamp) || 0;
        cmp = timeA - timeB;
      } else if (eventSortField === 'ups_id') {
        cmp = (a.ups_id || 'SYSTEM').localeCompare(b.ups_id || 'SYSTEM');
      } else if (eventSortField === 'event_type') {
        cmp = a.event_type.localeCompare(b.event_type);
      } else if (eventSortField === 'message') {
        cmp = a.message.localeCompare(b.message);
      } else if (eventSortField === 'id') {
        cmp = (a.id ?? 0) - (b.id ?? 0);
      }
      return eventSortDirection === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [filteredEvents, eventSortField, eventSortDirection]);

  const exportCsv = () => {
    if (activeTab === 'telemetry' || activeTab === 'charts') {
      const headers = 'ID,Timestamp_UTC,Local_Time,UPS_ID,Grid_V,Output_V,Grid_Hz,Output_Hz,Load_Pct,Output_Watts,Battery_V,Temp_C\n';
      const rows = sortedTelemetry
        .map(
          (t) =>
            `${t.id || ''},"${t.timestamp}","${formatLocalCsvTimestamp(t.timestamp)}","${t.ups_id}",${t.grid_voltage},${t.output_voltage},${t.grid_frequency ?? 50.0},${t.output_frequency ?? 50.0},${t.load_pct},${t.output_watts ?? 0},${t.battery_voltage},${t.temperature_c}`
        )
        .join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `upsed-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } else {
      const headers = 'ID,Timestamp_UTC,Local_Time,UPS_ID,Type,Message\n';
      const rows = sortedEvents
        .map(
          (e) =>
            `${e.id || ''},"${e.timestamp}","${formatLocalCsvTimestamp(e.timestamp)}","${e.ups_id || 'SYSTEM'}","${e.event_type}","${e.message}"`
        )
        .join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `upsed-events-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    }
  };

  // Active records depending on tab
  const currentRecordsCount =
    activeTab === 'telemetry'
      ? sortedTelemetry.length
      : activeTab === 'events'
      ? sortedEvents.length
      : 0;

  const totalPages = Math.max(1, Math.ceil(currentRecordsCount / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedTelemetry = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedTelemetry.slice(start, start + PAGE_SIZE);
  }, [sortedTelemetry, safePage]);

  const paginatedEvents = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedEvents.slice(start, start + PAGE_SIZE);
  }, [sortedEvents, safePage]);

  // Check if active history spans more than 24 hours to format time axis labels cleanly
  const isMultiDay = useMemo(() => {
    if (rangeBounds) {
      return Math.abs(rangeBounds.endMs - rangeBounds.startMs) > 24 * 60 * 60 * 1000;
    }
    if (activeTelemetry.length < 2) return false;
    const first = new Date(activeTelemetry[0].timestamp).getTime();
    const last = new Date(activeTelemetry[activeTelemetry.length - 1].timestamp).getTime();
    return Math.abs(last - first) > 24 * 60 * 60 * 1000;
  }, [rangeBounds, activeTelemetry]);

  const { isOutageMap } = useMemo(() => {
    const samples = activeTelemetry.map((t, idx) => {
      const timeStr = formatChartAxisTimestamp(t.timestamp, isMultiDay);
      return {
        time: timeStr,
        xKey: `${t.timestamp}__${idx}`,
        grid_voltage: t.grid_voltage,
        rawTimestamp: t.timestamp,
      };
    });
    return detectOutageDetails(samples, events, false);
  }, [activeTelemetry, events, isMultiDay]);

  const chartData = useMemo(() => {
    return activeTelemetry.map((t, idx) => {
      const timeStr = formatChartAxisTimestamp(t.timestamp, isMultiDay);
      const xKey = `${t.timestamp}__${idx}`;
      return {
        time: timeStr,
        xKey,
        grid_voltage: t.grid_voltage,
        output_voltage: t.output_voltage,
        grid_frequency: t.grid_frequency ?? 50.0,
        output_frequency: t.output_frequency ?? 50.0,
        load_pct: t.load_pct,
        output_watts: t.output_watts ?? 0,
        battery_voltage: t.battery_voltage,
        temperature_c: t.temperature_c,
        isOutage: isOutageMap[idx] ?? false,
      };
    });
  }, [activeTelemetry, isOutageMap, isMultiDay]);

  const historyGaps = useMemo(() => {
    return detectDataGaps(activeTelemetry, 10, rangeBounds);
  }, [activeTelemetry, rangeBounds]);

  const chartDataWithGaps = useMemo(() => {
    return injectGapAnchorPoints(chartData, historyGaps, undefined, rangeBounds);
  }, [chartData, historyGaps, rangeBounds]);

  const {
    containerRef: historyZoomRef,
    visibleData: visibleChartData,
    isZoomed: isHistoryZoomed,
    zoomPercent: historyZoomPercent,
    resetZoom: resetHistoryZoom,
    zoomIn: zoomHistoryIn,
    zoomOut: zoomHistoryOut,
    canZoomIn: canHistoryZoomIn,
    isDragging: isHistoryDragging,
  } = useChartZoom({ data: chartDataWithGaps, minPoints: 8 });

  const visibleOutageIntervals = useMemo(() => {
    if (!showOutageHighlights) return [];
    return deriveVisibleOutageIntervals(visibleChartData);
  }, [visibleChartData, showOutageHighlights]);

  const visibleDataGaps = useMemo(() => {
    return deriveVisibleDataGaps(visibleChartData);
  }, [visibleChartData]);

  const tableGapThreshold = useMemo(() => {
    if (activeTelemetry.length < 2) return 60 * 1000;
    const deltas: number[] = [];
    const maxProbe = Math.min(activeTelemetry.length, 60);
    for (let i = 1; i < maxProbe; i++) {
      const p = Date.parse(activeTelemetry[i - 1].timestamp);
      const c = Date.parse(activeTelemetry[i].timestamp);
      if (!isNaN(p) && !isNaN(c) && c > p) deltas.push(c - p);
    }
    if (deltas.length === 0) return 60 * 1000;
    deltas.sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)];
    return Math.max(median * 3.5, 60 * 1000);
  }, [activeTelemetry]);

  const toggleSelectOne = (id?: number) => {
    if (!id) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)] custom-scrollbar min-w-0">
      {/* ── Section Title ────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-100 tracking-tight">
            {t('history:title', 'History & Telemetry Records')}
          </h2>
          <p className="text-xs text-slate-400">
            {t('history:subtitle', 'Recorded telemetry frames and time-series snapshots saved in local SQLite storage')}
          </p>
        </div>
      </div>

      {/* ── Toolbar: Filter Tabs & Search & Export ───────────── */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 min-w-0">
        {/* Left: View Tabs */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 xl:pb-0 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
          <button
            onClick={() => { setActiveTab('telemetry'); setCurrentPage(1); }}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
              activeTab === 'telemetry'
                ? 'bg-[#22c55e] text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-white/[0.06]'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>{t('history:tabs.telemetry', 'Telemetry Table')} ({activeTelemetry.length})</span>
          </button>

          <button
            onClick={() => { setActiveTab('charts'); setCurrentPage(1); }}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
              activeTab === 'charts'
                ? 'bg-[#22c55e] text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-white/[0.06]'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>{t('history:visualAnalytics', 'Visual Analytics')}</span>
          </button>

          <button
            onClick={() => { setActiveTab('events'); setCurrentPage(1); }}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
              activeTab === 'events'
                ? 'bg-[#22c55e] text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-white/[0.06]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{t('history:tabs.events', 'Audit & Events Log')} ({events.length})</span>
          </button>
        </div>

        {/* Right: Search, Export, Refresh */}
        <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap gap-y-2 min-w-0">
          {activeTab !== 'charts' && (
            <div className="relative flex-1 sm:flex-initial min-w-[140px] sm:min-w-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                placeholder={activeTab === 'events' ? t('history:searchEventsPlaceholder', 'Filter event entries...') : t('history:searchPlaceholder', 'Filter history entries...')}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-green-500 transition"
              />
            </div>
          )}

          <button
            onClick={exportCsv}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.04] whitespace-nowrap shrink-0 transition"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span>{t('common:buttons.exportCsv', 'Export CSV')}</span>
          </button>

          <button
            onClick={() => {
              onRefresh();
              fetchTelemetryHistory();
            }}
            disabled={isRefreshing || isLoadingTelemetry}
            className="p-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] shrink-0 transition"
            title={t('common:buttons.refresh', 'Refresh records')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing || isLoadingTelemetry ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Duration Range Filter Bar (Telemetry & Visual Analytics) ────── */}
      {(activeTab === 'telemetry' || activeTab === 'charts') && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-medium flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t('history:timeRange', 'Time Range')}:</span>
            </span>
            <div className="flex flex-wrap items-center bg-slate-950/80 border border-slate-800 rounded-lg p-0.5">
              {(['1h', '6h', '24h', '7d', '30d', 'all'] as const).map((dur) => (
                <button
                  key={dur}
                  onClick={() => {
                    setSelectedDuration(dur);
                    setCurrentPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-md font-medium transition ${
                    selectedDuration === dur
                      ? 'bg-[#22c55e] text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {dur === 'all' ? t('history:durations.all', 'All') : dur}
                </button>
              ))}
              <button
                onClick={() => setIsCustomModalOpen(true)}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  selectedDuration === 'custom'
                    ? 'bg-[#22c55e] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {selectedDuration === 'custom' && customRange ? customRange.label : t('history:durations.custom', 'Custom...')}
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs text-slate-400">
            {isLoadingTelemetry ? (
              <span className="flex items-center space-x-1.5 text-cyan-400 animate-pulse font-mono">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>{t('history:durations.loading', 'Loading records...')}</span>
              </span>
            ) : (
              <span className="font-mono text-[11px] text-slate-400">
                {activeTelemetry.length} {activeTelemetry.length === 1 ? 'sample' : 'samples'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Content Container ─────────────────────────────────── */}
      <div
        className="rounded-2xl border overflow-hidden shadow-sm"
        style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-subtle)' }}
      >
        {activeTab === 'charts' ? (
          /* Visual Analytics Chart View */
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t('history:metricStream', 'Metric Stream')}
              </span>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <ChartZoomBadge
                  isZoomed={isHistoryZoomed}
                  zoomPercent={historyZoomPercent}
                  onReset={resetHistoryZoom}
                  onZoomIn={zoomHistoryIn}
                  onZoomOut={zoomHistoryOut}
                  canZoomIn={canHistoryZoomIn}
                />
                <div className="flex flex-wrap gap-1.5">
                  {(['voltage', 'frequency', 'power', 'battery', 'temperature'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setChartMetric(m)}
                      className={`px-2.5 py-1 rounded-lg capitalize text-xs font-medium transition ${
                        chartMetric === m
                          ? 'bg-[#22c55e] text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 bg-white/[0.04]'
                      }`}
                    >
                      {t(`history:metricShort.${m}`, m)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              ref={historyZoomRef}
              className={`h-80 w-full relative select-none ${
                isHistoryZoomed ? (isHistoryDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
              }`}
            >
              {activeTelemetry.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                  {isLoadingTelemetry ? t('history:durations.loading', 'Loading records...') : t('history:noRecords', 'No telemetry records recorded yet.')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={visibleChartData} margin={{ top: 12, right: 12, left: -20, bottom: 4 }}>
                    <defs>
                      <linearGradient id="histGrad1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="histGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.25} />
                    <XAxis
                      dataKey="xKey"
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      minTickGap={25}
                      tickFormatter={(val) => {
                        if (typeof val === 'string' && val.includes('__')) {
                          const raw = val.split('__')[0];
                          return formatChartAxisTimestamp(raw, isMultiDay);
                        }
                        return val;
                      }}
                    />
                    <YAxis
                      stroke="#64748b"
                      fontSize={11}
                      domain={['auto', 'auto']}
                      tickLine={false}
                      padding={{ top: 24, bottom: 12 }}
                    />
                    <Tooltip
                      filterNull={false}
                      content={({ active, payload, label, activeIndex }: any) => {
                        if (!active) return null;
                        const itemPayload =
                          payload?.[0]?.payload ||
                          (typeof activeIndex === 'number' ? visibleChartData[activeIndex] : null);
                        if (!itemPayload) return null;
                        const isOutage = itemPayload?.isOutage;
                        const isGap = itemPayload?.isGap;
                        const displayTime = typeof label === 'string' && label.includes('__')
                          ? formatChartTooltipTimestamp(label.split('__')[0])
                          : itemPayload?.time || label;
                        return (
                          <div
                            className="rounded-xl p-2.5 shadow-lg border text-xs"
                            style={{
                              backgroundColor: '#161922',
                              borderColor: isOutage ? 'rgba(239, 68, 68, 0.4)' : isGap ? 'rgba(100, 116, 139, 0.5)' : 'rgba(255,255,255,0.1)',
                              color: '#f8fafc',
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] text-slate-400 font-mono">{displayTime}</span>
                              {isOutage && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60">
                                  Power Outage (Battery Mode)
                                </span>
                              )}
                              {isGap && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-800/90 text-slate-300 border border-slate-700/80">
                                  Monitoring Inactive
                                </span>
                              )}
                            </div>
                            {isGap ? (
                              <div className="space-y-1.5 py-1">
                                <div className="flex items-center justify-between gap-3 text-[11px] font-mono">
                                  <span className="text-slate-400">Duration:</span>
                                  <span className="font-semibold text-slate-200">
                                    {itemPayload?.gapDuration || 'Data Gap'}
                                  </span>
                                </div>
                                {(itemPayload?.gapStartIso || itemPayload?.gapEndIso) && (
                                  <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-1 mt-1 space-y-0.5">
                                    {itemPayload.gapStartIso && (
                                      <div>
                                        From: <span className="text-slate-300">{formatChartTooltipTimestamp(itemPayload.gapStartIso)}</span>
                                      </div>
                                    )}
                                    {itemPayload.gapEndIso && (
                                      <div>
                                        To: <span className="text-slate-300">{formatChartTooltipTimestamp(itemPayload.gapEndIso)}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="text-[9.5px] text-slate-500 italic pt-0.5">
                                  System offline or monitoring disconnected
                                </div>
                              </div>
                            ) : (
                              payload
                                ?.filter((item: any) => item.value != null)
                                .map((item: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                                    <span style={{ color: item.color }}>{item.name}:</span>
                                    <span className="font-semibold text-slate-100">
                                      {item.value} {item.unit}
                                    </span>
                                  </div>
                                ))
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    {visibleDataGaps.map((gap, idx) => (
                      <DataGapReferenceArea
                        key={`gap-hist-${idx}`}
                        gap={gap}
                        xDataKey="xKey"
                      />
                    ))}
                    {showOutageHighlights &&
                      visibleOutageIntervals.map((interval, idx) => (
                        <OutageReferenceArea
                          key={`outage-hist-${idx}`}
                          interval={interval}
                          xDataKey="xKey"
                        />
                      ))}

                    {chartMetric === 'voltage' && (
                      <>
                        <Area connectNulls={false} type="monotone" dataKey="grid_voltage" name={t('history:chartLegends.gridV', 'Grid Voltage (V)')} stroke="#22c55e" strokeWidth={2} fill="url(#histGrad1)" unit="V" />
                        <Area connectNulls={false} type="monotone" dataKey="output_voltage" name={t('history:chartLegends.outV', 'Output Voltage (V)')} stroke="#3b82f6" strokeWidth={2} fill="url(#histGrad2)" unit="V" />
                      </>
                    )}

                    {chartMetric === 'frequency' && (
                      <>
                        <Area connectNulls={false} type="monotone" dataKey="grid_frequency" name={t('history:chartLegends.gridHz', 'Grid Freq (Hz)')} stroke="#22c55e" strokeWidth={2} fill="url(#histGrad1)" unit="Hz" />
                        <Area connectNulls={false} type="monotone" dataKey="output_frequency" name={t('history:chartLegends.outHz', 'Output Freq (Hz)')} stroke="#818cf8" strokeWidth={2} fill="url(#histGrad2)" unit="Hz" />
                      </>
                    )}

                    {chartMetric === 'power' && (
                      <>
                        <Area connectNulls={false} type="monotone" dataKey="load_pct" name={t('history:chartLegends.loadPct', 'Load (%)')} stroke="#22c55e" strokeWidth={2} fill="url(#histGrad1)" unit="%" />
                        <Area connectNulls={false} type="monotone" dataKey="output_watts" name={t('history:chartLegends.outW', 'Active Watts (W)')} stroke="#3b82f6" strokeWidth={2} fill="url(#histGrad2)" unit="W" />
                      </>
                    )}

                    {chartMetric === 'battery' && (
                      <Area connectNulls={false} type="monotone" dataKey="battery_voltage" name={t('history:chartLegends.batV', 'Battery Voltage (V)')} stroke="#22c55e" strokeWidth={2} fill="url(#histGrad1)" unit="V" />
                    )}

                    {chartMetric === 'temperature' && (
                      <Area connectNulls={false} type="monotone" dataKey="temperature_c" name={t('history:chartLegends.tempC', 'Temperature (°C)')} stroke="#f97316" strokeWidth={2} fill="url(#histGrad1)" unit="°C" />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        ) : activeTab === 'telemetry' ? (
          /* Telemetry DataTable */
          <div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr
                    className="text-slate-400 font-medium"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <th className="py-3.5 px-4 w-10">
                      <input
                        type="checkbox"
                        className="rounded border-slate-700 bg-slate-900/80 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('timestamp')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by timestamp"
                      >
                        <span>{t('history:tableHeaders.timestamp', 'Time')}</span>
                        {renderTelemetrySortIcon('timestamp')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('ups_id')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by UPS ID"
                      >
                        <span>{t('history:tableHeaders.port', 'UPS Device')}</span>
                        {renderTelemetrySortIcon('ups_id')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('grid_voltage')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by grid voltage"
                      >
                        <span>{t('history:tableHeaders.gridV', 'Grid In (V)')}</span>
                        {renderTelemetrySortIcon('grid_voltage')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('grid_frequency')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by grid frequency"
                      >
                        <span>{t('history:tableHeaders.gridHz', 'Grid (Hz)')}</span>
                        {renderTelemetrySortIcon('grid_frequency')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('output_voltage')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by output voltage"
                      >
                        <span>{t('history:tableHeaders.outV', 'Output (V)')}</span>
                        {renderTelemetrySortIcon('output_voltage')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('output_frequency')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by output frequency"
                      >
                        <span>{t('history:tableHeaders.outHz', 'Out (Hz)')}</span>
                        {renderTelemetrySortIcon('output_frequency')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('load_pct')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by load percentage"
                      >
                        <span>{t('history:tableHeaders.loadPct', 'Load (%)')}</span>
                        {renderTelemetrySortIcon('load_pct')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('output_watts')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by active power watts"
                      >
                        <span>{t('history:tableHeaders.outW', 'Power (W)')}</span>
                        {renderTelemetrySortIcon('output_watts')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('battery_voltage')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by battery voltage"
                      >
                        <span>{t('history:tableHeaders.batV', 'Battery (V)')}</span>
                        {renderTelemetrySortIcon('battery_voltage')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleTelemetrySort('temperature_c')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by temperature"
                      >
                        <span>{t('history:tableHeaders.tempC', 'Temp (°C)')}</span>
                        {renderTelemetrySortIcon('temperature_c')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-slate-300">
                  {paginatedTelemetry.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-500 font-sans">
                        {t('history:noRecords', 'No telemetry records recorded yet.')}
                      </td>
                    </tr>
                  ) : (
                    paginatedTelemetry.map((row, i) => {
                      const isChecked = row.id ? selectedIds.has(row.id) : false;
                      let hasGapBefore = false;
                      let gapDurationStr = '';
                      if (i > 0) {
                        const prev = paginatedTelemetry[i - 1];
                        const delta = Math.abs(Date.parse(row.timestamp) - Date.parse(prev.timestamp));
                        if (delta > tableGapThreshold) {
                          hasGapBefore = true;
                          gapDurationStr = formatGapDuration(delta);
                        }
                      }

                      return (
                        <React.Fragment key={row.id || i}>
                          {hasGapBefore && (
                            <tr className="bg-slate-900/90 border-y border-slate-800/80">
                              <td colSpan={11} className="py-2 px-4 text-center">
                                <div className="inline-flex items-center space-x-2 text-[11px] font-mono text-slate-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                  <span className="font-semibold text-slate-300">Monitoring Inactive / Data Gap</span>
                                  <span className="text-slate-600">•</span>
                                  <span className="text-slate-400 font-medium">{gapDurationStr} unrecorded</span>
                                </div>
                              </td>
                            </tr>
                          )}
                          <tr className="hover:bg-white/[0.02] transition">
                            <td className="py-3 px-4">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleSelectOne(row.id)}
                                className="rounded border-slate-700 bg-slate-900/80 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                              />
                            </td>
                            <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                              {formatTableTimestamp(row.timestamp)}
                            </td>
                            <td
                              className="py-3 px-4 text-emerald-400 font-semibold whitespace-nowrap max-w-[150px] truncate font-mono text-[11px]"
                              title={row.ups_id}
                            >
                              {row.ups_id}
                            </td>
                            <td className="py-3 px-4">{row.grid_voltage.toFixed(1)}</td>
                            <td className="py-3 px-4">{(row.grid_frequency ?? 50.0).toFixed(1)}</td>
                            <td className="py-3 px-4">{row.output_voltage.toFixed(1)}</td>
                          <td className="py-3 px-4">{(row.output_frequency ?? 50.0).toFixed(1)}</td>
                          <td className="py-3 px-4 font-semibold text-slate-100">{row.load_pct}%</td>
                          <td className="py-3 px-4">{row.output_watts ?? 0}W</td>
                          <td className="py-3 px-4 text-emerald-400">{row.battery_voltage.toFixed(1)}</td>
                          <td className="py-3 px-4">{row.temperature_c}</td>
                        </tr>
                      </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div
              className="flex items-center justify-between px-4 py-3 text-xs"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] disabled:opacity-30 disabled:pointer-events-none transition"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>{t('history:pagination.prev', 'Previous')}</span>
              </button>

              <div className="flex items-center space-x-1">
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const page = idx + 1;
                  const isActive = page === safePage;
                  if (totalPages > 6 && page > 2 && page < totalPages - 1 && Math.abs(page - safePage) > 1) {
                    if (page === 3 || page === totalPages - 2) {
                      return <span key={page} className="px-1 text-slate-600">…</span>;
                    }
                    return null;
                  }
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[28px] h-7 px-2 rounded-md font-medium text-xs transition ${
                        isActive
                          ? 'bg-[#22c55e] text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] disabled:opacity-30 disabled:pointer-events-none transition"
              >
                <span>{t('history:pagination.next', 'Next')}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          /* Events DataTable */
          <div>
            {/* Events Sub-Filter Bar */}
            <div
              className="flex items-center space-x-2 px-4 py-2.5 border-b"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <span className="text-[11px] font-sans text-slate-400 font-medium mr-1">
                {t('history:eventFilter.label', 'Filter:')}
              </span>
              <button
                type="button"
                onClick={() => { setEventFilterType('all'); setCurrentPage(1); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  eventFilterType === 'all'
                    ? 'bg-white/[0.1] text-white border border-white/[0.15]'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {t('history:eventFilter.all', 'All Entries')} ({events.length})
              </button>
              <button
                type="button"
                onClick={() => { setEventFilterType('user'); setCurrentPage(1); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer inline-flex items-center space-x-1.5 ${
                  eventFilterType === 'user'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <span>👤</span>
                <span>{t('history:eventFilter.userActions', 'User Audit Log')} ({userActionCount})</span>
              </button>
              <button
                type="button"
                onClick={() => { setEventFilterType('system'); setCurrentPage(1); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer inline-flex items-center space-x-1.5 ${
                  eventFilterType === 'system'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <span>⚡</span>
                <span>{t('history:eventFilter.systemEvents', 'System Alarms & Hardware')} ({systemEventCount})</span>
              </button>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr
                    className="text-slate-400 font-medium"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <th className="py-3.5 px-4 w-10">
                      <input
                        type="checkbox"
                        className="rounded border-slate-700 bg-slate-900/80 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleEventSort('timestamp')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by timestamp"
                      >
                        <span>{t('history:tableHeaders.timestamp', 'Time')}</span>
                        {renderEventSortIcon('timestamp')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleEventSort('ups_id')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by UPS ID"
                      >
                        <span>{t('history:tableHeaders.port', 'UPS Device')}</span>
                        {renderEventSortIcon('ups_id')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleEventSort('event_type')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by event type"
                      >
                        <span>{t('history:tableHeaders.type', 'Event Type')}</span>
                        {renderEventSortIcon('event_type')}
                      </button>
                    </th>
                    <th className="py-3.5 px-4">
                      <button
                        onClick={() => handleEventSort('message')}
                        className="group flex items-center space-x-1.5 text-slate-400 hover:text-slate-200 transition font-medium cursor-pointer"
                        title="Sort by message details"
                      >
                        <span>{t('history:tableHeaders.message', 'Details')}</span>
                        {renderEventSortIcon('message')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-slate-300">
                  {paginatedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-500 font-sans">
                        {eventFilterType === 'user'
                          ? t('history:noUserActions', 'No user actions recorded in audit log yet.')
                          : t('history:noEvents', 'No system events logged yet.')}
                      </td>
                    </tr>
                  ) : (
                    paginatedEvents.map((evt, i) => (
                      <tr key={evt.id || i} className="hover:bg-white/[0.02] transition">
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            className="rounded border-slate-700 bg-slate-900/80 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                          {formatTableTimestamp(evt.timestamp)}
                        </td>
                        <td
                          className="py-3 px-4 text-emerald-400 font-semibold whitespace-nowrap max-w-[150px] truncate font-mono text-[11px]"
                          title={evt.ups_id || 'SYSTEM'}
                        >
                          {evt.ups_id || 'SYSTEM'}
                        </td>
                        <td className="py-3 px-4">
                          {evt.event_type === 'USER_ACTION' ? (
                            <span className="px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px] font-semibold inline-flex items-center space-x-1">
                              <span>👤</span>
                              <span>User Audit Action</span>
                            </span>
                          ) : (
                            <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                              evt.severity === 'critical'
                                ? 'bg-rose-950/60 border-rose-700/60 text-rose-300'
                                : evt.severity === 'warning'
                                ? 'bg-amber-950/60 border-amber-700/60 text-amber-300'
                                : evt.severity === 'success'
                                ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                                : 'bg-white/[0.05] border-white/[0.08] text-slate-300'
                            }`}>
                              {evt.event_type}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-200 font-sans max-w-xs sm:max-w-md" title={evt.message}>
                          {evt.event_type === 'USER_ACTION' ? (
                            <span className="text-slate-100 font-medium">
                              {evt.message}
                            </span>
                          ) : (
                            evt.message
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div
              className="flex items-center justify-between px-4 py-3 text-xs"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] disabled:opacity-30 disabled:pointer-events-none transition"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>{t('history:pagination.prev', 'Previous')}</span>
              </button>

              <div className="flex items-center space-x-1">
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const page = idx + 1;
                  const isActive = page === safePage;
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`min-w-[28px] h-7 px-2 rounded-md font-medium text-xs transition ${
                        isActive
                          ? 'bg-[#22c55e] text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] disabled:opacity-30 disabled:pointer-events-none transition"
              >
                <span>{t('history:pagination.next', 'Next')}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Custom Duration Range Picker Modal */}
      <DurationPickerModal
        isOpen={isCustomModalOpen}
        onClose={() => setIsCustomModalOpen(false)}
        onApply={(range) => {
          setCustomRange(range);
          setSelectedDuration('custom');
          setCurrentPage(1);
          setIsCustomModalOpen(false);
        }}
      />
    </div>
  );
};
