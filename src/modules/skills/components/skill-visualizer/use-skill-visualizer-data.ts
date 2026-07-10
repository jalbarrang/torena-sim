import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { buildSkillData } from '@/lib/uma-domain/runner/runner.utils';
import { buildBaseStats } from '@/lib/uma-domain/runner/types';
import { parseStrategyName } from '@/lib/uma-domain/runner/runner.types';
import type { IStrategyName } from '@/lib/uma-domain/runner/definitions';
import {
  GroundCondition,
  GroundConditionName,
  Season,
  SeasonName,
  TimeOfDay,
  TimeOfDayName,
  Weather,
  WeatherName
} from '@/lib/uma-domain/course/definitions';
import { createParser } from '@/lib/uma-domain/skills/parser/ConditionParser';
import { kTrue } from '@/lib/uma-domain/skills/parser/conditions/utils';
import { ImmediatePolicy } from '@/lib/uma-domain/skills/policies/ActivationSamplePolicy';
import { Region, RegionList } from '@/lib/uma-domain/shared/region';
import { coursesService } from '@/modules/data/services/CourseService';
import { skillsService } from '@/modules/data/services/SkillService';
import { createRaceConditions, racedefToParams } from '@/utils/races';
import type { RaceConditions } from '@/utils/races';
import { candidateScanPositions } from './position-context';
import { useSkillVisualizerStore } from './store';

const VISUALIZER_COLORS = [
  '#2a77c5',
  '#c52a2a',
  '#188a4c',
  '#9333ea',
  '#d97706',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#7c4dff',
  '#b45309'
];

// Stats only matter for a handful of stat-threshold conditions; use a
// representative endgame build so those conditions resolve sensibly.
const DEFAULT_STATS = {
  speed: 1100,
  stamina: 900,
  power: 1000,
  guts: 600,
  wit: 600
};

const BASE_CONDITIONS = createRaceConditions();

type ConditionVariant = {
  conditions: RaceConditions;
  labelPart: string | null;
};

function buildConditionVariants(): Array<ConditionVariant> {
  const variants: Array<ConditionVariant> = [{ conditions: BASE_CONDITIONS, labelPart: null }];

  for (const ground of Object.values(GroundCondition)) {
    if (ground === BASE_CONDITIONS.ground) continue;
    variants.push({
      conditions: createRaceConditions({ ground }),
      labelPart: `on ${GroundConditionName[ground]} ground`
    });
  }

  for (const weather of Object.values(Weather)) {
    if (weather === BASE_CONDITIONS.weather) continue;
    variants.push({
      conditions: createRaceConditions({ weather }),
      labelPart: `in ${WeatherName[weather]} weather`
    });
  }

  for (const season of Object.values(Season)) {
    if (season === BASE_CONDITIONS.season) continue;
    variants.push({
      conditions: createRaceConditions({ season }),
      labelPart: `in ${SeasonName[season]}`
    });
  }

  for (const time of Object.values(TimeOfDay)) {
    if (time === BASE_CONDITIONS.time || time === TimeOfDay.NoTime) continue;
    variants.push({
      conditions: createRaceConditions({ time }),
      labelPart: `at ${TimeOfDayName[time]}`
    });
  }

  return variants;
}

const CONDITION_VARIANTS = buildConditionVariants();

const STRATEGY_ORDER: Array<IStrategyName> = [
  'Pace Chaser',
  'Front Runner',
  'Late Surger',
  'End Closer',
  'Runaway'
];

// Mirrors the field size hardcoded in racedefToParams.
const NUM_UMAS = 9;

type VisualizerRegion = {
  start: number;
  end: number;
};

export type VisualizerTriggerRow = {
  regions: Array<VisualizerRegion>;
  /** Sample policy is non-immediate: activation point is random within the regions. */
  isRandom: boolean;
  /** Has dynamic conditions (order, HP, surroundings…) that can only resolve mid-race. */
  hasDynamicCondition: boolean;
};

type VisualizerEntryStatus = 'ok' | 'no-activation' | 'unsupported';

export type SkillVisualizerEntry = {
  skillId: string;
  name: string;
  iconId: string;
  color: string;
  status: VisualizerEntryStatus;
  triggers: Array<VisualizerTriggerRow>;
};

export function useSkillVisualizerData() {
  const { skillIds, courseId } = useSkillVisualizerStore(
    useShallow((state) => ({ skillIds: state.skillIds, courseId: state.courseId }))
  );

  return useMemo(() => computeSkillVisualizerData(skillIds, courseId), [skillIds, courseId]);
}

export function computeSkillVisualizerData(skillIds: Array<string>, courseId: number) {
  const course = coursesService.getSimCourse(courseId);

  const parser = createParser();
  const wholeCourse = new RegionList();
  wholeCourse.push(new Region(0, course.distance));

  const entries: Array<SkillVisualizerEntry> = skillIds.map((skillId, index) => {
    const skill = skillsService.getById(skillId);
    const base = {
      skillId,
      name: skill?.name ?? skillId,
      iconId: skill?.iconId ?? '',
      color: VISUALIZER_COLORS[index % VISUALIZER_COLORS.length]
    };

    try {
      let sawTriggers = false;

      const evaluate = (
        variant: ConditionVariant,
        strategy: IStrategyName,
        raceParams: ReturnType<typeof racedefToParams>
      ): Array<VisualizerTriggerRow> => {
        const skillTriggers = buildSkillData({
          runner: {
            baseStats: buildBaseStats(DEFAULT_STATS, variant.conditions.mood),
            strategy: parseStrategyName(strategy),
            mood: variant.conditions.mood
          },
          raceParams,
          course,
          wholeCourse,
          parser,
          skillId,
          ignoreNullEffects: true
        });

        if (skillTriggers.length === 0) return [];
        sawTriggers = true;

        const triggers: Array<VisualizerTriggerRow> = [];
        for (const trigger of skillTriggers) {
          const regions = trigger.regions
            .filter((region) => region.start < course.distance)
            .map((region) => ({
              start: region.start,
              end: Math.min(region.end, course.distance)
            }));

          if (regions.length === 0) continue;

          triggers.push({
            regions,
            isRandom: trigger.samplePolicy !== ImmediatePolicy,
            hasDynamicCondition: trigger.extraCondition !== kTrue
          });
        }

        return triggers;
      };

      const scanPositions = candidateScanPositions(skill?.alternatives ?? [], NUM_UMAS);

      for (const variant of CONDITION_VARIANTS) {
        for (const strategy of STRATEGY_ORDER) {
          // The strategy's typical position band ([2,4] for Pace Chaser etc.).
          const bandTriggers = evaluate(
            variant,
            strategy,
            racedefToParams(variant.conditions, strategy)
          );

          if (bandTriggers.length > 0) {
            return { ...base, status: 'ok' as const, triggers: bandTriggers };
          }

          // Position conditions are independent of strategy — any runner can end up in any
          // spot depending on the field. When the typical band fails, probe the positions the
          // skill's order conditions allow so position-gated skills still get visualized.
          for (const position of scanPositions) {
            const raceParams = {
              ...racedefToParams(variant.conditions),
              orderRange: [position, position] as [number, number]
            };
            const triggers = evaluate(variant, strategy, raceParams);
            if (triggers.length === 0) continue;

            return { ...base, status: 'ok' as const, triggers };
          }
        }
      }

      return {
        ...base,
        status: sawTriggers ? ('no-activation' as const) : ('unsupported' as const),
        triggers: []
      };
    } catch {
      return { ...base, status: 'unsupported' as const, triggers: [] };
    }
  });

  return { course, entries };
}
