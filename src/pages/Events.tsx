import React, { useState, useMemo } from 'react';
import {
  Search,
  Download,
  Trash2,
  RefreshCw,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Info,
  Check,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
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

const PAGE_SIZE = 10;

export const Events: React.FC<EventsProps> = ({
  events,
  onRefresh,
  isRefreshing,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [timeframe, setTimeframe] = useState<'all' | 'today' | 'week'>('all');
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Filter & Search Logic
  const filteredEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((ev) => {
      // Severity filter
      if (filterSeverity !== 'all' && ev.severity !== filterSeverity) {
        return false;
      }
      // Timeframe filter
      if (timeframe !== 'all') {
        const evTime = new Date(ev.timestamp).getTime();
        const diffHours = (now - evTime) / (1000 * 60 * 60);
        if (timeframe === 'today' && diffHours > 24) return false;
        if (timeframe === 'week' && diffHours > 168) return false;
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
  }, [events, filterSeverity, searchQuery, timeframe]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedEvents = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, safePage]);

  // Checkbox Selection
  const allCurrentSelected =
    paginatedEvents.length > 0 &&
    paginatedEvents.every((e) => e.id && selectedIds.has(e.id));

  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allCurrentSelected) {
      paginatedEvents.forEach((e) => e.id && next.delete(e.id));
    } else {
      paginatedEvents.forEach((e) => e.id && next.add(e.id));
    }
    setSelectedIds(next);
  };

  const toggleSelectOne = (id?: number) => {
    if (!id) return;
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleConfirmClear = async () => {
    try {
      setIsClearing(true);
      await api.clearEvents();
      setShowClearConfirm(false);
      setSelectedIds(new Set());
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
    const rows = filteredEvents
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
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-950/60 text-rose-400 border border-rose-600/40">
            <AlertOctagon className="w-3 h-3" />
            <span>Fault</span>
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-950/60 text-amber-400 border border-amber-600/40">
            <AlertTriangle className="w-3 h-3" />
            <span>Warning</span>
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-600/40">
            <CheckCircle2 className="w-3 h-3" />
            <span>Online</span>
          </span>
        );
      case 'info':
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-950/60 text-cyan-400 border border-cyan-600/40">
            <Info className="w-3 h-3" />
            <span>Info</span>
          </span>
        );
    }
  };

  return (
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto max-h-[calc(100vh-3.5rem)] custom-scrollbar min-w-0">
      {/* ── Section Title ────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-100 tracking-tight">
            Events List
          </h2>
          <p className="text-xs text-slate-400">
            Telemetry hardware transitions, warning codes, and power state events
          </p>
        </div>
      </div>

      {/* ── Toolbar: Filter Tabs & Actions (Reference Style) ── */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 min-w-0">
        {/* Left: Filter Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 xl:pb-0 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
          {[
            { id: 'all', label: 'All Events' },
            { id: 'critical', label: 'Critical / Fault' },
            { id: 'warning', label: 'Warnings' },
            { id: 'success', label: 'Recoveries' },
            { id: 'info', label: 'Informational' },
          ].map((tab) => {
            const isActive = filterSeverity === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setFilterSeverity(tab.id);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                  isActive
                    ? 'bg-[#22c55e] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-white/[0.06]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Right: Search, Timeframe, Export, Clear */}
        <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap gap-y-2 min-w-0">
          {/* Search Input */}
          <div className="relative flex-1 sm:flex-initial min-w-[140px] sm:min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search..."
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-green-500 transition"
            />
          </div>

          {/* Timeframe Dropdown */}
          <select
            value={timeframe}
            onChange={(e) => {
              setTimeframe(e.target.value as any);
              setCurrentPage(1);
            }}
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-green-500 cursor-pointer shrink-0"
          >
            <option value="all" className="bg-slate-900 text-slate-200">All Time</option>
            <option value="today" className="bg-slate-900 text-slate-200">Last 24 Hours</option>
            <option value="week" className="bg-slate-900 text-slate-200">Last 7 Days</option>
          </select>

          {/* Refresh button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition shrink-0"
            title="Refresh events"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* Export CSV Button */}
          <button
            onClick={exportCsv}
            disabled={filteredEvents.length === 0}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.04] disabled:opacity-40 transition shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">CSV</span>
          </button>

          {/* Clear History Button */}
          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={events.length === 0 || isClearing}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-rose-900/40 text-xs font-medium text-rose-400 hover:bg-rose-950/40 disabled:opacity-40 transition shrink-0"
            title="Clear all events from SQLite database"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Reference Style DataTable ────────────────────────── */}
      <div
        className="rounded-2xl border overflow-hidden shadow-sm"
        style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-xs">
            {/* Table Header */}
            <thead>
              <tr
                className="text-slate-400 font-medium"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <th className="py-3.5 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={allCurrentSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-700 bg-slate-900/80 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                </th>
                <th className="py-3.5 px-4 font-semibold">Device ID / Port</th>
                <th className="py-3.5 px-4 font-semibold">Timestamp</th>
                <th className="py-3.5 px-4 font-semibold">Event Type</th>
                <th className="py-3.5 px-4 font-semibold">Status</th>
                <th className="py-3.5 px-4 font-semibold">Title & Description</th>
                <th className="py-3.5 px-4 text-right font-semibold">Action</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-white/[0.04] text-slate-300">
              {paginatedEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No matching events recorded.
                  </td>
                </tr>
              ) : (
                paginatedEvents.map((ev) => {
                  const info = getEventInfo(ev);
                  const isChecked = ev.id ? selectedIds.has(ev.id) : false;
                  return (
                    <tr
                      key={ev.id ?? `${ev.timestamp}-${ev.event_type}`}
                      className="hover:bg-white/[0.02] transition"
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectOne(ev.id)}
                          className="rounded border-slate-700 bg-slate-900/80 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                      </td>

                      {/* Device ID / Port */}
                      <td
                        className="py-3 px-4 font-mono font-medium text-slate-200 whitespace-nowrap max-w-[150px] truncate"
                        title={ev.port_name}
                      >
                        {ev.port_name}
                      </td>

                      {/* Timestamp */}
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>

                      {/* Event Type Code */}
                      <td className="py-3 px-4 font-mono">
                        <span className="px-2 py-0.5 rounded text-[11px] bg-white/[0.05] text-slate-300 border border-white/[0.06]">
                          {ev.event_type}
                        </span>
                      </td>

                      {/* Status Pill */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {getSeverityBadge(ev.severity)}
                      </td>

                      {/* Title & Description */}
                      <td className="py-3 px-4 max-w-xs sm:max-w-md">
                        <span className="font-semibold text-slate-100 block truncate">
                          {info.title}
                        </span>
                        <span className="text-[11px] text-slate-400 block truncate">
                          {info.description}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {!ev.acknowledged && ev.id ? (
                          <button
                            onClick={() => handleAcknowledge(ev.id)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-400 rounded-lg text-xs transition border border-emerald-700/50"
                            title="Acknowledge alarm"
                          >
                            <Check className="w-3 h-3" />
                            <span>Ack</span>
                          </button>
                        ) : (
                          <button
                            className="p-1 text-slate-500 hover:text-slate-300 transition"
                            title="Event details"
                          >
                            <MoreHorizontal className="w-4 h-4 inline" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Table Pagination Footer (Reference Design) ────── */}
        <div
          className="flex items-center justify-between px-4 py-3 text-xs"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {/* Previous Button */}
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] disabled:opacity-30 disabled:pointer-events-none transition"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Previous</span>
          </button>

          {/* Page Indicators */}
          <div className="flex items-center space-x-1">
            {Array.from({ length: totalPages }).map((_, idx) => {
              const page = idx + 1;
              const isActive = page === safePage;
              // Show only first, last, and around current page
              if (
                totalPages > 6 &&
                page > 2 &&
                page < totalPages - 1 &&
                Math.abs(page - safePage) > 1
              ) {
                if (page === 3 || page === totalPages - 2) {
                  return (
                    <span key={page} className="px-1 text-slate-600">
                      …
                    </span>
                  );
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

          {/* Next Button */}
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
