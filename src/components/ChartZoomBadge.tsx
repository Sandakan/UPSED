import React from 'react';
import { RotateCcw, ZoomIn } from 'lucide-react';

interface ChartZoomBadgeProps {
  isZoomed: boolean;
  zoomPercent: number;
  onReset: () => void;
  className?: string;
}

export const ChartZoomBadge: React.FC<ChartZoomBadgeProps> = ({
  isZoomed,
  zoomPercent,
  onReset,
  className = '',
}) => {
  if (!isZoomed) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono shadow-sm transition cursor-pointer select-none ${className}`}
      title="Click to reset zoom to full timeline. (Ctrl + Scroll to zoom, Drag to pan)"
    >
      <ZoomIn className="w-3 h-3 text-emerald-400" />
      <span className="font-semibold">{zoomPercent}%</span>
      <span className="text-slate-400 text-[9px]">• Reset</span>
      <RotateCcw className="w-2.5 h-2.5 ml-0.5 opacity-80" />
    </button>
  );
};
