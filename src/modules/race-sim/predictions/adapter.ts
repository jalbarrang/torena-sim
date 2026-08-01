import { Strategy, StrategyName } from '@/lib/uma-domain/runner/definitions';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { aptitudeToEncoding } from '@/modules/runners/share/converters';
import { bucketsFromRunner } from '@/modules/runners/aptitude-buckets';
import { estimateRunnerRankScore } from '@/modules/race-sim/eval/rank-score';

const STRATEGY_NAME_TO_ID = new Map<string, number>(
  Object.entries(StrategyName).map(([id, name]) => [name, Number(id)])
);

/**
 * Build the `raceHorseInfo[]` shape the prediction feature builder consumes
 * from the race-sim field. Single aptitude grades are expanded into the
 * per-bucket `proper_*` fields (all equal) since the model only reads the
 * bucket matching the course.
 */
export function runnersToRaceHorseInfo(runners: IRunnerState[]): Array<Record<string, unknown>> {
  return runners.map((runner, index) => {
    const full = bucketsFromRunner(runner);
    const runningStyle = STRATEGY_NAME_TO_ID.get(runner.strategy) ?? Strategy.FrontRunner;

    return {
      team_id: typeof runner.team === 'number' ? runner.team : 0,
      // frame_order is 1-based; fall back to field order when no gate is set.
      frame_order: typeof runner.gate === 'number' ? runner.gate : index + 1,
      running_style: runningStyle,
      motivation: runner.mood + 3, // Mood -2..2 -> motivation 1..5
      single_mode_win_count: 0,
      speed: runner.speed,
      stamina: runner.stamina,
      pow: runner.power,
      guts: runner.guts,
      wiz: runner.wisdom,
      proper_distance_short: aptitudeToEncoding(full.distanceShort),
      proper_distance_mile: aptitudeToEncoding(full.distanceMile),
      proper_distance_middle: aptitudeToEncoding(full.distanceMiddle),
      proper_distance_long: aptitudeToEncoding(full.distanceLong),
      proper_ground_turf: aptitudeToEncoding(full.turf),
      proper_ground_dirt: aptitudeToEncoding(full.dirt),
      proper_running_style_nige: aptitudeToEncoding(full.nige),
      proper_running_style_senko: aptitudeToEncoding(full.senko),
      proper_running_style_sashi: aptitudeToEncoding(full.sashi),
      proper_running_style_oikomi: aptitudeToEncoding(full.oikomi),
      skill_array: runner.skills.map((skillId) => ({
        skillId: Number((skillId.split('-', 1)[0] ?? skillId).trim())
      })),
      card_id: Number(runner.outfitId) || 0,
      chara_id: runner.outfitId ? Number(runner.outfitId.slice(0, 4)) || 0 : 0,
      // Use the imported rank score when present, else our native estimate.
      rank_score: estimateRunnerRankScore(runner)
    };
  });
}
