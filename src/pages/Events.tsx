import React, { useState, useMemo } from 'react';
import {
  Bell,
  Search,
  Filter,
  Download,
  Trash2,
  RefreshCw,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Info,
  Check,
} from 'lucide-react';
import { EventLogRecord, EventSeverity } from '../lib/types';
import { getEventInfo } from '../lib/notifications';
import { api } from '../lib/tauri';
import { ConfirmModal } from '../components/ConfirmModal';

interface EventsProps {
  events: EventLogRecord[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Events: React.FC<EventsProps> = ({
  events,
  onRefresh,
  isRefreshing,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Filter & Search Logic
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // Severity filter
      if (filterSeverity !== 'all' && ev.severity !== filterSeverity) {
        return false;
      }
      // Keyword search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const info = getEventInfo(ev);
        const matchesType = ev.event_type.toLowerCase().includes(q);
        const matchesMsg = ev.message.toLowerCase().includes(q);
        const matchesTitle = info.title.toLowerCase().includes(q);
        const matchesDesc = info.description.toLowerCase().includes(q);
        const matchesPort = ev.port_name.toLowerCase().includes(q);
        return matchesType || matchesMsg || matchesTitle || matchesDesc || matchesPort;
      }
      return true;
    });
  }, [events, filterSeverity, searchQuery]);

  // Event statistics
  const stats = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let success = 0;
    let info = 0;
    for (const e of events) {
      if (e.severity === 'critical') critical++;
      else if (e.severity === 'warning') warning++;
      else if (e.severity === 'success') success++;
      else info++;
    }
    return { total: events.length, critical, warning, success, info };
  }, [events]);

  const handleConfirmClear = async () => {
    try {
      setIsClearing(true);
      await api.clearEvents();
      setShowClearConfirm(false);
      onRefresh();
    } catch (err) {
      console.error('Failed to clear events:', err);
    } finally {
      setIsClearing(false);
    }
  };

  const handleAcknowledge = async (id?: number) => {
    if (!id) return;
    try {
      await api.acknowledgeEvent(id);
      onRefresh();
    } catch (err) {
      console.error('Failed to acknowledge event:', err);
    }
  };

  const exportCsv = () => {
    const headers = 'ID,Timestamp,Port,Event_Type,Severity,Title,Description,Acknowledged\n';
    const rows = events
      .map((e) => {
        const info = getEventInfo(e);
        const cleanTitle = `"${info.title.replace(/"/g, '""')}"`;
        const cleanDesc = `"${info.description.replace(/"/g, '""')}"`;
        return `${e.id || ''},"${e.timestamp}","${e.port_name}","${e.event_type}","${e.severity}",${cleanTitle},${cleanDesc},${e.acknowledged ? 1 : 0}`;
      })
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voltwatch-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const getSeverityBadge = (severity: EventSeverity) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>CRITICAL</span>
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>WARNING</span>
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>SUCCESS</span>
          </span>
        );
      case 'info':
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            <Info className="w-3.5 h-3.5" />
            <span>INFO</span>
          </span>
        );
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-4rem)]">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-slate-800 rounded-xl text-cyan-400">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">Hardware Alarms & Events</h2>
            <p className="text-xs text-slate-400">
              Persistent event log and state transitions recorded directly from UPS hardware
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition border border-slate-700/60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={exportCsv}
            disabled={events.length === 0}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-xl text-xs font-medium transition border border-slate-700/60"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={events.length === 0 || isClearing}
            className="flex items-center space-x-1.5 px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 disabled:opacity-50 rounded-xl text-xs font-medium transition border border-rose-800/60 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear History</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
          <span className="text-xs text-slate-400 font-medium">Total Events</span>
          <p className="text-xl font-bold text-slate-100">{stats.total}</p>
        </div>
        <div className="bg-slate-900/80 border border-rose-900/30 rounded-xl p-3">
          <span className="text-xs text-rose-400 font-medium">Critical</span>
          <p className="text-xl font-bold text-rose-400">{stats.critical}</p>
        </div>
        <div className="bg-slate-900/80 border border-amber-900/30 rounded-xl p-3">
          <span className="text-xs text-amber-400 font-medium">Warnings</span>
          <p className="text-xl font-bold text-amber-400">{stats.warning}</p>
        </div>
        <div className="bg-slate-900/80 border border-emerald-900/30 rounded-xl p-3">
          <span className="text-xs text-emerald-400 font-medium">Recoveries</span>
          <p className="text-xl font-bold text-emerald-400">{stats.success}</p>
        </div>
        <div className="bg-slate-900/80 border border-cyan-900/30 rounded-xl p-3">
          <span className="text-xs text-cyan-400 font-medium">Info</span>
          <p className="text-xl font-bold text-cyan-400">{stats.info}</p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-3 rounded-2xl">
        {/* Severity Pills */}
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
          <span className="text-xs text-slate-400 flex items-center mr-1">
            <Filter className="w-3.5 h-3.5 mr-1" />
            Filter:
          </span>
          {(['all', 'critical', 'warning', 'success', 'info'] as const).map((sev) => (
            <button
              key={sev}
              onClick={() => setFilterSeverity(sev)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg capitalize transition ${
                filterSeverity === sev
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px] flex-1 sm:flex-initial">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events, ports, codes..."
            className="w-full bg-slate-800 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
          />
        </div>
      </div>

      {/* Events List / Cards */}
      {filteredEvents.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-12 text-center text-slate-400">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-30 text-cyan-400" />
          <p className="text-base font-semibold text-slate-300">No events found</p>
          <p className="text-xs text-slate-500 mt-1">
            {searchQuery || filterSeverity !== 'all'
              ? 'Try adjusting your filters or search terms.'
              : 'Hardware state transitions and alarms will appear here when detected.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredEvents.map((ev) => {
            const info = getEventInfo(ev);
            return (
              <div
                key={ev.id ?? `${ev.timestamp}-${ev.event_type}`}
                className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border transition ${
                  ev.severity === 'critical'
                    ? 'bg-rose-950/20 border-rose-900/40 hover:border-rose-700/60'
                    : ev.severity === 'warning'
                    ? 'bg-amber-950/20 border-amber-900/40 hover:border-amber-700/60'
                    : ev.severity === 'success'
                    ? 'bg-emerald-950/20 border-emerald-900/40 hover:border-emerald-700/60'
                    : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                } gap-3`}
              >
                <div className="flex items-start space-x-3 min-w-0">
                  <div className="mt-0.5">{getSeverityBadge(ev.severity)}</div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-100">{info.title}</span>
                      <span className="text-xs font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                        {ev.event_type}
                      </span>
                      <span className="text-xs text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                        {ev.port_name}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{info.description}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 shrink-0 self-end sm:self-center">
                  <span className="text-xs text-slate-400">
                    {new Date(ev.timestamp).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>

                  {!ev.acknowledged && ev.id && (
                    <button
                      onClick={() => handleAcknowledge(ev.id)}
                      title="Acknowledge event"
                      className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition border border-slate-700"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Ack</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bespoke Confirm Clear History Dialog */}
      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => !isClearing && setShowClearConfirm(false)}
        onConfirm={handleConfirmClear}
        isLoading={isClearing}
        itemCount={events.length}
        title="Clear Event History?"
        confirmLabel="Clear All Events"
        cancelLabel="Keep History"
        variant="danger"
        description={
          <p>
            Are you sure you want to permanently clear all stored event logs from the local database?
          </p>
        }
      />
    </div>
  );
};

