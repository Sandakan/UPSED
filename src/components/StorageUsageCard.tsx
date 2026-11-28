import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HardDrive,
  RefreshCw,
  FolderOpen,
  Sparkles,
  Trash2,
  Database,
  FileText,
  Activity,
  Bell,
  Cpu,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/tauri';
import { useAuth } from '../lib/auth';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 100 || exp === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[exp]}`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

type PendingPruneAction =
  | { type: 'days'; days: number; label: string }
  | { type: 'all'; label: string }
  | { type: 'logs'; days: number; label: string }
  | null;

export const StorageUsageCard: React.FC = () => {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isPruning, setIsPruning] = useState(false);
  const [pendingPrune, setPendingPrune] = useState<PendingPruneAction>(null);

  const {
    data: stats,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['storageStats'],
    queryFn: () => api.getStorageStats(),
  });

  const dbBytes = stats?.file_size_bytes ?? 0;
  const walBytes = stats?.wal_size_bytes ?? 0;
  const logsBytes = stats?.logs_size_bytes ?? 0;
  const totalBytes = dbBytes + walBytes + logsBytes;

  const dbPct = totalBytes > 0 ? Math.round((dbBytes / totalBytes) * 100) : 0;
  const walPct = totalBytes > 0 ? Math.round((walBytes / totalBytes) * 100) : 0;
  const logsPct = totalBytes > 0 ? Math.max(0, 100 - dbPct - walPct) : 0;

  const refreshAll = async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['telemetryHistory'] }),
      queryClient.invalidateQueries({ queryKey: ['recentEvents'] }),
    ]);
  };

  const handleOpenFolder = async (kind: 'data' | 'logs') => {
    try {
      await api.openStorageFolder(kind);
    } catch (err: unknown) {
      toast.custom(
        JSON.stringify({
          title: 'Unable to Open Folder',
          description: err instanceof Error ? err.message : String(err),
          event: { severity: 'warning', event_type: 'STORAGE_OPEN_ERR', timestamp: new Date().toISOString() },
        })
      );
    }
  };

  const handleVacuum = async () => {
    setIsVacuuming(true);
    const before = totalBytes;
    try {
      await api.vacuumDatabase();
      const updated = await api.getStorageStats();
      queryClient.setQueryData(['storageStats'], updated);
      const after = updated.file_size_bytes + updated.wal_size_bytes + updated.logs_size_bytes;
      const freed = Math.max(0, before - after);
      toast.custom(
        JSON.stringify({
          title: 'Database Compacted',
          description:
            freed > 0
              ? `SQLite VACUUM completed and reclaimed ${formatBytes(freed)}.`
              : 'SQLite VACUUM and query optimization completed.',
          event: { severity: 'info', event_type: 'DB_VACUUM', timestamp: new Date().toISOString() },
        })
      );
    } catch (err: unknown) {
      toast.custom(
        JSON.stringify({
          title: 'Compact Failed',
          description: err instanceof Error ? err.message : String(err),
          event: { severity: 'critical', event_type: 'DB_VACUUM_ERR', timestamp: new Date().toISOString() },
        })
      );
    } finally {
      setIsVacuuming(false);
    }
  };

  const executePrune = async (action: NonNullable<PendingPruneAction>) => {
    setPendingPrune(null);
    await auth.requireAuth(async () => {
      setIsPruning(true);
      try {
        if (action.type === 'logs') {
          const res = await api.clearOldLogs(action.days);
          await refreshAll();
          toast.custom(
            JSON.stringify({
              title: 'Old Logs Cleared',
              description:
                res.deleted_files > 0
                  ? `Removed ${res.deleted_files} log file(s) and freed ${formatBytes(res.freed_bytes)} (active today's log preserved).`
                  : 'No older log files found to remove (active today’s log is preserved).',
              event: { severity: 'info', event_type: 'LOGS_PRUNE', timestamp: new Date().toISOString() },
            })
          );
        } else {
          const deleted =
            action.type === 'days'
              ? await api.pruneTelemetry(action.days)
              : await api.clearTelemetry();
          await api.vacuumDatabase();
          await refreshAll();
          toast.custom(
            JSON.stringify({
              title: 'Telemetry History Pruned',
              description: `Removed ${deleted.toLocaleString()} telemetry records (${action.label}) and compacted the database.`,
              event: { severity: 'info', event_type: 'DB_PRUNE', timestamp: new Date().toISOString() },
            })
          );
        }
      } catch (err: unknown) {
        toast.custom(
          JSON.stringify({
            title: 'Cleanup Failed',
            description: err instanceof Error ? err.message : String(err),
            event: { severity: 'critical', event_type: 'DB_PRUNE_ERR', timestamp: new Date().toISOString() },
          })
        );
      } finally {
        setIsPruning(false);
      }
    });
  };

  return (
    <div
      className="rounded-2xl p-5 border space-y-4"
      style={{
        backgroundColor: 'var(--card-bg)',
        borderColor: 'var(--card-border)',
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5 text-slate-200">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <HardDrive className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-100">Storage Usage &amp; Maintenance</h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Inspect SQLite database footprint, telemetry record counts, and diagnostic logs.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="px-2.5 py-1 rounded-full text-xs font-mono font-semibold bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
            {isLoading ? '...' : formatBytes(totalBytes)}
          </span>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer disabled:opacity-50"
            title="Refresh storage stats"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Breakdown Bar */}
      <div className="space-y-2">
        <div className="w-full h-2.5 rounded-full bg-slate-900/90 border border-white/[0.06] overflow-hidden flex">
          {totalBytes > 0 ? (
            <>
              {dbPct > 0 && (
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${dbPct}%` }}
                  title={`Database (upsed.db): ${formatBytes(dbBytes)}`}
                />
              )}
              {walPct > 0 && (
                <div
                  className="h-full bg-amber-400 transition-all duration-300"
                  style={{ width: `${walPct}%` }}
                  title={`Write-Ahead Log (upsed.db-wal): ${formatBytes(walBytes)}`}
                />
              )}
              {logsPct > 0 && (
                <div
                  className="h-full bg-cyan-400 transition-all duration-300"
                  style={{ width: `${logsPct}%` }}
                  title={`App Logs: ${formatBytes(logsBytes)}`}
                />
              )}
            </>
          ) : (
            <div className="h-full w-full bg-slate-800/50" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Database:</span>
            <strong className="font-mono text-slate-200">{formatBytes(dbBytes)}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>WAL Journal:</span>
            <strong className="font-mono text-slate-200">{formatBytes(walBytes)}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span>Logs:</span>
            <strong className="font-mono text-slate-200">{formatBytes(logsBytes)}</strong>
          </span>
        </div>
      </div>

      {/* Record Counts Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Telemetry Rows</span>
          </div>
          <p className="text-base font-mono font-bold text-white">
            {(stats?.telemetry_count ?? 0).toLocaleString()}
          </p>
        </div>

        <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>Events Logged</span>
          </div>
          <p className="text-base font-mono font-bold text-white">
            {(stats?.events_count ?? 0).toLocaleString()}
          </p>
        </div>

        <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>UPS Profiles</span>
          </div>
          <p className="text-base font-mono font-bold text-white">
            {(stats?.profiles_count ?? 0).toLocaleString()}
          </p>
        </div>

        <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <span>Log Files</span>
          </div>
          <p className="text-base font-mono font-bold text-white">
            {(stats?.log_files_count ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Telemetry Time Span */}
      <div className="px-3.5 py-2.5 rounded-xl border border-white/[0.06] bg-black/20 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>
          Oldest Telemetry:{' '}
          <strong className="font-mono text-slate-200">{formatDate(stats?.oldest_telemetry)}</strong>
        </span>
        <span>
          Latest Telemetry:{' '}
          <strong className="font-mono text-slate-200">{formatDate(stats?.newest_telemetry)}</strong>
        </span>
      </div>

      {/* Confirmation Banner for Prune */}
      {pendingPrune && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              {pendingPrune.type === 'logs'
                ? `Delete ${pendingPrune.label}? Today's active log file will be preserved.`
                : `Delete telemetry records (${pendingPrune.label}) and compact the database?`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPendingPrune(null)}
              className="px-3 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void executePrune(pendingPrune)}
              className="px-3 py-1 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition cursor-pointer flex items-center gap-1.5"
            >
              {!auth.status?.authenticated && <Lock className="w-3 h-3" />}
              <span>Confirm Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Maintenance Actions */}
      <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleOpenFolder('data')}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition cursor-pointer flex items-center gap-1.5"
            title={stats?.data_dir}
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span>Open Data Folder</span>
          </button>

          <button
            type="button"
            onClick={() => void handleOpenFolder('logs')}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition cursor-pointer flex items-center gap-1.5"
            title={stats?.log_dir}
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Open Logs Folder</span>
          </button>

          <button
            type="button"
            onClick={() => void handleVacuum()}
            disabled={isVacuuming || isPruning}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-300 hover:text-white bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isVacuuming ? 'animate-spin' : ''}`} />
            <span>{isVacuuming ? 'Compacting...' : 'Compact DB'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPendingPrune({ type: 'logs', days: 0, label: 'all old log files' })}
            disabled={isPruning || (stats?.log_files_count ?? 0) <= 1}
            className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 transition cursor-pointer disabled:opacity-40 flex items-center gap-1"
            title="Delete archived log files while keeping today's active log"
          >
            {!auth.status?.authenticated && <Lock className="w-3 h-3" />}
            <span>Clear Old Logs</span>
          </button>

          <button
            type="button"
            onClick={() => setPendingPrune({ type: 'days', days: 90, label: 'older than 90 days' })}
            disabled={isPruning || (stats?.telemetry_count ?? 0) === 0}
            className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 transition cursor-pointer disabled:opacity-40 flex items-center gap-1"
          >
            {!auth.status?.authenticated && <Lock className="w-3 h-3" />}
            <span>Prune &gt; 90d</span>
          </button>

          <button
            type="button"
            onClick={() => setPendingPrune({ type: 'days', days: 30, label: 'older than 30 days' })}
            disabled={isPruning || (stats?.telemetry_count ?? 0) === 0}
            className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 transition cursor-pointer disabled:opacity-40 flex items-center gap-1"
          >
            {!auth.status?.authenticated && <Lock className="w-3 h-3" />}
            <span>Prune &gt; 30d</span>
          </button>

          <button
            type="button"
            onClick={() => setPendingPrune({ type: 'all', label: 'all telemetry records' })}
            disabled={isPruning || (stats?.telemetry_count ?? 0) === 0}
            className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-rose-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 transition cursor-pointer disabled:opacity-40 flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear All</span>
          </button>
        </div>
      </div>
    </div>
  );
};
