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

export interface MetricDataPoint {
  time: string;
  value: number;
  value2?: number;
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
}

export const MetricChartCard: React.FC<MetricChartCardProps> = ({
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
}) => {
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

        {statusBadge && <div className="shrink-0">{statusBadge}</div>}
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
      <div style={{ height }} className="w-full min-w-0">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
            Awaiting telemetry samples...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 8, left: -15, bottom: 0 }}>
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
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} minTickGap={35} />
              <YAxis
                stroke="#64748b"
                width={28}
                tick={{ fontSize: 9, fill: '#64748b' }}
                domain={domain as any}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#334155',
                  borderRadius: '0.75rem',
                  fontSize: '11px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                }}
                labelStyle={{ color: '#94a3b8', marginBottom: '2px' }}
              />
              <Area
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
