import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface UseChartZoomOptions<T> {
  data: T[];
  minPoints?: number;
}

export interface UseChartZoomReturn<T> {
  containerRef: React.RefObject<HTMLDivElement | null>;
  visibleData: T[];
  isZoomed: boolean;
  zoomPercent: number;
  resetZoom: () => void;
  isDragging: boolean;
}

export function useChartZoom<T>({
  data,
  minPoints = 8,
}: UseChartZoomOptions<T>): UseChartZoomReturn<T> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoomRange, setZoomRange] = useState<{ start: number; end: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Keep ref to latest data length and zoomRange to avoid stale closures in event listeners
  const dataLenRef = useRef(data.length);
  dataLenRef.current = data.length;

  const zoomRangeRef = useRef(zoomRange);
  zoomRangeRef.current = zoomRange;

  // Reset or clamp zoom if data shrinks below the current range
  useEffect(() => {
    if (!zoomRange) return;
    if (data.length <= minPoints) {
      setZoomRange(null);
      return;
    }
    if (zoomRange.end >= data.length) {
      if (zoomRange.start >= data.length - minPoints) {
        setZoomRange(null);
      } else {
        setZoomRange({
          start: Math.max(0, zoomRange.start),
          end: data.length - 1,
        });
      }
    }
  }, [data.length, minPoints, zoomRange]);

  const resetZoom = useCallback(() => {
    setZoomRange(null);
  }, []);

  // Native non-passive wheel event listener to support Ctrl + Wheel zoom without browser page zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      const totalLen = dataLenRef.current;
      if (totalLen <= minPoints) return;

      const current = zoomRangeRef.current;
      const currentStart = current ? current.start : 0;
      const currentEnd = current ? current.end : totalLen - 1;
      const currentSpan = currentEnd - currentStart + 1;

      // 1. Ctrl / Cmd + Scroll -> Zoom In / Zoom Out
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        const rect = el.getBoundingClientRect();
        const mouseX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const fraction = rect.width > 0 ? mouseX / rect.width : 0.5;

        if (e.deltaY < 0) {
          // Zoom In
          const newSpan = Math.max(minPoints, Math.round(currentSpan * 0.72));
          if (newSpan >= currentSpan) return;

          const focusIdx = currentStart + fraction * currentSpan;
          let newStart = Math.round(focusIdx - fraction * newSpan);
          let newEnd = newStart + newSpan - 1;

          if (newStart < 0) {
            newStart = 0;
            newEnd = Math.min(totalLen - 1, newStart + newSpan - 1);
          } else if (newEnd >= totalLen) {
            newEnd = totalLen - 1;
            newStart = Math.max(0, newEnd - newSpan + 1);
          }

          setZoomRange({ start: newStart, end: newEnd });
        } else if (e.deltaY > 0) {
          // Zoom Out
          const newSpan = Math.round(currentSpan * 1.38);
          if (newSpan >= totalLen) {
            setZoomRange(null);
            return;
          }

          const focusIdx = currentStart + fraction * currentSpan;
          let newStart = Math.round(focusIdx - fraction * newSpan);
          let newEnd = newStart + newSpan - 1;

          if (newStart < 0) {
            newStart = 0;
            newEnd = Math.min(totalLen - 1, newStart + newSpan - 1);
          } else if (newEnd >= totalLen) {
            newEnd = totalLen - 1;
            newStart = Math.max(0, newEnd - newSpan + 1);
          }

          setZoomRange({ start: newStart, end: newEnd });
        }
        return;
      }

      // 2. Horizontal Scroll or Shift + Scroll -> Pan left / right when zoomed
      if (current && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
        e.preventDefault();
        const rawDelta = e.shiftKey ? e.deltaY : e.deltaX;
        const shiftPoints = Math.round((rawDelta / 20) * Math.max(1, Math.round(currentSpan / 50)));
        if (shiftPoints === 0) return;

        let newStart = currentStart + shiftPoints;
        let newEnd = currentEnd + shiftPoints;

        if (newStart < 0) {
          newStart = 0;
          newEnd = newStart + currentSpan - 1;
        } else if (newEnd >= totalLen) {
          newEnd = totalLen - 1;
          newStart = newEnd - currentSpan + 1;
        }

        setZoomRange({ start: newStart, end: newEnd });
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [minPoints]);

  // Click and drag to pan left/right when zoomed in
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startClientX = 0;
    let initialStart = 0;
    let initialEnd = 0;
    let dragging = false;

    const handleMouseDown = (e: MouseEvent) => {
      // Only drag on primary left click when actively zoomed
      if (e.button !== 0 || !zoomRangeRef.current) return;

      // Ignore clicks on buttons or interactive inputs
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('select') || target.closest('input')) return;

      dragging = true;
      startClientX = e.clientX;
      initialStart = zoomRangeRef.current.start;
      initialEnd = zoomRangeRef.current.end;
      setIsDragging(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragging) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;

        const deltaPixels = moveEvent.clientX - startClientX;
        const span = initialEnd - initialStart + 1;
        const totalLen = dataLenRef.current;
        const deltaPoints = Math.round((deltaPixels / rect.width) * span);

        let newStart = initialStart - deltaPoints;
        let newEnd = initialEnd - deltaPoints;

        if (newStart < 0) {
          newStart = 0;
          newEnd = newStart + span - 1;
        } else if (newEnd >= totalLen) {
          newEnd = totalLen - 1;
          newStart = newEnd - span + 1;
        }

        setZoomRange({ start: newStart, end: newEnd });
      };

      const handleMouseUp = () => {
        dragging = false;
        setIsDragging(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    };

    el.addEventListener('mousedown', handleMouseDown);
    return () => {
      el.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const isZoomed = Boolean(zoomRange && (zoomRange.end - zoomRange.start + 1 < data.length));

  const visibleData = useMemo(() => {
    if (!isZoomed || !zoomRange) return data;
    return data.slice(zoomRange.start, zoomRange.end + 1);
  }, [data, isZoomed, zoomRange]);

  const zoomPercent = useMemo(() => {
    if (!isZoomed || !zoomRange || data.length === 0) return 100;
    const span = zoomRange.end - zoomRange.start + 1;
    return Math.max(1, Math.round((span / data.length) * 100));
  }, [data.length, isZoomed, zoomRange]);

  return {
    containerRef,
    visibleData,
    isZoomed,
    zoomPercent,
    resetZoom,
    isDragging,
  };
}
