import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { OutageInterval } from '../lib/types';
import { deriveVisibleOutageIntervals } from '../lib/outage';
import { detectDataGaps, injectGapAnchorPoints, deriveVisibleDataGaps } from '../lib/dataGaps';
import { formatChartAxisTimestamp, formatChartTooltipTimestamp } from '../lib/time';
import { useChartZoom } from '../lib/useChartZoom';
import { ChartZoomBadge } from './ChartZoomBadge';
import { OutageReferenceArea } from './OutageReferenceArea';
import { DataGapReferenceArea } from './DataGapReferenceArea';

export interface MetricDataPoint {
  time: string;
  xKey?: string;
  value: number;
  value2?: number;
  isOutage?: boolean;
}

interface MetricChartCardProps {
  title: string;
  icon: React.ReactNode;
  currentValue: string | number;
  unit: string;
  data: MetricDataPoint[];
  color?: string;
  color2?: string;
  name1?: string;
  name2?: string;
  domain?: [number | string, number | string];
  height?: number;
  showStats?: boolean;
  gradientId: string;
  statusBadge?: React.ReactNode;
  outageIntervals?: OutageInterval[];
  showOutageHighlights?: boolean;
  yAxisPadding?: { top: number; bottom: number };
}

const MetricChartCardComponent: React.FC<MetricChartCardProps> = ({
  title,
  icon,
  currentValue,
  unit,
  data,
  color = '#06b6d4',
  color2 = '#3b82f6',
  name1 = 'Value',
  name2,
  domain = ['auto', 'auto'],
  height = 180,
  showStats = true,
  gradientId,
  statusBadge,
  outageIntervals: _outageIntervals,
  showOutageHighlights = true,
  yAxisPadding = { top: 14, bottom: 8 },
}) => {
  const cardGaps = useMemo(() => {
    return detectDataGaps(data);
  }, [data]);

  const cardDataWithGaps = useMemo(() => {
    return injectGapAnchorPoints(data, cardGaps);
  }, [data, cardGaps]);

  const {
    containerRef,
    visibleData,
    isZoomed,
    zoomPercent,
    resetZoom,
    zoomIn,
    zoomOut,
    canZoomIn,
    isDragging,
  } = useChartZoom({ data: cardDataWithGaps, minPoints: 6 });

  const xDataKey = visibleData[0]?.xKey ? 'xKey' : 'time';

  const cardOutageIntervals = useMemo(() => {
    if (!showOutageHighlights) return [];
    return deriveVisibleOutageIntervals(visibleData);
  }, [visibleData, showOutageHighlights]);

  const visibleCardGaps = useMemo(() => {
    return deriveVisibleDataGaps(visibleData);
  }, [visibleData]);

  const isMultiDay = useMemo(() => {
    if (data.length < 2) return false;
    const first = data[0].xKey?.split('__')[0] || data[0].time;
    const last = data[data.length - 1].xKey?.split('__')[0] || data[data.length - 1].time;
    const t1 = Date.parse(first);
    const t2 = Date.parse(last);
    if (!isNaN(t1) && !isNaN(t2)) {
      return Math.abs(t2 - t1) > 24 * 60 * 60 * 1000;
    }
    return false;
  }, [data]);

  const stats = useMemo(() => {
    if (!data.length) return null;
    const values = data.map((d) => d.value).filter((v) => !isNaN(v));
    if (!values.length) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((acc, v) => acc + v, 0) / values.length;

    return {
      min: Number.isInteger(min) ? min : min.toFixed(1),
      max: Number.isInteger(max) ? max : max.toFixed(1),
      avg: avg.toFixed(1),
    };
  }, [data]);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between shadow-sm hover:border-slate-700/80 transition group min-w-0">
      {/* Top Header */}
      <div className="flex items-start justify-between gap-2 mb-2.5 min-w-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1.5 sm:p-2 rounded-xl bg-slate-800/90 border border-slate-700/50 text-slate-300 group-hover:text-cyan-400 group-hover:border-cyan-500/30 transition shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h4 className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 truncate" title={title}>
              {title}
            </h4>
            <div className="flex items-baseline space-x-1.5 mt-0.5 min-w-0">
              <span className="text-lg sm:text-xl font-bold font-mono text-slate-100 truncate">
                {currentValue}
              </span>
              <span className="text-xs font-medium text-slate-400 shrink-0">{unit}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <ChartZoomBadge
            isZoomed={isZoomed}
            zoomPercent={zoomPercent}
            onReset={resetZoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            canZoomIn={canZoomIn}
          />
          {statusBadge && <div>{statusBadge}</div>}
        </div>
      </div>

      {/* Summary Min / Avg / Max Strip */}
      {showStats && stats && (
        <div className="grid grid-cols-3 gap-1 py-1 px-2 mb-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 text-[10px] sm:text-[11px] font-mono">
          <div className="text-slate-400 min-w-0">
            <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-sans">Min</span>
            <span className="text-slate-300 font-semibold truncate block">{stats.min} <span className="text-[9px] text-slate-500 font-sans">{unit}</span></span>
          </div>
          <div className="text-slate-400 min-w-0">
            <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-sans">Avg</span>
            <span className="text-slate-300 font-semibold truncate block">{stats.avg} <span className="text-[9px] text-slate-500 font-sans">{unit}</span></span>
          </div>
          <div className="text-slate-400 min-w-0">
            <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-sans">Max</span>
            <span className="text-slate-300 font-semibold truncate block">{stats.max} <span className="text-[9px] text-slate-500 font-sans">{unit}</span></span>
          </div>
        </div>
      )}

      {/* Chart Canvas */}
      <div
        ref={containerRef}
        style={{ height }}
        className={`w-full min-w-0 relative select-none ${
          isZoomed ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        }`}
      >
        {visibleData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
            Awaiting telemetry samples...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visibleData} margin={{ top: 8, right: 8, left: -15, bottom: 4 }}>
              <defs>
                <linearGradient id={`${gradientId}-grad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.0} />
                </linearGradient>
                {name2 && (
                  <linearGradient id={`${gradientId}-grad2`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color2} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={color2} stopOpacity={0.0} />
                  </linearGradient>
                )}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis
                dataKey={xDataKey}
                stroke="#64748b"
                tick={{ fontSize: 9, fill: '#64748b' }}
                tickLine={false}
                minTickGap={35}
                tickFormatter={(val) => {
                  if (typeof val === 'string') {
                    if (val.includes('__gap')) return '';
                    if (val.includes('__')) {
                      const raw = val.split('__')[0];
                      return formatChartAxisTimestamp(raw, isMultiDay);
                    }
                  }
                  return val;
                }}
              />
              <YAxis
                stroke="#64748b"
                width={28}
                tick={{ fontSize: 9, fill: '#64748b' }}
                domain={domain as any}
                tickLine={false}
                axisLine={false}
                padding={yAxisPadding}
                allowDataOverflow={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const itemPayload = payload[0]?.payload;
                  const isOutage = itemPayload?.isOutage;
                  const isGap = itemPayload?.isGap;
                  const displayTime = typeof label === 'string' && label.includes('__')
                    ? formatChartTooltipTimestamp(label.split('__')[0])
                    : itemPayload?.time || label;
                  return (
                    <div
                      className="rounded-xl p-2.5 shadow-lg border text-xs"
                      style={{
                        backgroundColor: 'var(--card-bg, #161922)',
                        borderColor: isOutage ? 'rgba(239, 68, 68, 0.4)' : isGap ? 'rgba(100, 116, 139, 0.5)' : 'var(--card-border, rgba(255,255,255,0.1))',
                        color: 'var(--color-slate-100, #f8fafc)',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] text-slate-400 font-mono">{displayTime}</span>
                        {isOutage && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60">
                            Power Outage (Battery Mode)
                          </span>
                        )}
                        {isGap && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-800/90 text-slate-300 border border-slate-700/80">
                            No Data Recorded
                          </span>
                        )}
                      </div>
                      {isGap ? (
                        <div className="text-[11px] font-mono text-slate-400 py-0.5">
                          Monitoring Inactive ({itemPayload?.gapDuration || 'Data Gap'})
                        </div>
                      ) : (
                        payload.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                            <span style={{ color: item.color }}>{item.name}:</span>
                            <span className="font-semibold text-slate-100">
                              {item.value} {unit}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  );
                }}
              />
              {visibleCardGaps.map((gap, idx) => (
                <DataGapReferenceArea
                  key={`gap-${idx}`}
                  gap={gap}
                  xDataKey={xDataKey}
                  topPadding={yAxisPadding?.top ?? 14}
                  bottomPadding={yAxisPadding?.bottom ?? 8}
                />
              ))}
              {showOutageHighlights &&
                cardOutageIntervals.map((interval, idx) => (
                  <OutageReferenceArea
                    key={`outage-${idx}`}
                    interval={interval}
                    xDataKey={xDataKey}
                    topPadding={yAxisPadding?.top ?? 14}
                    bottomPadding={yAxisPadding?.bottom ?? 8}
                  />
                ))}
              <Area
                connectNulls={false}
                type="monotone"
                dataKey="value"
                name={name1}
                stroke={color}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#${gradientId}-grad)`}
                isAnimationActive={false}
              />
              {name2 && (
                <Area
                  connectNulls={false}
                  type="monotone"
                  dataKey="value2"
                  name={name2}
                  stroke={color2}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill={`url(#${gradientId}-grad2)`}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export const MetricChartCard = React.memo(MetricChartCardComponent, (prev, next) => {
  if (
    prev.currentValue !== next.currentValue ||
    prev.title !== next.title ||
    prev.height !== next.height ||
    prev.color !== next.color ||
    prev.unit !== next.unit ||
    prev.showStats !== next.showStats ||
    prev.gradientId !== next.gradientId ||
    prev.showOutageHighlights !== next.showOutageHighlights ||
    prev.outageIntervals !== next.outageIntervals
  ) {
    return false;
  }

  if (prev.data === next.data) return true;
  if (prev.data.length !== next.data.length) return false;
  if (prev.data.length === 0) return true;

  const prevLast = prev.data[prev.data.length - 1];
  const nextLast = next.data[next.data.length - 1];
  return (
    prevLast.time === nextLast.time &&
    prevLast.value === nextLast.value &&
    prevLast.value2 === nextLast.value2 &&
    prevLast.isOutage === nextLast.isOutage
  );
});
