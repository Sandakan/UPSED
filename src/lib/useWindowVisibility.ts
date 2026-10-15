import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

/**
 * Tracks native window and document visibility.
 * Returns true when the window is visible and unminimized on screen.
 * Returns false when minimized to the taskbar, hidden to tray, or hidden in document.
 */
export function useWindowVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return !document.hidden;
    }
    return true;
  });

  useEffect(() => {
    let unlistenTauri: (() => void) | undefined;
    let isMounted = true;

    // 1. Webview document visibility change
    const handleDocVisibility = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleDocVisibility);

    // 2. Tauri native window visibility event (emitted on minimize, tray hide, and restore)
    listen<boolean>('app-window-visibility', (event) => {
      if (isMounted) {
        setIsVisible(event.payload);
      }
    }).then((fn) => {
      if (!isMounted) {
        fn();
      } else {
        unlistenTauri = fn;
      }
    });

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleDocVisibility);
      unlistenTauri?.();
    };
  }, []);

  return isVisible;
}
