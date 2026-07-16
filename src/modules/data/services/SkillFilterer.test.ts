import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunnerState } from '@/modules/runners/components/runner-card/types';
import { coursesService } from '@/modules/data/services/CourseService';
import { skillsService } from '@/modules/data/services/SkillService';
import { createRaceConditions, racedefToParams } from '@/utils/races';
import * as runnerUtils from '@/lib/uma-domain/runner/runner.utils';

const TEST_COURSE_ID = 10101;
// The current data uses value usage 13 here, which is deliberately rejected
// until its runtime policy exists.
const NON_SIMULATABLE_SKILL_ID = '210081';
const SIMULATABLE_SKILL_ID = '10071';

describe('SkillFilterer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('filterCandidates', () => {
    it('filters out non-simulatable skills by default', () => {
      const runner = createRunnerState({ outfitId: '100101', skills: [] });
      const course = coursesService.getSimCourse(TEST_COURSE_ID);
      const raceParams = racedefToParams(createRaceConditions());

      expect(skillsService.isSimulatable(NON_SIMULATABLE_SKILL_ID)).toBe(false);
      expect(skillsService.isSimulatable(SIMULATABLE_SKILL_ID)).toBe(true);

      const filterer = skillsService.createFilterer({ runner, course, raceParams });
      const result = filterer.filterCandidates([NON_SIMULATABLE_SKILL_ID, SIMULATABLE_SKILL_ID]);

      expect(result).not.toContain(NON_SIMULATABLE_SKILL_ID);
      expect(result).toContain(SIMULATABLE_SKILL_ID);
    });

    it('filters by released scope', () => {
      const runner = createRunnerState({ outfitId: '100101', skills: [] });
      const course = coursesService.getSimCourse(TEST_COURSE_ID);
      const raceParams = racedefToParams(createRaceConditions());

      const filterer = skillsService.createFilterer({ runner, course, raceParams });
      const allResults = filterer.filterCandidates([SIMULATABLE_SKILL_ID], { scope: 'all' });
      const releasedResults = filterer.filterCandidates([SIMULATABLE_SKILL_ID], {
        scope: 'released'
      });

      // Released filter should not add skills that weren't there
      expect(releasedResults.length).toBeLessThanOrEqual(allResults.length);
    });

    it('filters by selectedSkillIds in selected-only mode', () => {
      const runner = createRunnerState({ outfitId: '100101', skills: [] });
      const course = coursesService.getSimCourse(TEST_COURSE_ID);
      const raceParams = racedefToParams(createRaceConditions());

      const filterer = skillsService.createFilterer({ runner, course, raceParams });
      const result = filterer.filterCandidates([NON_SIMULATABLE_SKILL_ID, SIMULATABLE_SKILL_ID], {
        selectedSkillIds: new Set([SIMULATABLE_SKILL_ID]),
        selectionMode: 'selected-only'
      });

      expect(result).toContain(SIMULATABLE_SKILL_ID);
      expect(result).not.toContain(NON_SIMULATABLE_SKILL_ID);
    });
  });

  describe('probeActivation', () => {
    it('does not call buildSkillData for non-simulatable skills after filterCandidates', () => {
      const buildSkillData = vi.spyOn(runnerUtils, 'buildSkillData').mockReturnValue([]);

      const runner = createRunnerState({ outfitId: '100101', skills: [] });
      const course = coursesService.getSimCourse(TEST_COURSE_ID);
      const raceParams = racedefToParams(createRaceConditions());

      const filterer = skillsService.createFilterer({ runner, course, raceParams });
      const candidates = filterer.filterCandidates([
        NON_SIMULATABLE_SKILL_ID,
        SIMULATABLE_SKILL_ID
      ]);
      filterer.probeActivation(candidates);

      const calledSkillIds = buildSkillData.mock.calls.map((call) => call[0].skillId);
      expect(calledSkillIds).not.toContain(NON_SIMULATABLE_SKILL_ID);
      expect(calledSkillIds).toContain(SIMULATABLE_SKILL_ID);
    });

    it('continues past a skill whose buildSkillData throws', () => {
      const SKILL_A = '10071';
      const SKILL_B = '10072';

      vi.spyOn(runnerUtils, 'buildSkillData').mockImplementation((params) => {
        if (params.skillId === SKILL_A) {
          throw new Error('unsupported condition token: new_token');
        }
        return [
          {
            skillId: params.skillId,
            rarity: 1,
            samplePolicy: { sample: () => [] },
            regions: [{ start: 100, end: 200 }],
            extraCondition: () => true,
            effects: []
          }
        ] as unknown as ReturnType<typeof runnerUtils.buildSkillData>;
      });

      const runner = createRunnerState({ outfitId: '100101', skills: [] });
      const course = coursesService.getSimCourse(TEST_COURSE_ID);
      const raceParams = racedefToParams(createRaceConditions());

      const filterer = skillsService.createFilterer({ runner, course, raceParams });
      const result = filterer.probeActivation([SKILL_A, SKILL_B]);

      expect(result).not.toContain(SKILL_A);
      expect(result).toContain(SKILL_B);
    });

    it('logs a single aggregated warning with skill ID and reason for failures', () => {
      const SKILL_A = '10071';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.spyOn(runnerUtils, 'buildSkillData').mockImplementation(() => {
        throw new Error('unsupported condition token: new_token');
      });

      const runner = createRunnerState({ outfitId: '100101', skills: [] });
      const course = coursesService.getSimCourse(TEST_COURSE_ID);
      const raceParams = racedefToParams(createRaceConditions());

      const filterer = skillsService.createFilterer({ runner, course, raceParams });
      const result = filterer.probeActivation([SKILL_A]);

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 skill(s) failed activation probe'),
        expect.arrayContaining([
          expect.objectContaining({
            skillId: SKILL_A,
            reason: 'unsupported condition token: new_token'
          })
        ])
      );
    });
  });
});
