import { useState, useEffect, useCallback, useRef } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdaterProgress {
  downloaded: number;
  total: number;
  percent: number;
}

export interface AppUpdaterState {
  status: UpdaterStatus;
  update: Update | null;
  progress: UpdaterProgress;
  error: string | null;
  dismissed: boolean;
  dismiss: () => void;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  installAndRelaunch: () => Promise<void>;
}

export function useAppUpdater(): AppUpdaterState {
  const [status, setStatus] = useState<UpdaterStatus>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<UpdaterProgress>({
    downloaded: 0,
    total: 0,
    percent: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checkingRef = useRef(false);

  const checkForUpdates = useCallback(async (manual = false) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setStatus('checking');
    setError(null);

    try {
      const available = await check();
      if (available) {
        setUpdate(available);
        setDismissed(false);
        setStatus('available');
      } else {
        setUpdate(null);
        setStatus(manual ? 'up-to-date' : 'idle');
      }
    } catch (err: unknown) {
      if (manual) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      } else {
        setStatus('idle');
      }
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const installAndRelaunch = useCallback(async () => {
    if (!update) return;
    setStatus('downloading');
    setError(null);
    setProgress({ downloaded: 0, total: 0, percent: 0 });

    let downloadedBytes = 0;
    let totalBytes = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? 0;
          setProgress({ downloaded: 0, total: totalBytes, percent: 0 });
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          const percent =
            totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          setProgress({ downloaded: downloadedBytes, total: totalBytes, percent });
        } else if (event.event === 'Finished') {
          setProgress({ downloaded: totalBytes, total: totalBytes, percent: 100 });
        }
      });

      setStatus('ready');
      await relaunch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [update]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdates(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  return {
    status,
    update,
    progress,
    error,
    dismissed,
    dismiss: () => setDismissed(true),
    checkForUpdates,
    installAndRelaunch,
  };
}
