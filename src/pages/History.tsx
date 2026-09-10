import React, { useState, useMemo } from 'react';
import { History as HistoryIcon, Download, RefreshCw, BarChart2, Zap, Activity, Gauge, Battery, Thermometer } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { EventLogRecord, TelemetryRecord } from '../lib/types';

interface HistoryProps {
  telemetry: TelemetryRecord[];
  events: EventLogRecord[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const History: React.FC<HistoryProps> = ({
  telemetry,
  events,
  onRefresh,
  isRefreshing,
}) => {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'events' | 'charts'>('telemetry');
  const [chartMetric, setChartMetric] = useState<'voltage' | 'frequency' | 'power' | 'battery' | 'temperature'>('voltage');

  const exportCsv = () => {
    if (activeTab === 'telemetry' || activeTab === 'charts') {
      const headers = 'ID,Timestamp,Port,Grid_V,Output_V,Grid_Hz,Output_Hz,Load_Pct,Output_Watts,Battery_V,Temp_C\n';
      const rows = telemetry
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
      const rows = events
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

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-800 rounded-xl text-slate-300">
            <HistoryIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Telemetry & Event History
            </h3>
            <p className="text-xs text-slate-400">
              Stored locally in SQLite embedded database
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Tab selector */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-3 py-1 font-semibold rounded-lg transition ${
                activeTab === 'telemetry'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Telemetry Table ({telemetry.length})
            </button>
            <button
              onClick={() => setActiveTab('charts')}
              className={`px-3 py-1 font-semibold rounded-lg flex items-center space-x-1.5 transition ${
                activeTab === 'charts'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Visual Analytics</span>
            </button>
            <button
              onClick={() => setActiveTab('events')}
              className={`px-3 py-1 font-semibold rounded-lg transition ${
                activeTab === 'events'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Events ({events.length})
            </button>
          </div>

          <button
            onClick={exportCsv}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 transition"
            title="Export to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition"
            title="Refresh tables"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {activeTab === 'charts' ? (
          <div className="p-5 space-y-4">
            {/* Metric Filter Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'voltage', label: 'Voltages (V)', icon: Zap },
                  { id: 'frequency', label: 'Frequencies (Hz)', icon: Activity },
                  { id: 'power', label: 'Load & Watts', icon: Gauge },
                  { id: 'battery', label: 'Battery Voltage', icon: Battery },
                  { id: 'temperature', label: 'Temperature (°C)', icon: Thermometer },
                ].map((m) => {
                  const Icon = m.icon;
                  const isCur = chartMetric === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setChartMetric(m.id as any)}
                      className={`px-3 py-1.5 rounded-xl border font-semibold flex items-center space-x-1.5 transition ${
                        isCur
                          ? 'bg-cyan-950/70 border-cyan-500/60 text-cyan-300'
                          : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
              <span className="text-slate-500 font-mono text-[11px]">
                Showing {chartData.length} recorded historical samples
              </span>
            </div>

            {/* Chart Area */}
            <div className="h-80 w-full bg-slate-950/60 rounded-xl p-3 border border-slate-800">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
                  No historical telemetry points recorded yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="histGrad1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="histGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                      }}
                    />
                    <Legend />

                    {chartMetric === 'voltage' && (
                      <>
                        <Area type="monotone" dataKey="grid_voltage" name="Grid Voltage (V)" stroke="#f59e0b" strokeWidth={2} fill="url(#histGrad1)" unit="V" />
                        <Area type="monotone" dataKey="output_voltage" name="Output Voltage (V)" stroke="#3b82f6" strokeWidth={2} fill="url(#histGrad2)" unit="V" />
                      </>
                    )}

                    {chartMetric === 'frequency' && (
                      <>
                        <Area type="monotone" dataKey="grid_frequency" name="Grid Freq (Hz)" stroke="#06b6d4" strokeWidth={2} fill="url(#histGrad1)" unit="Hz" />
                        <Area type="monotone" dataKey="output_frequency" name="Output Freq (Hz)" stroke="#818cf8" strokeWidth={2} fill="url(#histGrad2)" unit="Hz" />
                      </>
                    )}

                    {chartMetric === 'power' && (
                      <>
                        <Area type="monotone" dataKey="load_pct" name="Load (%)" stroke="#06b6d4" strokeWidth={2} fill="url(#histGrad1)" unit="%" />
                        <Area type="monotone" dataKey="output_watts" name="Active Watts (W)" stroke="#10b981" strokeWidth={2} fill="url(#histGrad2)" unit="W" />
                      </>
                    )}

                    {chartMetric === 'battery' && (
                      <Area type="monotone" dataKey="battery_voltage" name="Battery Voltage (V)" stroke="#14b8a6" strokeWidth={2} fill="url(#histGrad1)" unit="V" />
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Port</th>
                  <th className="py-3 px-4">Grid (V)</th>
                  <th className="py-3 px-4">Grid (Hz)</th>
                  <th className="py-3 px-4">Output (V)</th>
                  <th className="py-3 px-4">Output (Hz)</th>
                  <th className="py-3 px-4">Load (%)</th>
                  <th className="py-3 px-4">Power (W)</th>
                  <th className="py-3 px-4">Battery (V)</th>
                  <th className="py-3 px-4">Temp (°C)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {telemetry.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500">
                      No telemetry recorded yet.
                    </td>
                  </tr>
                ) : (
                  telemetry.map((row, i) => (
                    <tr key={row.id || i} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4 text-slate-400">
                        {row.timestamp.replace('T', ' ').substring(0, 19)}
                      </td>
                      <td className="py-2.5 px-4 text-cyan-400 font-semibold">
                        {row.port_name}
                      </td>
                      <td className="py-2.5 px-4">{row.grid_voltage.toFixed(1)}</td>
                      <td className="py-2.5 px-4">{(row.grid_frequency ?? 50.0).toFixed(1)}</td>
                      <td className="py-2.5 px-4">{row.output_voltage.toFixed(1)}</td>
                      <td className="py-2.5 px-4">{(row.output_frequency ?? 50.0).toFixed(1)}</td>
                      <td className="py-2.5 px-4">{row.load_pct}%</td>
                      <td className="py-2.5 px-4">{row.output_watts ?? 0}W</td>
                      <td className="py-2.5 px-4">{row.battery_voltage.toFixed(1)}</td>
                      <td className="py-2.5 px-4">{row.temperature_c}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Port</th>
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      No system events logged yet.
                    </td>
                  </tr>
                ) : (
                  events.map((evt, i) => (
                    <tr key={evt.id || i} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4 text-slate-400">
                        {evt.timestamp.replace('T', ' ').substring(0, 19)}
                      </td>
                      <td className="py-2.5 px-4 text-cyan-400 font-semibold">
                        {evt.port_name}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                          {evt.event_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-200">{evt.message}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
