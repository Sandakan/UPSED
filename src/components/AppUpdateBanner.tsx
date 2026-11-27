import React from 'react';
import { Download, RefreshCw, X, AlertCircle } from 'lucide-react';
import { AppUpdaterState } from '../lib/updater';

interface AppUpdateBannerProps {
  updater: AppUpdaterState;
}

export const AppUpdateBanner: React.FC<AppUpdateBannerProps> = ({ updater }) => {
  const { update, status, progress, error, dismissed, dismiss, installAndRelaunch } = updater;

  if (!update || dismissed) return null;

  const isDownloading = status === 'downloading' || status === 'ready';

  return (
    <div className="px-4 py-2 bg-emerald-950/70 border-b border-emerald-500/25 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex items-center space-x-2.5 min-w-0">
        <span className="inline-flex items-center justify-center p-1 rounded-lg bg-emerald-500/15 text-emerald-400 shrink-0">
          {isDownloading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : status === 'error' ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
        </span>
        <div className="min-w-0">
          <span className="font-semibold text-emerald-300">
            UPSED v{update.version} is available
          </span>
          {status === 'downloading' && (
            <span className="ml-2 text-slate-300 font-mono">
              Downloading... {progress.total > 0 ? `${progress.percent}%` : ''}
            </span>
          )}
          {status === 'ready' && (
            <span className="ml-2 text-emerald-200">Restarting to apply update...</span>
          )}
          {status === 'error' && error && (
            <span className="ml-2 text-rose-300 truncate">{error}</span>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0">
        <button
          type="button"
          onClick={() => void installAndRelaunch()}
          disabled={isDownloading}
          className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold transition cursor-pointer"
        >
          {isDownloading ? 'Updating...' : 'Update & Restart'}
        </button>
        {!isDownloading && (
          <button
            type="button"
            onClick={dismiss}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
            aria-label="Dismiss update notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
