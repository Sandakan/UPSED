import React, { useMemo } from 'react';
import { area as d3Area, line as d3Line, curveMonotoneX } from 'd3-shape';

interface StatCardSparklineProps {
  data: number[];
  color?: string;
  gradientId: string;
  paddingY?: number;
}

const WIDTH = 200;
const HEIGHT = 60;
const MARGIN = { top: 6, right: 2, bottom: 2, left: 2 };

export const StatCardSparkline: React.FC<StatCardSparklineProps> = React.memo(({
  data,
  color = '#22c55e',
  gradientId,
  paddingY = 0.5,
}) => {
  const { linePath, areaPath } = useMemo(() => {
    if (!data || data.length < 2) {
      return { linePath: '', areaPath: '' };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const yMin = min - paddingY;
    const yMax = max + paddingY;
    const ySpan = Math.max(0.001, yMax - yMin);

    const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const count = data.length;

    const xScale = (i: number) => MARGIN.left + (i / (count - 1)) * plotWidth;
    const yScale = (v: number) => MARGIN.top + (1 - (v - yMin) / ySpan) * plotHeight;
    const baselineY = HEIGHT - MARGIN.bottom;

    const lineGenerator = d3Line<number>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d))
      .curve(curveMonotoneX);

    const areaGenerator = d3Area<number>()
      .x((_, i) => xScale(i))
      .y1((d) => yScale(d))
      .y0(baselineY)
      .curve(curveMonotoneX);

    return {
      linePath: lineGenerator(data) || '',
      areaPath: areaGenerator(data) || '',
    };
  }, [data, paddingY]);

  if (!linePath || !areaPath) return null;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="w-full h-full overflow-hidden block select-none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.4} />
          <stop offset="95%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});

