import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
} from 'lucide-react';
import { EventLogRecord, EventSeverity } from '../lib/types';
import { getEventInfo } from '../lib/notifications';
import { formatTableTimestamp } from '../lib/time';
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
  const { t } = useTranslation(['events', 'common']);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [timeframe, setTimeframe] = useState<'all' | 'today' | 'week'>('all');
  const [isClearing, setIsClearing] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const unreadCount = useMemo(() => events.filter((e) => !e.acknowledged).length, [events]);

  const severityCounts = useMemo(() => {
    const counts = {
      all: events.length,
      critical: 0,
      warning: 0,
      success: 0,
      info: 0,
    };
    for (const ev of events) {
      if (ev.severity === 'critical') counts.critical++;
      else if (ev.severity === 'warning') counts.warning++;
      else if (ev.severity === 'success') counts.success++;
      else if (ev.severity === 'info') counts.info++;
    }
    return counts;
  }, [events]);

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

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || isMarkingAllRead) return;
    try {
      setIsMarkingAllRead(true);
      await api.acknowledgeAllEvents();
      onRefresh();
    } catch (err) {
      console.error('Failed to mark all events as read:', err);
    } finally {
      setIsMarkingAllRead(false);
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
    a.download = `upsed-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const getSeverityBadge = (severity: EventSeverity) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-950/60 text-rose-400 border border-rose-600/40">
            <AlertOctagon className="w-3 h-3" />
            <span>{t('events:badges.critical', 'Fault')}</span>
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-950/60 text-amber-400 border border-amber-600/40">
            <AlertTriangle className="w-3 h-3" />
            <span>{t('events:badges.warning', 'Warning')}</span>
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-600/40">
            <CheckCircle2 className="w-3 h-3" />
            <span>{t('events:badges.success', 'Online')}</span>
          </span>
        );
      case 'info':
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-950/60 text-cyan-400 border border-cyan-600/40">
            <Info className="w-3 h-3" />
            <span>{t('events:badges.info', 'Info')}</span>
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
            {t('events:title', 'Events List')}
          </h2>
          <p className="text-xs text-slate-400">
            {t('events:subtitle', 'Telemetry hardware transitions, warning codes, and power state events')}
          </p>
        </div>
      </div>

      {/* ── Two-Tier Toolbar ── */}
      <div className="space-y-3 min-w-0">
        {/* Tier 1: Severity Filter Pills with Live Counts */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0">
          {[
            { id: 'all', label: t('events:filterTabs.all', 'All Events'), count: severityCounts.all },
            { id: 'critical', label: t('events:filterTabs.critical', 'Critical / Fault'), count: severityCounts.critical },
            { id: 'warning', label: t('events:filterTabs.warning', 'Warnings'), count: severityCounts.warning },
            { id: 'success', label: t('events:filterTabs.success', 'Recoveries'), count: severityCounts.success },
            { id: 'info', label: t('events:filterTabs.info', 'Informational'), count: severityCounts.info },
          ].map((tab) => {
            const isActive = filterSeverity === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setFilterSeverity(tab.id);
                  setCurrentPage(1);
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-[#22c55e] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-white/[0.06]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-semibold ${
                    isActive
                      ? 'bg-black/25 text-white'
                      : 'bg-white/[0.06] text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tier 2: Search, Timeframe & Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 min-w-0">
          {/* Left: Search & Timeframe */}
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            {/* Search Input */}
            <div className="relative flex-1 max-w-sm sm:max-w-md min-w-[140px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder={t('events:searchPlaceholder', 'Search events, port, warnings, codes...')}
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
              <option value="all" className="bg-slate-900 text-slate-200">{t('events:timeframe.all', 'All Time')}</option>
              <option value="today" className="bg-slate-900 text-slate-200">{t('events:timeframe.today', 'Last 24 Hours')}</option>
              <option value="week" className="bg-slate-900 text-slate-200">{t('events:timeframe.week', 'Last 7 Days')}</option>
            </select>
          </div>

          {/* Right: Actions Group */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0 justify-end">
            {/* Refresh button */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition shrink-0 cursor-pointer"
              title={t('common:buttons.refresh', 'Refresh')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            {/* Mark All Read Button */}
            <button
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0 || isMarkingAllRead}
              className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-medium transition shrink-0 cursor-pointer ${
                unreadCount > 0
                  ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 hover:text-emerald-200 shadow-sm'
                  : 'border-white/[0.08] text-slate-500 opacity-40 cursor-not-allowed'
              }`}
              title={t('events:markAllRead', 'Mark All Read')}
            >
              <CheckCheck className={`w-3.5 h-3.5 shrink-0 ${isMarkingAllRead ? 'animate-pulse' : 'text-emerald-400'}`} />
              <span className="hidden md:inline">{t('events:markAllRead', 'Mark All Read')}</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Export CSV Button */}
            <button
              onClick={exportCsv}
              disabled={filteredEvents.length === 0}
              className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.04] disabled:opacity-40 transition shrink-0 cursor-pointer"
              title={t('common:buttons.exportCsv', 'Export CSV')}
            >
              <Download className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="hidden md:inline">{t('common:buttons.exportCsv', 'Export CSV')}</span>
            </button>

            {/* Clear History Button */}
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={events.length === 0 || isClearing}
              className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-rose-900/40 text-xs font-medium text-rose-400 hover:bg-rose-950/40 disabled:opacity-40 transition shrink-0 cursor-pointer"
              title={t('events:clearHistory', 'Clear History')}
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">{t('events:clearHistory', 'Clear History')}</span>
            </button>
          </div>
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
                <th className="py-3.5 px-4 font-semibold">{t('events:tableHeaders.port', 'Device ID / Port')}</th>
                <th className="py-3.5 px-4 font-semibold">{t('events:tableHeaders.timestamp', 'Timestamp')}</th>
                <th className="py-3.5 px-4 font-semibold">{t('events:tableHeaders.eventCode', 'Event Type')}</th>
                <th className="py-3.5 px-4 font-semibold">{t('events:tableHeaders.severity', 'Status')}</th>
                <th className="py-3.5 px-4 font-semibold">{t('events:tableHeaders.titleDesc', 'Title & Description')}</th>
                <th className="py-3.5 px-4 text-right font-semibold">{t('events:tableHeaders.action', 'Action')}</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-white/[0.04] text-slate-300">
              {paginatedEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    {t('events:empty', 'No matching events recorded.')}
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
                      <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                        {formatTableTimestamp(ev.timestamp)}
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
                            title={t('events:actions.ack', 'Acknowledge alarm')}
                          >
                            <Check className="w-3 h-3" />
                            <span>{t('events:actions.ack', 'Ack')}</span>
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
            <span>{t('events:pagination.prev', 'Previous')}</span>
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
            <span>{t('events:pagination.next', 'Next')}</span>
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
        title={t('events:clearHistoryTitle', 'Clear Event History?')}
        confirmLabel={t('events:clearHistory', 'Clear All Events')}
        cancelLabel={t('common:buttons.cancel', 'Keep History')}
        variant="danger"
        description={
          <p>
            {t('events:clearHistoryConfirm', 'Are you sure you want to permanently clear all stored event logs from the local database?')}
          </p>
        }
      />
    </div>
  );
};
