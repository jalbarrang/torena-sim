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
import { useSkillVisualizerStore } from './store';

export const VISUALIZER_COLORS = [
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

const DEFAULT_STRATEGY = STRATEGY_ORDER[0];

export type VisualizerRegion = {
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

export type VisualizerEntryStatus = 'ok' | 'no-activation' | 'unsupported';

export type SkillVisualizerEntry = {
  skillId: string;
  name: string;
  iconId: string;
  color: string;
  status: VisualizerEntryStatus;
  triggers: Array<VisualizerTriggerRow>;
  /** Strategy/conditions required for activation when the defaults do not trigger, e.g. 'as Late Surger' or 'in Rainy weather'. */
  contextLabel?: string;
};

export function useSkillVisualizerData() {
  const { skillIds, courseId } = useSkillVisualizerStore(
    useShallow((state) => ({ skillIds: state.skillIds, courseId: state.courseId }))
  );

  return useMemo(() => {
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

        for (const variant of CONDITION_VARIANTS) {
          for (const strategy of STRATEGY_ORDER) {
            const skillTriggers = buildSkillData({
              runner: {
                baseStats: buildBaseStats(DEFAULT_STATS, variant.conditions.mood),
                strategy: parseStrategyName(strategy),
                mood: variant.conditions.mood
              },
              raceParams: racedefToParams(variant.conditions, strategy),
              course,
              wholeCourse,
              parser,
              skillId,
              ignoreNullEffects: true
            });

            if (skillTriggers.length === 0) continue;
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

            if (triggers.length === 0) continue;

            const labelParts: Array<string> = [];
            if (strategy !== DEFAULT_STRATEGY) labelParts.push(`as ${strategy}`);
            if (variant.labelPart) labelParts.push(variant.labelPart);

            return {
              ...base,
              status: 'ok' as const,
              triggers,
              contextLabel: labelParts.length > 0 ? labelParts.join(', ') : undefined
            };
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
  }, [skillIds, courseId]);
}
