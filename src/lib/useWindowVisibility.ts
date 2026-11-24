import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Tracks native window visibility and focus.
 * Returns true only when the window is visible, unminimized, and focused on screen.
 * Returns false when minimized, hidden to tray, unfocused (e.g. behind another window), or hidden in document.
 */
export function useWindowVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return !document.hidden && document.hasFocus();
    }
    return true;
  });

  useEffect(() => {
    let unlistenTauri: (() => void) | undefined;
    let isMounted = true;

    // 1. Query native window state on mount in case an early visibility/focus event fired before mount
    try {
      const win = getCurrentWebviewWindow();
      Promise.all([win.isVisible(), win.isMinimized(), win.isFocused()])
        .then(([visible, minimized, focused]) => {
          if (isMounted) {
            setIsVisible(visible && !minimized && focused && !document.hidden);
          }
        })
        .catch(() => {
          // Ignore when running outside Tauri webview (e.g. unit tests/browser)
        });
    } catch {
      // Ignore outside Tauri runtime
    }

    // 2. Webview document visibility and window focus/blur listeners
    const syncDomState = () => {
      setIsVisible(!document.hidden && document.hasFocus());
    };

    document.addEventListener('visibilitychange', syncDomState);
    window.addEventListener('focus', syncDomState);
    window.addEventListener('blur', syncDomState);

    // 3. Tauri native window visibility/focus event
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
      document.removeEventListener('visibilitychange', syncDomState);
      window.removeEventListener('focus', syncDomState);
      window.removeEventListener('blur', syncDomState);
      unlistenTauri?.();
    };
  }, []);

  return isVisible;
}
