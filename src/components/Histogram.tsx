// @ts-expect-error d3 types are not typed
import * as d3 from 'd3'; // Keep for binning logic
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { ChartConfig } from '@/components/ui/chart';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

type HistogramProps = {
  data: Array<number>;
  className?: string;
  /** Optional vertical marker for a summary stat (e.g. the median), rendered at its bin. */
  marker?: { value: number; label: string };
};

const chartConfig = {
  count: {
    label: 'Count',
    color: '#2a77c5'
  }
} satisfies ChartConfig;

// Mirror resolveColor() in overview-tab: negative = blue, positive = red, zero = muted
const NEG_COLOR = '#2a77c5';
const POS_COLOR = '#c52a2a';
const ZERO_COLOR = '#6b7280';

const colorForBin = (x0?: number, x1?: number): string => {
  const mid = ((x0 ?? 0) + (x1 ?? 0)) / 2;
  if (mid < 0) return NEG_COLOR;
  if (mid > 0) return POS_COLOR;
  return ZERO_COLOR;
};

export const Histogram = ({ data, marker, className }: HistogramProps) => {
  // Calculate domain
  const domain: [number, number] =
    data[0] === 0 && data[data.length - 1] === 0
      ? [-1, 1]
      : [Math.min(0, Math.floor(data[0])), Math.ceil(data[data.length - 1])];

  // Use D3 for binning (recharts doesn't have built-in histogram binning)
  const bucketize = d3
    .bin<number, number>()
    .value((d: number) => d)
    .domain(domain)
    .thresholds(30);

  const buckets = bucketize(data);

  // Boundary bin closest to 0, used to anchor the zero reference line on the categorical axis
  const zeroBucket = buckets.find((bucket: d3.Bin<number, number>) => (bucket.x0 ?? 0) >= 0);
  const zeroRange = zeroBucket?.x0?.toFixed(1) ?? '';

  // Bin containing the marker value, used to anchor the stat marker on the categorical axis
  const markerBucket =
    marker == null
      ? undefined
      : buckets.find(
          (bucket: d3.Bin<number, number>) =>
            marker.value >= (bucket.x0 ?? -Infinity) && marker.value < (bucket.x1 ?? Infinity)
        );
  const markerRange = markerBucket?.x0?.toFixed(1) ?? '';

  // Transform buckets into recharts-compatible format
  const chartData = buckets.map((bucket: d3.Bin<number, number>) => ({
    range: bucket.x0?.toFixed(1) ?? '',
    count: bucket.length,
    x0: bucket.x0,
    x1: bucket.x1
  }));

  return (
    <ChartContainer config={chartConfig} className={cn('min-h-[100px] max-w-[600px]', className)}>
      <BarChart accessibilityLayer data={chartData}>
        <CartesianGrid vertical={false} />
        {zeroRange && (
          <ReferenceLine
            x={zeroRange}
            stroke={ZERO_COLOR}
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
        )}
        {marker && markerRange && (
          <ReferenceLine
            x={markerRange}
            stroke="var(--foreground)"
            strokeDasharray="4 2"
            label={{
              value: `${marker.label}: ${marker.value.toFixed(2)} L`,
              position: 'top',
              fontSize: 10,
              fill: 'var(--muted-foreground)'
            }}
          />
        )}
        <XAxis
          dataKey="range"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tick={{ fontSize: 10 }}
          interval="preserveStartEnd"
        />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                if (payload?.[0]?.payload) {
                  const { x0, x1 } = payload[0].payload;
                  return `Range: ${x0?.toFixed(2)} – ${x1?.toFixed(2)} lengths`;
                }

                return '';
              }}
            />
          }
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {chartData.map((d: { x0?: number; x1?: number }, i: number) => (
            <Cell key={i} fill={colorForBin(d.x0, d.x1)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
};
