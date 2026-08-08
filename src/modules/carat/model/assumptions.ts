import type { CaratSettings } from '@/store/carat.store';
import {
  CHAMPIONS_MEETING_REWARDS,
  CLUB_RANK_MONTHLY_CARATS,
  LEAGUE_OF_HEROES_REWARDS,
  TEAM_TRIALS_WEEKLY_CARATS,
  TRAINING_PASS_MATURE_MONTHLY_CARATS
} from './income-tables';

/** Carats the plan starts from, across both pools. */
export function startingCaratTotal(settings: CaratSettings) {
  return settings.startingFreeCarats + settings.startingPaidCarats;
}

function lookup(table: Record<string, number>, key: string) {
  return table[key] ?? 0;
}

/**
 * How many of the configurable income settings currently contribute carats.
 * The always-on daily-quest and login baselines are excluded: they are not
 * settings, so reporting them would not explain a projection.
 */
export function countActiveIncomeSources(settings: CaratSettings) {
  const contributions = [
    lookup(TEAM_TRIALS_WEEKLY_CARATS, settings.teamTrialsClass),
    lookup(CLUB_RANK_MONTHLY_CARATS, settings.clubRank),
    lookup(TRAINING_PASS_MATURE_MONTHLY_CARATS, settings.trainingPass),
    settings.dailyCaratPack ? 1 : 0,
    CHAMPIONS_MEETING_REWARDS[settings.cmPlacement as keyof typeof CHAMPIONS_MEETING_REWARDS]
      ?.carats ?? 0,
    LEAGUE_OF_HEROES_REWARDS[settings.lohRank as keyof typeof LEAGUE_OF_HEROES_REWARDS]?.carats ?? 0
  ];

  return contributions.filter((contribution) => contribution > 0).length;
}
