import React, { useState, useMemo } from 'react';
import {
  Download,
  RefreshCw,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Search,
  Table,
  Activity,
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

interface HistoryProps {
  telemetry: TelemetryRecord[];
  events: EventLogRecord[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

const PAGE_SIZE = 12;

export const History: React.FC<HistoryProps> = ({
  telemetry,
  events,
  onRefresh,
  isRefreshing,
}) => {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'events' | 'charts'>('telemetry');
  const [chartMetric, setChartMetric] = useState<'voltage' | 'frequency' | 'power' | 'battery' | 'temperature'>('voltage');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const exportCsv = () => {
    if (activeTab === 'telemetry' || activeTab === 'charts') {
      const headers = 'ID,Timestamp,Port,Grid_V,Output_V,Grid_Hz,Output_Hz,Load_Pct,Output_Watts,Battery_V,Temp_C\n';
      const rows = filteredTelemetry
        .map(
          (t) =>
            `${t.id || ''},"${t.timestamp}","${t.port_name}",${t.grid_voltage},${t.output_voltage},${t.grid_frequency ?? 50.0},${t.output_frequency ?? 50.0},${t.load_pct},${t.output_watts ?? 0},${t.battery_voltage},${t.temperature_c}`
        )
        .join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voltwatch-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } else {
      const headers = 'ID,Timestamp,Port,Type,Message\n';
      const rows = filteredEvents
        .map(
          (e) =>
            `${e.id || ''},"${e.timestamp}","${e.port_name}","${e.event_type}","${e.message}"`
        )
        .join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voltwatch-events-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    }
  };

  // Filtered Telemetry
  const filteredTelemetry = useMemo(() => {
    if (!searchQuery.trim()) return telemetry;
    const q = searchQuery.toLowerCase();
    return telemetry.filter(
      (t) =>
        t.port_name.toLowerCase().includes(q) ||
        t.timestamp.toLowerCase().includes(q) ||
        String(t.grid_voltage).includes(q) ||
        String(t.load_pct).includes(q)
    );
  }, [telemetry, searchQuery]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;
    const q = searchQuery.toLowerCase();
    return events.filter(
      (e) =>
        e.port_name.toLowerCase().includes(q) ||
        e.event_type.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        e.timestamp.toLowerCase().includes(q)
    );
  }, [events, searchQuery]);

  // Active records depending on tab
  const currentRecordsCount =
    activeTab === 'telemetry'
      ? filteredTelemetry.length
      : activeTab === 'events'
      ? filteredEvents.length
      : 0;

  const totalPages = Math.max(1, Math.ceil(currentRecordsCount / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedTelemetry = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredTelemetry.slice(start, start + PAGE_SIZE);
  }, [filteredTelemetry, safePage]);

  const paginatedEvents = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, safePage]);

  const chartData = useMemo(() => {
    return telemetry.map((t) => ({
      time: t.timestamp.includes('T') ? t.timestamp.split('T')[1].substring(0, 8) : t.timestamp.slice(-8),
      grid_voltage: t.grid_voltage,
      output_voltage: t.output_voltage,
      grid_frequency: t.grid_frequency ?? 50.0,
      output_frequency: t.output_frequency ?? 50.0,
      load_pct: t.load_pct,
      output_watts: t.output_watts ?? 0,
      battery_voltage: t.battery_voltage,
      temperature_c: t.temperature_c,
    }));
  }, [telemetry]);

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
            History & Telemetry Records
          </h2>
          <p className="text-xs text-slate-400">
            Recorded telemetry frames and time-series snapshots saved in local SQLite storage
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
            <span>Telemetry Table ({telemetry.length})</span>
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
            <span>Visual Analytics</span>
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
            <span>Events Log ({events.length})</span>
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
                placeholder="Search records..."
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-green-500 transition"
              />
            </div>
          )}

          <button
            onClick={exportCsv}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.04] whitespace-nowrap shrink-0 transition"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] shrink-0 transition"
            title="Refresh records"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

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
                Metric Stream
              </span>
              <div className="flex flex-wrap gap-1.5 text-xs">
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
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-80 w-full">
              {telemetry.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                  No telemetry recorded yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                    <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#161922',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                        color: '#f8fafc',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />

                    {chartMetric === 'voltage' && (
                      <>
                        <Area type="monotone" dataKey="grid_voltage" name="Grid Voltage (V)" stroke="#22c55e" strokeWidth={2} fill="url(#histGrad1)" unit="V" />
                        <Area type="monotone" dataKey="output_voltage" name="Output Voltage (V)" stroke="#3b82f6" strokeWidth={2} fill="url(#histGrad2)" unit="V" />
                      </>
                    )}

                    {chartMetric === 'frequency' && (
                      <>
                        <Area type="monotone" dataKey="grid_frequency" name="Grid Freq (Hz)" stroke="#22c55e" strokeWidth={2} fill="url(#histGrad1)" unit="Hz" />
                        <Area type="monotone" dataKey="output_frequency" name="Output Freq (Hz)" stroke="#818cf8" strokeWidth={2} fill="url(#histGrad2)" unit="Hz" />
                      </>
                    )}

                    {chartMetric === 'power' && (
                      <>
                        <Area type="monotone" dataKey="load_pct" name="Load (%)" stroke="#22c55e" strokeWidth={2} fill="url(#histGrad1)" unit="%" />
                        <Area type="monotone" dataKey="output_watts" name="Active Watts (W)" stroke="#3b82f6" strokeWidth={2} fill="url(#histGrad2)" unit="W" />
                      </>
                    )}

                    {chartMetric === 'battery' && (
                      <Area type="monotone" dataKey="battery_voltage" name="Battery Voltage (V)" stroke="#22c55e" strokeWidth={2} fill="url(#histGrad1)" unit="V" />
                    )}

                    {chartMetric === 'temperature' && (
                      <Area type="monotone" dataKey="temperature_c" name="Temperature (°C)" stroke="#f97316" strokeWidth={2} fill="url(#histGrad1)" unit="°C" />
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
                    <th className="py-3.5 px-4">Time</th>
                    <th className="py-3.5 px-4">Port</th>
                    <th className="py-3.5 px-4">Grid In (V)</th>
                    <th className="py-3.5 px-4">Grid (Hz)</th>
                    <th className="py-3.5 px-4">Output (V)</th>
                    <th className="py-3.5 px-4">Out (Hz)</th>
                    <th className="py-3.5 px-4">Load (%)</th>
                    <th className="py-3.5 px-4">Power (W)</th>
                    <th className="py-3.5 px-4">Battery (V)</th>
                    <th className="py-3.5 px-4">Temp (°C)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-slate-300">
                  {paginatedTelemetry.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-500 font-sans">
                        No telemetry records recorded yet.
                      </td>
                    </tr>
                  ) : (
                    paginatedTelemetry.map((row, i) => {
                      const isChecked = row.id ? selectedIds.has(row.id) : false;
                      return (
                        <tr key={row.id || i} className="hover:bg-white/[0.02] transition">
                          <td className="py-3 px-4">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectOne(row.id)}
                              className="rounded border-slate-700 bg-slate-900/80 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                            />
                          </td>
                          <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                            {row.timestamp.replace('T', ' ').substring(0, 19)}
                          </td>
                          <td
                            className="py-3 px-4 text-emerald-400 font-semibold whitespace-nowrap max-w-[150px] truncate"
                            title={row.port_name}
                          >
                            {row.port_name}
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
                <span>Previous</span>
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
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          /* Events DataTable */
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
                    <th className="py-3.5 px-4">Time</th>
                    <th className="py-3.5 px-4">Port</th>
                    <th className="py-3.5 px-4">Event Type</th>
                    <th className="py-3.5 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-slate-300">
                  {paginatedEvents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-500 font-sans">
                        No system events logged yet.
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
                        <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                          {evt.timestamp.replace('T', ' ').substring(0, 19)}
                        </td>
                        <td
                          className="py-3 px-4 text-emerald-400 font-semibold whitespace-nowrap max-w-[150px] truncate"
                          title={evt.port_name}
                        >
                          {evt.port_name}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.06] text-slate-300 text-[11px]">
                            {evt.event_type}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-200 font-sans max-w-xs sm:max-w-md truncate" title={evt.message}>
                          {evt.message}
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
                <span>Previous</span>
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
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
