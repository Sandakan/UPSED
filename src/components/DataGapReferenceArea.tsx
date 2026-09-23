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
  const { x, y, width, height, labelText, topPadding = 24, bottomPadding = 12 } = props;
  if (typeof x !== 'number' || isNaN(x)) return null;

  const rawWidth = typeof width === 'number' && !isNaN(width) ? width : 0;
  const renderWidth = Math.max(rawWidth, 16);

  // Stretch across the Y-axis padding to reach the true top ceiling and bottom floor
  const topY = Math.max(0, (y ?? 0) - topPadding);
  const fullHeight = (height ?? 0) + topPadding + bottomPadding;
  const showLabel = Boolean(labelText && renderWidth >= 36);

  // Compact label if width is tight
  const displayLabel = renderWidth < 120
    ? labelText.replace('No Data Recorded', 'No Data').replace('Monitoring Inactive', 'Inactive')
    : labelText;

  const badgeWidth = Math.min(renderWidth - 8, Math.max(76, displayLabel.length * 6.5 + 24));
  const badgeX = x + renderWidth / 2 - badgeWidth / 2;

  return (
    <g className="data-gap-highlight-band pointer-events-none">
      {/* Semi-transparent slate background fill with reduced opacity */}
      <rect
        x={x}
        y={topY}
        width={renderWidth}
        height={fullHeight}
        fill="#1e293b"
        fillOpacity={0.22}
      />

      {/* Subtle dashed boundary lines with reduced opacity */}
      <line
        x1={x}
        y1={topY}
        x2={x}
        y2={topY + fullHeight}
        stroke="#64748b"
        strokeOpacity={0.85}
        strokeDasharray="4 3"
        strokeWidth={1}
      />
      <line
        x1={x + renderWidth}
        y1={topY}
        x2={x + renderWidth}
        y2={topY + fullHeight}
        stroke="#64748b"
        strokeOpacity={0.85}
        strokeDasharray="4 3"
        strokeWidth={1}
      />

      {/* Duration Badge Pill */}
      {showLabel && (
        <g>
          <rect
            x={badgeX}
            y={topY + 6}
            width={badgeWidth}
            height={18}
            rx={4}
            fill="#0f172a"
            fillOpacity={0.92}
            stroke="#475569"
            strokeOpacity={0.8}
            strokeWidth={1}
          />
          <circle cx={badgeX + 10} cy={topY + 15} r={3} fill="#94a3b8" opacity={0.8} />
          <text
            x={badgeX + 18 + (badgeWidth - 22) / 2}
            y={topY + 18}
            fill="#cbd5e1"
            fontSize={9}
            fontWeight={600}
            fontFamily="monospace"
            textAnchor="middle"
          >
            {displayLabel}
          </text>
        </g>
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
  const labelText = `No Data (${gap.formattedDuration})`;
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
          labelText={labelText}
          topPadding={topPadding}
          bottomPadding={bottomPadding}
        />
      )}
    />
  );
};
