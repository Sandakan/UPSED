import React, { useState } from 'react';
import { History as HistoryIcon, Download, RefreshCw } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<'telemetry' | 'events'>('telemetry');

  const exportCsv = () => {
    if (activeTab === 'telemetry') {
      const headers = 'ID,Timestamp,Port,Grid_V,Output_V,Load_Pct,Battery_V,Temp_C\n';
      const rows = telemetry
        .map(
          (t) =>
            `${t.id || ''},"${t.timestamp}","${t.port_name}",${t.grid_voltage},${t.output_voltage},${t.load_pct},${t.battery_voltage},${t.temperature_c}`
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

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-slate-800 rounded-xl text-slate-300">
            <HistoryIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Telemetry & Event Logs
            </h3>
            <p className="text-xs text-slate-400">
              Stored locally in SQLite embedded database
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Tab selector */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                activeTab === 'telemetry'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Telemetry ({telemetry.length})
            </button>
            <button
              onClick={() => setActiveTab('events')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
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

      {/* Tables container */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {activeTab === 'telemetry' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Port</th>
                  <th className="py-3 px-4">Grid (V)</th>
                  <th className="py-3 px-4">Output (V)</th>
                  <th className="py-3 px-4">Load (%)</th>
                  <th className="py-3 px-4">Battery (V)</th>
                  <th className="py-3 px-4">Temp (°C)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {telemetry.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
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
                      <td className="py-2.5 px-4">{row.output_voltage.toFixed(1)}</td>
                      <td className="py-2.5 px-4">{row.load_pct}%</td>
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
