import type { CourseData } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import type { SkillEvalRunner } from '@/lib/uma-domain/skills/parser/definitions';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { buildBaseStats } from '@/lib/uma-domain/runner/types';
import { buildSkillData } from '@/lib/uma-domain/runner/runner.utils';
import { parseStrategyName } from '@/lib/uma-domain/runner/runner.types';
import { createParser } from '@/lib/uma-domain/skills/parser/ConditionParser';
import { Region, RegionList } from '@/lib/uma-domain/shared/region';
import type { SkillService } from './SkillService';

// =======
// Types
// =======

export type SimulationSkillFilters = {
  /** When 'released', exclude unreleased/datamined skills. Default: no scope filtering. */
  scope?: 'released' | 'all';
  /** Filter to skills matching these type values (SkillEntry.type). */
  typeFilters?: Set<string>;
  /** Filter to skills matching these family group IDs (SkillEntry.groupId). */
  familyGroupIds?: Set<number>;
  /** Explicit set of skill IDs to constrain to. */
  selectedSkillIds?: Set<string>;
  /** How to apply selectedSkillIds: intersect with other filters, or use exclusively. */
  selectionMode?: 'all-matching' | 'selected-only';
};

export type SkillFiltererConfig = {
  runner: IRunnerState;
  course: CourseData;
  raceParams: RaceParameters;
};

// =======
// Class
// =======

export class SkillFilterer {
  private readonly skillService: SkillService;
  private readonly course: CourseData;
  private readonly raceParams: RaceParameters;
  private readonly skillEvalRunner: SkillEvalRunner;
  private readonly parser: ReturnType<typeof createParser>;
  private readonly wholeCourse: RegionList;

  constructor(skillService: SkillService, config: SkillFiltererConfig) {
    const { runner, course, raceParams } = config;

    this.skillService = skillService;
    this.course = course;
    this.raceParams = raceParams;

    this.parser = createParser();
    this.wholeCourse = new RegionList();
    this.wholeCourse.push(new Region(0, course.distance));

    const baseStats = buildBaseStats(
      {
        speed: runner.speed,
        stamina: runner.stamina,
        power: runner.power,
        guts: runner.guts,
        wit: runner.wisdom
      },
      runner.mood
    );

    this.skillEvalRunner = {
      baseStats,
      strategy: parseStrategyName(runner.strategy),
      mood: runner.mood
    };
  }

  /**
   * Cheap pre-filtering pipeline. Always applies simulatability check.
   * Other filters are no-ops when their corresponding field is undefined.
   */
  filterCandidates = (
    skillIds: Array<string>,
    filters: SimulationSkillFilters = {}
  ): Array<string> => {
    const { scope, typeFilters, familyGroupIds, selectedSkillIds, selectionMode } = filters;

    // If selected-only mode with explicit IDs, start from those instead
    if (selectionMode === 'selected-only' && selectedSkillIds && selectedSkillIds.size > 0) {
      skillIds = skillIds.filter((id) => selectedSkillIds.has(id));
    }

    // Always filter simulatability
    let result = this.skillService.filterSimulatable(skillIds);

    // Scope: released only
    if (scope === 'released') {
      result = result.filter((skillId) => {
        const [baseSkillId] = skillId.split('-');
        return baseSkillId !== undefined && this.skillService.isReleased(baseSkillId);
      });
    }

    // Type filters
    if (typeFilters && typeFilters.size > 0) {
      result = result.filter((skillId) => {
        const [baseSkillId] = skillId.split('-');
        const skill = this.skillService.getById(baseSkillId ?? skillId);
        if (!skill) return false;

        const skillType = skill.type;
        if (Array.isArray(skillType)) {
          return skillType.some((t) => typeFilters.has(t));
        }
        return skillType !== undefined && typeFilters.has(skillType);
      });
    }

    // Family group ID filters
    if (familyGroupIds && familyGroupIds.size > 0) {
      result = result.filter((skillId) => {
        const [baseSkillId] = skillId.split('-');
        const skill = this.skillService.getById(baseSkillId ?? skillId);
        return skill !== undefined && familyGroupIds.has(skill.groupId);
      });
    }

    // all-matching mode: intersect with selected IDs after other filters
    if (selectionMode === 'all-matching' && selectedSkillIds && selectedSkillIds.size > 0) {
      result = result.filter((id) => selectedSkillIds.has(id));
    }

    return result;
  };

  /**
   * Expensive activation probe. Evaluates trigger regions for each skill
   * against the runner/course/raceParams to determine if the skill can
   * actually activate during the race.
   *
   * Call filterCandidates first to reduce the set before probing.
   */
  probeActivation = (skillIds: Array<string>): Array<string> => {
    const activatable: Array<string> = [];
    const failed: Array<{ skillId: string; reason: string }> = [];

    for (const skillId of skillIds) {
      try {
        const skillTriggers = buildSkillData({
          runner: this.skillEvalRunner,
          raceParams: this.raceParams,
          course: this.course,
          wholeCourse: this.wholeCourse,
          parser: this.parser,
          skillId,
          ignoreNullEffects: false
        });

        const isActivatable = skillTriggers.some(
          (trigger) => trigger.regions.length > 0 && trigger.regions[0].start < 9999
        );

        if (isActivatable) {
          activatable.push(skillId);
        }
      } catch (error) {
        failed.push({
          skillId,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (failed.length > 0) {
      console.warn(
        `[SkillFilterer] ${failed.length} skill(s) failed activation probe (likely unsupported condition tokens):`,
        failed
      );
    }

    return activatable;
  };
}
