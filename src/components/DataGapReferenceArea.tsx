import React from 'react';
import { ReferenceArea } from 'recharts';
import { DataGapInterval } from '../lib/dataGaps';

interface DataGapReferenceAreaProps {
  gap: DataGapInterval;
  xDataKey?: string;
  topPadding?: number;
  bottomPadding?: number;
}

const FullHeightDataGapShape: React.FC<any> = (props) => {
  const { x, y, width, height, gapDuration, topPadding = 24, bottomPadding = 12 } = props;
  if (typeof x !== 'number' || isNaN(x)) return null;

  const rawWidth = typeof width === 'number' && !isNaN(width) ? width : 0;
  const renderWidth = Math.max(rawWidth, 16);

  // Stretch across the Y-axis padding to reach the true top ceiling and bottom floor
  const topY = Math.max(0, (y ?? 0) - topPadding);
  const fullHeight = (height ?? 0) + topPadding + bottomPadding;
  const centerX = x + renderWidth / 2;
  const centerY = topY + fullHeight / 2;

  // Responsive centered label without heavy badge:
  // >= 110px: "No Data (5h 43m)"
  // 60px - 109px: "No Data"
  // < 60px: hidden to preserve chart clarity
  let displayText: string | null = null;
  if (renderWidth >= 110) {
    displayText = gapDuration ? `No Data (${gapDuration})` : 'No Data';
  } else if (renderWidth >= 60) {
    displayText = 'No Data';
  }

  const patternId = 'data-gap-diagonal-hatch';

  return (
    <g className="data-gap-highlight-band pointer-events-none">
      <defs>
        <pattern
          id={patternId}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="8"
            stroke="#64748b"
            strokeWidth="1"
            strokeDasharray="2 3"
            strokeOpacity="0.3"
          />
        </pattern>
      </defs>

      {/* Semi-transparent dark background fill */}
      <rect
        x={x}
        y={topY}
        width={renderWidth}
        height={fullHeight}
        fill="#0b0f19"
        fillOpacity={0.35}
      />

      {/* Subtle dashed diagonal hatch pattern texture */}
      <rect
        x={x}
        y={topY}
        width={renderWidth}
        height={fullHeight}
        fill={`url(#${patternId})`}
      />

      {/* Subtle dashed boundary lines */}
      <line
        x1={x}
        y1={topY}
        x2={x}
        y2={topY + fullHeight}
        stroke="#64748b"
        strokeOpacity={0.75}
        strokeDasharray="4 3"
        strokeWidth={1}
      />
      <line
        x1={x + renderWidth}
        y1={topY}
        x2={x + renderWidth}
        y2={topY + fullHeight}
        stroke="#64748b"
        strokeOpacity={0.75}
        strokeDasharray="4 3"
        strokeWidth={1}
      />

      {/* Clean centered text (no badge pill/border) */}
      {displayText && (
        <text
          x={centerX}
          y={centerY}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#94a3b8"
          fillOpacity={0.8}
          fontSize={10}
          fontWeight={500}
          fontFamily="monospace"
          letterSpacing="0.04em"
        >
          {displayText}
        </text>
      )}
    </g>
  );
};

export const DataGapReferenceArea: React.FC<DataGapReferenceAreaProps> = ({
  gap,
  xDataKey = 'xKey',
  topPadding = 24,
  bottomPadding = 12,
}) => {
  const x1 = xDataKey === 'xKey' ? gap.rawStart : gap.start;
  const x2 = xDataKey === 'xKey' ? gap.rawEnd : gap.end;

  return (
    <ReferenceArea
      x1={x1}
      x2={x2}
      ifOverflow="extendDomain"
      shape={(props: any) => (
        <FullHeightDataGapShape
          {...props}
          gapDuration={gap.formattedDuration}
          topPadding={topPadding}
          bottomPadding={bottomPadding}
        />
      )}
    />
  );
};
