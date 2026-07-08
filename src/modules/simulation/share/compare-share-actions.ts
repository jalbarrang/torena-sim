import { useMemo } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/shallow';
import { copyScreenshot, getSkillsForShareCard } from '@/modules/runners/share/share-actions';
import { useRaceStore } from '@/modules/simulation/stores/compare.store';
import { useComparePairRunners, useRunnersStore } from '@/store/runners.store';
import type { CompareRunnerId } from '@/modules/simulation/compare.types';
import { useSettingsStore, useWitVariance } from '@/store/settings.store';
import { getUmaDisplayInfo, getUmaImageUrl } from '@/modules/runners/utils';
import { getDefaultTrackIdForCourse } from '@/modules/racetrack/courses';
import { trackDescription } from '@/modules/racetrack/labels';
import i18n from '@/i18n';
import strings_en from '@/i18n/lang/en/skills';
import { simToDisplaySeconds } from '@/modules/race-sim/constants';
import { formatTime } from '@/utils/time';
import type { RaceConditions } from '@/utils/races';
import type { SimulationData, SimulationRun } from '@/modules/simulation/compare.types';
import type { CompareShareCardProps, CompareShareStatRow } from './compare-share-card';

/**
 * Download the current compare results as a JSON file. The payload nests the
 * reduced `CompareResult` under `data.results` so existing analysis tooling
 * (e.g. `results/analyze-contested.py`) can read exports and hand-captured
 * worker payloads with the same code path.
 */
export function downloadCompareResults(filename?: string): void {
  const race = useRaceStore.getState();
  if (race.results.length === 0) {
    toast.error('No compare results to export - run a simulation first');
    return;
  }
  try {
    const payload = {
      type: 'compare',
      exportedAt: new Date().toISOString(),
      meta: {
        seed: race.seed,
        compareMode: 'contested',
        fieldSize: race.fieldSize,
        courseId: useSettingsStore.getState().courseId,
        samples: race.results.length
      },
      data: {
        type: 'compare',
        results: {
          results: race.results,
          runData: race.runData,
          rushedStats: race.rushedStats,
          fullyChargedStats: race.fullyChargedStats,
          leadCompetitionStats: race.leadCompetitionStats,
          duelingStats: race.duelingStats,
          spurtInfo: race.spurtInfo,
          staminaStats: race.staminaStats,
          firstUmaStats: race.firstUmaStats
        }
      }
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `umalator-results-contested-${race.seed ?? 'noseed'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Simulation results downloaded');
  } catch {
    toast.error('Failed to export simulation results');
  }
}

function resolveCompareChartData(race: {
  chartData: SimulationRun | null;
  runData: SimulationData | null;
  displaying: string;
}): SimulationRun | null {
  if (race.chartData) return race.chartData;
  if (!race.runData) return null;
  const key = race.displaying as keyof SimulationData;
  return race.runData[key] ?? race.runData.meanrun;
}

const groundConditions: Record<number, string> = {
  1: 'Firm',
  2: 'Good',
  3: 'Soft',
  4: 'Heavy'
};

function getRaceSettingsSummaryLine(courseId: number, racedef: RaceConditions): string {
  const trackId = getDefaultTrackIdForCourse(courseId);
  const trackName = i18n.t(`tracknames.${trackId}`);
  const courseDesc = trackDescription({ courseid: courseId });
  const ground = groundConditions[racedef.ground] ?? '';
  const season = strings_en.skilldetails.season[racedef.season] ?? '';
  const weather = strings_en.skilldetails.weather[racedef.weather] ?? '';

  return `${trackName} · ${courseDesc} · ${ground} · ${season} · ${weather}`;
}

/**
 * Hook that subscribes to the stores needed for the compare share card
 * and returns pre-computed props, or null when there are no results.
 */
export function useCompareShareCardProps(): CompareShareCardProps | null {
  const race = useRaceStore(
    useShallow((s) => ({
      results: s.results,
      chartData: s.chartData,
      runData: s.runData,
      displaying: s.displaying,
      rushedStats: s.rushedStats,
      fullyChargedStats: s.fullyChargedStats,
      leadCompetitionStats: s.leadCompetitionStats,
      staminaStats: s.staminaStats,
      seed: s.seed,
      fieldSize: s.fieldSize
    }))
  );

  const { uma1, uma2 } = useComparePairRunners();
  const editingId = useRunnersStore((s) => s.editingId);
  const compareB = useRunnersStore((s) => s.compareB);
  // Pair role of the runner shown on the share card (defaults to slot A).
  const runnerId: CompareRunnerId = editingId === compareB ? 'uma2' : 'uma1';

  const courseId = useSettingsStore((s) => s.courseId);
  const racedef = useSettingsStore((s) => s.racedef);
  const wit = useWitVariance();

  const runner = runnerId === 'uma1' ? uma1 : uma2;

  return useMemo(() => {
    if (race.results.length === 0) return null;

    const chartData = resolveCompareChartData(race);
    if (!chartData) return null;

    const idx = runnerId === 'uma1' ? 0 : 1;

    const timeArr = chartData.time[idx];
    if (!timeArr || timeArr.length === 0) return null;

    const rushedStats = race.rushedStats?.[runnerId];
    const fullyChargedStats = race.fullyChargedStats?.[runnerId];
    const leadCompetitionStats = race.leadCompetitionStats?.[runnerId];
    const staminaStats = race.staminaStats?.[runnerId];

    const topSpeed = chartData.velocity[idx]?.reduce((a, b) => Math.max(a, b), 0) ?? 0;
    const finishTime = simToDisplaySeconds(timeArr[timeArr.length - 1]);
    const startDelay = chartData.startDelay[idx] ?? 0;

    const otherRunner = runnerId === 'uma1' ? uma2 : uma1;
    const hasBothRunners = otherRunner.outfitId !== '';

    const mean = race.results.reduce((a, b) => a + b, 0) / race.results.length;
    const meanLengths = hasBothRunners ? `${mean >= 0 ? '+' : ''}${mean.toFixed(2)}` : null;

    const umaInfo = getUmaDisplayInfo(runner.outfitId);
    const imageUrl = getUmaImageUrl(runner.outfitId, runner.randomMobId);
    const skills = getSkillsForShareCard(runner.skills);

    const compareSummary = `Same race · field of ${race.fieldSize}`;
    const raceSummary = `${getRaceSettingsSummaryLine(courseId, racedef)} · ${compareSummary}`;

    const statRows: CompareShareStatRow[] = [
      { label: 'Time to finish', value: formatTime(finishTime) },
      { label: 'Start delay', value: `${startDelay.toFixed(4)} s` },
      { label: 'Top speed', value: `${topSpeed.toFixed(2)} m/s` }
    ];

    if (race.rushedStats && wit.allowRushedUma2) {
      statRows.push({
        label: 'Rushed frequency',
        value:
          rushedStats && rushedStats.frequency > 0
            ? `${rushedStats.frequency.toFixed(1)}% (${rushedStats.mean.toFixed(1)}m)`
            : '0%'
      });
    }

    if (race.fullyChargedStats) {
      statRows.push({
        label: 'Fully Charged frequency',
        value:
          fullyChargedStats && fullyChargedStats.frequency > 0
            ? `${fullyChargedStats.frequency.toFixed(1)}% (+${fullyChargedStats.mean.toFixed(2)} m/s²)`
            : '0%'
      });
    }

    if (race.leadCompetitionStats) {
      statRows.push({
        label: 'Spot Struggle frequency',
        value:
          leadCompetitionStats && leadCompetitionStats.frequency > 0
            ? `${leadCompetitionStats.frequency.toFixed(1)}%`
            : '0%'
      });
    }

    if (race.staminaStats) {
      statRows.push(
        {
          label: 'Spurt Rate',
          value: `${(staminaStats?.fullSpurtRate ?? 0).toFixed(1)}%`,
          highlight: true
        },
        {
          label: 'Survival Rate',
          value: `${(staminaStats?.staminaSurvivalRate ?? 0).toFixed(1)}%`,
          highlight: true
        }
      );
    }

    return {
      shareCard: { runner, umaInfo, imageUrl, skills },
      raceSummary,
      meanLengths,
      sampleCount: race.results.length,
      seedDisplay: race.seed === null ? '—' : String(race.seed),
      statRows
    } satisfies CompareShareCardProps;
  }, [race, runnerId, runner, uma1, uma2, courseId, racedef, wit]);
}

export async function copyCompareScreenshot(element: HTMLElement | null) {
  if (!element) return;
  await copyScreenshot(element);
}
