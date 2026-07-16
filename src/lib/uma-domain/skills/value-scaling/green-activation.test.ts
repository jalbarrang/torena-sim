import { describe, expect, it } from 'vitest';
import { Strategy } from '@/lib/uma-domain/runner/definitions';
import { GroundCondition, Season, TimeOfDay, Weather } from '@/lib/uma-domain/course/definitions';
import type { RaceParameters } from '@/lib/uma-domain/race/types';
import { coursesService } from '@/modules/data/services/CourseService';
import { skillsService } from '@/modules/data/services/SkillService';
import { countGuaranteedActivatedGreens, type GreenActivationContext } from './green-activation';

// Ground truth: the two saved Copano Rickey contested-compare scenarios, which
// mirror the Rust tests `copano_rickey_usage_14_benefits_from_activated_greens`
// and `copano_rickey_usage_14_reaches_tier_3_with_six_greens`.
const SCENARIO_PARAMETERS: RaceParameters = {
  ground: GroundCondition.Good, // ground_condition==2 (Wet Conditions)
  weather: Weather.Sunny, // weather==1 (Sunny Days)
  season: Season.Autumn, // season==3 (Fall Runner)
  timeOfDay: TimeOfDay.Midday,
  grade: 100
} as RaceParameters;

function contextOn(courseId: number, parameters: RaceParameters): GreenActivationContext {
  return {
    runner: { strategy: Strategy.PaceChaser },
    course: coursesService.getSimCourse(courseId),
    raceParameters: parameters
  };
}

function realSkills(ids: Array<string>) {
  return ids.map((id) => {
    const entry = skillsService.getById(id);
    if (!entry) throw new Error(`missing skill ${id}`);
    return entry;
  });
}

describe('countGuaranteedActivatedGreens', () => {
  // Course 11103: track 10101 (dirt-grade), clockwise (rotation==1).
  it('counts 3 greens for the first Copano scenario', () => {
    const skills = realSkills(['100981', '201532', '202252', '200162']);
    expect(countGuaranteedActivatedGreens(skills, contextOn(11103, SCENARIO_PARAMETERS))).toBe(3);
  });

  it('counts 6 greens for the second Copano scenario (tier 3x cap)', () => {
    const skills = realSkills([
      '100981',
      '201532',
      '202252',
      '200162',
      '200192',
      '200012',
      '200212'
    ]);
    expect(countGuaranteedActivatedGreens(skills, contextOn(11103, SCENARIO_PARAMETERS))).toBe(6);
  });

  it('drops condition-gated greens when the race context changes', () => {
    const skills = realSkills([
      '100981',
      '201532',
      '202252',
      '200162',
      '200192',
      '200012',
      '200212'
    ]);
    const firmSpringCloudy = {
      ...SCENARIO_PARAMETERS,
      ground: GroundCondition.Firm, // Wet Conditions fails
      weather: Weather.Cloudy, // Sunny Days fails
      season: Season.Spring // Fall Runner fails
    } as RaceParameters;
    // Remaining: 201532 (Pace Chaser), 202252 (dirt-grade track), 200012 (clockwise).
    expect(countGuaranteedActivatedGreens(skills, contextOn(11103, firmSpringCloudy))).toBe(3);
  });

  it('never counts the usage-14 carrier itself (100981 is not green-tagged)', () => {
    const skills = realSkills(['100981']);
    expect(countGuaranteedActivatedGreens(skills, contextOn(11103, SCENARIO_PARAMETERS))).toBe(0);
  });

  it('counts Restraint (always==1) as a guaranteed green', () => {
    const skills = realSkills(['202161']);
    expect(countGuaranteedActivatedGreens(skills, contextOn(11103, SCENARIO_PARAMETERS))).toBe(1);
  });

  it('excludes a green whose condition narrows past the gate (conservative floor)', () => {
    // Hypothetical green gated on late-race: it could activate after the
    // usage-14 carrier procs, so it must not be promised.
    const phaseGatedGreen = {
      tags: [401, 608],
      alternatives: [{ condition: 'phase>=2' }]
    };
    expect(
      countGuaranteedActivatedGreens([phaseGatedGreen], contextOn(11103, SCENARIO_PARAMETERS))
    ).toBe(0);
  });
});
