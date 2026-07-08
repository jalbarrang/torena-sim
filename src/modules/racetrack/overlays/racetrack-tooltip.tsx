import { useCallback, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { SimulationRun } from '@/modules/simulation/compare.types';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';
import { useRaceTrackDisplay } from '@/store/settings.store';
import { binSearch } from '@/utils/algorithims';

type UmaTick = {
  velocity: string;
  time: string;
  rank: string;
  hp: string;
};

export type TooltipData = {
  uma1: UmaTick | null;
  uma2: UmaTick | null;
  gap: string | null;
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

const UMA_COLORS = ['#2a77c5', '#c52a2a'] as const;

function umaTickAt(
  chartData: SimulationRun,
  umaIndex: 0 | 1,
  safeIdx: number,
  t: number
): UmaTick {
  const rank = chartData.order?.[umaIndex]?.[safeIdx] ?? 0;
  return {
    velocity: `${chartData.velocity[umaIndex][safeIdx].toFixed(2)}m/s`,
    time: `${t.toFixed(2)}s`,
    rank: rank > 0 ? `P${rank}` : '—',
    hp: `${chartData.hp[umaIndex][safeIdx].toFixed(0)}`
  };
}

/**
 * Permanent hover-readout row for the racetrack. Always rendered with labeled
 * columns (placeholder dashes when the cursor is off the track) so the layout
 * never shifts, and never covers the chart.
 */
export function RaceTrackTooltip(props: RaceTrackTooltipProps) {
  const { chartData, course, ref } = props;
  const { showVelocityUma1, showVelocityUma2 } = useRaceTrackDisplay();
  const names = useComparePairNames();
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

      const uma1 = showVelocityUma1 ? umaTickAt(chartData, 0, safeI0, t1) : null;
      const uma2 = showVelocityUma2 ? umaTickAt(chartData, 1, safeI1, t2) : null;

      // Head-to-head standing at the observed tick: when the LEADER passes
      // the hovered distance, how far back is the other runner? (1 length =
      // 2.5m, same conversion as the bashin delta.)
      let gap: string | null = null;
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
          gap =
            gapMeters < 0.05
              ? 'even'
              : `${leaderName} +${gapLengths.toFixed(1)}L (${gapMeters.toFixed(1)}m)`;
        }
      }

      setTooltipData({ uma1, uma2, gap });
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

  const segments: Array<{ name: string; color: string; tick: UmaTick | null; shown: boolean }> = [
    { name: names.uma1, color: UMA_COLORS[0], tick: tooltipData?.uma1 ?? null, shown: showVelocityUma1 },
    { name: names.uma2, color: UMA_COLORS[1], tick: tooltipData?.uma2 ?? null, shown: showVelocityUma2 }
  ];

  return (
    <div
      id="racetrack-tooltip"
      className="flex min-h-6 flex-wrap items-center gap-x-6 gap-y-1 border-t px-2 pt-1.5 text-[11px]"
    >
      {segments.map((segment) => (
        <div key={segment.color} className="flex items-center gap-2">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: segment.color, opacity: segment.shown ? 1 : 0.3 }}
            />
            <span className="max-w-32 truncate font-medium">{segment.name}</span>
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            <ReadoutField label="spd" value={segment.tick?.velocity} width="min-w-16" />
            <ReadoutField label="t" value={segment.tick?.time} width="min-w-14" />
            <ReadoutField label="pos" value={segment.tick?.rank} width="min-w-8" />
            <ReadoutField label="hp" value={segment.tick?.hp} width="min-w-10" />
          </span>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <span className="font-medium">Gap</span>
        <span className="inline-block min-w-28 font-mono tabular-nums text-muted-foreground">
          {tooltipData?.gap ?? '—'}
        </span>
      </div>
    </div>
  );
}

type ReadoutFieldProps = {
  label: string;
  value: string | undefined;
  width: string;
};

function ReadoutField(props: ReadoutFieldProps) {
  const { label, value, width } = props;
  return (
    <span className="mr-3 inline-flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wide opacity-60">{label}</span>
      <span className={`inline-block ${width}`}>{value ?? '—'}</span>
    </span>
  );
}
