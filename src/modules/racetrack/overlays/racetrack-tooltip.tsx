import { useCallback, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { SimulationRun } from '@/modules/simulation/compare.types';
import { useRaceTrackDisplay } from '@/store/settings.store';
import { binSearch } from '@/utils/algorithims';
import { RaceTrackDimensions } from '../types';

export type TooltipData = {
  v1Text: string | null;
  v2Text: string | null;
  gapText: string | null;
};

type RaceTrackTooltipProps = {
  chartData: SimulationRun;
  course: CourseData;
  ref?: Ref<RaceTrackTooltipHandle>;
};

export type RaceTrackTooltipHandle = {
  updateFromPositionRatio: (positionRatio: number) => void;
  hide: () => void;
};

export function RaceTrackTooltip(props: RaceTrackTooltipProps) {
  const { chartData, course, ref } = props;
  const { showVelocityUma1, showVelocityUma2 } = useRaceTrackDisplay();
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const lastIndicesRef = useRef<{ i0: number; i1: number } | null>(null);

  const updateFromPositionRatio = useCallback(
    (positionRatio: number) => {
      if (chartData == null) return;

      const x = positionRatio * course.distance;
      const i0 = binSearch(chartData.position[0], x);
      const i1 = binSearch(chartData.position[1], x);
      const safeI0 = Math.max(0, Math.min(i0, chartData.velocity[0].length - 1));
      const safeI1 = Math.max(0, Math.min(i1, chartData.velocity[1].length - 1));
      const t1 = chartData.time[0][safeI0];
      const t2 = chartData.time[1][safeI1];

      if (t1 == null || t2 == null) return;

      const last = lastIndicesRef.current;
      if (last && last.i0 === safeI0 && last.i1 === safeI1) {
        return;
      }
      lastIndicesRef.current = { i0: safeI0, i1: safeI1 };

      const v1 = chartData.velocity[0][safeI0];
      const hp1 = chartData.hp[0][safeI0];
      const v2 = chartData.velocity[1][safeI1];
      const hp2 = chartData.hp[1][safeI1];
      // Per-tick race rank (1-based; 0 = untracked, e.g. legacy results).
      const rank1 = chartData.order?.[0]?.[safeI0] ?? 0;
      const rank2 = chartData.order?.[1]?.[safeI1] ?? 0;
      const rank1Text = rank1 > 0 ? ` P${rank1}` : '';
      const rank2Text = rank2 > 0 ? ` P${rank2}` : '';
      const v1Text = showVelocityUma1
        ? `${v1.toFixed(2)}m/s t=${t1.toFixed(2)}s${rank1Text} (${hp1.toFixed(0)} HP remaining)`
        : null;
      const v2Text = showVelocityUma2
        ? `${v2.toFixed(2)}m/s t=${t2.toFixed(2)}s${rank2Text} (${hp2.toFixed(0)} HP remaining)`
        : null;

      // Head-to-head standing at the observed tick: when the LEADER passes
      // the hovered distance, how far back is the other runner? (1 length =
      // 2.5m, same conversion as the bashin delta.)
      let gapText: string | null = null;
      if (showVelocityUma1 && showVelocityUma2) {
        const leader = t1 <= t2 ? 0 : 1;
        const trailer = 1 - leader;
        const tLead = Math.min(t1, t2);
        const trailerIdx = Math.max(
          0,
          Math.min(binSearch(chartData.time[trailer], tLead), chartData.position[trailer].length - 1)
        );
        const trailerPos = chartData.position[trailer][trailerIdx];
        if (trailerPos != null) {
          const gapMeters = Math.max(0, x - trailerPos);
          const gapLengths = gapMeters / 2.5;
          const leaderName = leader === 0 ? 'A' : 'B';
          gapText =
            gapMeters < 0.05
              ? 'Even at this point'
              : `${leaderName} leads by ${gapLengths.toFixed(1)}L (${gapMeters.toFixed(1)}m)`;
        }
      }

      setTooltipData((prev) => {
        if (prev?.v1Text === v1Text && prev?.v2Text === v2Text && prev?.gapText === gapText) {
          return prev;
        }
        return { v1Text, v2Text, gapText };
      });
    },
    [chartData, course.distance, showVelocityUma1, showVelocityUma2]
  );

  const hide = useCallback(() => {
    setTooltipData(null);
    lastIndicesRef.current = null;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      updateFromPositionRatio,
      hide
    }),
    [updateFromPositionRatio, hide]
  );

  if (!tooltipData) {
    return null;
  }

  const lines = [tooltipData.v1Text, tooltipData.v2Text, tooltipData.gapText].filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const rectHeight = 8 + lines.length * 11;
  const gapY = 12 + (tooltipData.v1Text ? 11 : 0) + (tooltipData.v2Text ? 11 : 0);

  return (
    <svg
      id="racetrack-tooltip"
      x={RaceTrackDimensions.xOffset + 10}
      y={6}
      width={RaceTrackDimensions.RenderWidth}
      height={RaceTrackDimensions.yAxisHeight}
      overflow="visible"
    >
      <rect
        x={0}
        y={0}
        width={160}
        height={rectHeight}
        fill="var(--background)"
        stroke="var(--border)"
        strokeWidth="1"
      />
      {tooltipData.v1Text && (
        <text x={5} y={12} fill="#2a77c5" fontSize="8px">
          {tooltipData.v1Text}
        </text>
      )}
      {tooltipData.v2Text && (
        <text x={5} y={tooltipData.v1Text ? 23 : 12} fill="#c52a2a" fontSize="8px">
          {tooltipData.v2Text}
        </text>
      )}
      {tooltipData.gapText && (
        <text x={5} y={gapY} fill="var(--muted-foreground)" fontSize="8px">
          {tooltipData.gapText}
        </text>
      )}
    </svg>
  );
}
