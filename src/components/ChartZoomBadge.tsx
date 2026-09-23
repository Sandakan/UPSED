import React from 'react';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

interface ChartZoomBadgeProps {
  isZoomed: boolean;
  zoomPercent: number;
  onReset: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  canZoomIn?: boolean;
  className?: string;
}

export const ChartZoomBadge: React.FC<ChartZoomBadgeProps> = ({
  isZoomed,
  zoomPercent,
  onReset,
  onZoomIn,
  onZoomOut,
  canZoomIn = true,
  className = '',
}) => {
  return (
    <div
      className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-lg border text-[10px] font-mono select-none transition-colors ${
        isZoomed
          ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40 shadow-sm'
          : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:border-slate-700'
      } ${className}`}
      title="Zoom controls: Ctrl + Scroll to zoom in/out, Drag to pan timeline"
    >
      {onZoomOut && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onZoomOut();
          }}
          disabled={!isZoomed}
          className="p-0.5 rounded hover:bg-slate-700/60 transition cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed text-slate-400 hover:text-slate-100"
          title="Zoom Out (Ctrl + Scroll Down)"
        >
          <ZoomOut className="w-3 h-3" />
        </button>
      )}

      {isZoomed ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
          className="inline-flex items-center space-x-1 px-1 py-0.5 rounded hover:bg-emerald-500/20 text-emerald-400 font-semibold cursor-pointer transition"
          title="Reset zoom to 100%"
        >
          <span>{zoomPercent}%</span>
          <RotateCcw className="w-2.5 h-2.5 ml-0.5 opacity-80" />
        </button>
      ) : (
        <span className="px-1 text-[9px] font-medium text-slate-500">100%</span>
      )}

      {onZoomIn && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onZoomIn();
          }}
          disabled={!canZoomIn}
          className="p-0.5 rounded hover:bg-slate-700/60 transition cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed text-slate-400 hover:text-slate-100"
          title="Zoom In (Ctrl + Scroll Up)"
        >
          <ZoomIn className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
