import React from 'react';
import { ReferenceArea } from 'recharts';
import { OutageInterval } from '../lib/types';

interface OutageReferenceAreaProps {
  interval: OutageInterval;
  xDataKey?: string;
  topPadding?: number;
  bottomPadding?: number;
}

const FullHeightOutageShape: React.FC<any> = (props) => {
  const { x, y, width, height, labelText, topPadding = 24, bottomPadding = 12 } = props;
  if (typeof x !== 'number' || isNaN(x)) return null;

  // Guarantee at least 4px width so single-point or brief outages remain visible
  const rawWidth = typeof width === 'number' && !isNaN(width) ? width : 0;
  const renderWidth = Math.max(rawWidth, 4);

  // Stretch across the Y-axis padding to reach the true top ceiling and bottom floor
  const topY = Math.max(0, (y ?? 0) - topPadding);
  const fullHeight = (height ?? 0) + topPadding + bottomPadding;
  const showLabel = Boolean(labelText && renderWidth >= 36);

  return (
    <g className="outage-highlight-band pointer-events-none">
      <rect
        x={x}
        y={topY}
        width={renderWidth}
        height={fullHeight}
        fill="#ef4444"
        fillOpacity={0.18}
        stroke="#ef4444"
        strokeOpacity={0.45}
        strokeDasharray="3 3"
      />
      {showLabel && (
        <g>
          {/* Subtle dark backdrop pill for maximum text contrast */}
          <rect
            x={x + renderWidth / 2 - 44}
            y={topY + 4}
            width={88}
            height={16}
            rx={4}
            fill="#0f172a"
            fillOpacity={0.8}
            stroke="#ef4444"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
          <text
            x={x + renderWidth / 2}
            y={topY + 15}
            fill="#f87171"
            fontSize={9}
            fontWeight={600}
            textAnchor="middle"
          >
            {labelText}
          </text>
        </g>
      )}
    </g>
  );
};

export const OutageReferenceArea: React.FC<OutageReferenceAreaProps> = ({
  interval,
  xDataKey = 'xKey',
  topPadding = 24,
  bottomPadding = 12,
}) => {
  const labelText = interval.isActive ? 'Outage (Active)' : 'Power Outage';
  const x1 = xDataKey === 'xKey' ? (interval.rawStart || interval.start) : interval.start;
  const x2 = xDataKey === 'xKey' ? (interval.rawEnd || interval.end) : interval.end;

  return (
    <ReferenceArea
      x1={x1}
      x2={x2}
      ifOverflow="extendDomain"
      shape={(props: any) => (
        <FullHeightOutageShape
          {...props}
          labelText={labelText}
          topPadding={topPadding}
          bottomPadding={bottomPadding}
        />
      )}
    />
  );
};
