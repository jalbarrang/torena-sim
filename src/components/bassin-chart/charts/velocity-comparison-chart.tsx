import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  SkillSimulationData,
  SkillSimulationRun
} from '@/modules/simulation/compare.types';
import React from 'react';

const BASELINE_COLOR = '#2a77c5';
const TRACKED_COLOR = '#c52a2a';

/** Seconds of context shown before the first activation and after the last one. */
const WINDOW_LEAD_S = 5;
const WINDOW_TRAIL_S = 10;

const MAX_POINTS = 500;

type RunKey = 'minrun' | 'maxrun' | 'meanrun' | 'medianrun';

const RUN_OPTIONS: Array<{ key: RunKey; label: string }> = [
  { key: 'minrun', label: 'Min' },
  { key: 'maxrun', label: 'Max' },
  { key: 'meanrun', label: 'Mean' },
  { key: 'medianrun', label: 'Median' }
];

type ChartPoint = {
  t: number;
  baseline: number | null;
  tracked: number | null;
};

type ActivationWindow = { startTime: number; endTime: number };

/** Time at which the runner reaches `position`, from parallel position/time series. */
const timeAtPosition = (
  positions: Array<number>,
  times: Array<number>,
  position: number
): number | null => {
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] >= position) {
      return times[i];
    }
  }
  return null;
};

const buildChart = (run: SkillSimulationRun, skillId: string) => {
  const telemetry = run.telemetry;
  if (!telemetry || telemetry.tracked.velocity.length === 0) {
    return null;
  }

  const { baseline, tracked } = telemetry;

  // Activation windows of the tracked skill, converted from positions to times
  // on the tracked run's own series.
  const logs = run.sk[1][skillId] ?? [];
  const activations: Array<ActivationWindow> = [];
  for (const log of logs) {
    const startTime = timeAtPosition(tracked.position, tracked.time, log.start);
    if (startTime == null) continue;
    const endTime =
      log.end > log.start
        ? (timeAtPosition(tracked.position, tracked.time, log.end) ??
          tracked.time[tracked.time.length - 1])
        : startTime;
    activations.push({ startTime, endTime });
  }

  // Both runs share the master seed and tick cadence, so index i is the same
  // race time in both series (until the shorter one finishes).
  const length = Math.max(baseline.time.length, tracked.time.length);
  const raceEnd = Math.max(
    baseline.time[baseline.time.length - 1] ?? 0,
    tracked.time[tracked.time.length - 1] ?? 0
  );

  let windowStart = 0;
  let windowEnd = raceEnd;
  if (activations.length > 0) {
    windowStart = Math.max(0, Math.min(...activations.map((a) => a.startTime)) - WINDOW_LEAD_S);
    windowEnd = Math.min(raceEnd, Math.max(...activations.map((a) => a.endTime)) + WINDOW_TRAIL_S);
  }

  const points: Array<ChartPoint> = [];
  for (let i = 0; i < length; i++) {
    const t = tracked.time[i] ?? baseline.time[i];
    if (t < windowStart || t > windowEnd) continue;
    points.push({
      t,
      baseline: baseline.velocity[i] ?? null,
      tracked: tracked.velocity[i] ?? null
    });
  }

  const step = Math.ceil(points.length / MAX_POINTS);
  const sampled = step > 1 ? points.filter((_, i) => i % step === 0 || i === points.length - 1) : points;

  return { points: sampled, activations, windowStart, windowEnd };
};

type VelocityComparisonChartProps = {
  skillId: string;
  runData: SkillSimulationData;
};

export const VelocityComparisonChart = React.memo((props: VelocityComparisonChartProps) => {
  const { skillId, runData } = props;
  const [runKey, setRunKey] = useState<RunKey>('medianrun');

  const chart = useMemo(() => buildChart(runData[runKey], skillId), [runData, runKey, skillId]);

  if (!chart) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Velocity Comparison</h4>
        <div className="flex items-center gap-1">
          {RUN_OPTIONS.map((option) => (
            <Button
              key={option.key}
              variant={option.key === runKey ? 'secondary' : 'ghost'}
              size="xs"
              className={cn({ 'font-semibold': option.key === runKey })}
              onClick={() => setRunKey(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chart.points} margin={{ top: 10, right: 5, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={[chart.windowStart, chart.windowEnd]}
            tickFormatter={(value: number) => `${value.toFixed(0)}s`}
            stroke="var(--muted-foreground)"
            fontSize={11}
          />
          <YAxis
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => `${value.toFixed(1)}`}
            stroke="var(--muted-foreground)"
            fontSize={11}
            width={35}
            label={{
              value: 'm/s',
              angle: -90,
              position: 'insideLeft',
              fontSize: 10,
              fill: 'var(--muted-foreground)'
            }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const point = payload[0].payload as ChartPoint;
              return (
                <div className="bg-popover border rounded-md shadow-md p-2 text-xs space-y-0.5">
                  <div className="font-semibold">{Number(label).toFixed(1)}s</div>
                  {point.tracked != null && (
                    <div style={{ color: TRACKED_COLOR }}>
                      With skill: {point.tracked.toFixed(2)} m/s
                    </div>
                  )}
                  {point.baseline != null && (
                    <div style={{ color: BASELINE_COLOR }}>
                      Baseline: {point.baseline.toFixed(2)} m/s
                    </div>
                  )}
                </div>
              );
            }}
          />
          {chart.activations.map((activation, index) =>
            activation.endTime > activation.startTime ? (
              <ReferenceArea
                key={index}
                x1={activation.startTime}
                x2={activation.endTime}
                fill={TRACKED_COLOR}
                fillOpacity={0.08}
                stroke={TRACKED_COLOR}
                strokeOpacity={0.3}
                strokeDasharray="3 3"
              />
            ) : (
              <ReferenceLine
                key={index}
                x={activation.startTime}
                stroke={TRACKED_COLOR}
                strokeOpacity={0.5}
                strokeDasharray="3 3"
              />
            )
          )}
          <Line
            type="monotone"
            dataKey="baseline"
            name="Baseline"
            stroke={BASELINE_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="tracked"
            name="With skill"
            stroke={TRACKED_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ backgroundColor: BASELINE_COLOR }} />
            Baseline (without skill)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ backgroundColor: TRACKED_COLOR }} />
            With skill
          </span>
        </div>
        <span>Shaded region: skill active</span>
      </div>

      <div className="text-xs text-muted-foreground">
        Velocity of the same run with and without this skill, zoomed around its activation. Pick
        Min/Max/Mean/Median to inspect that representative run.
      </div>
    </div>
  );
});
