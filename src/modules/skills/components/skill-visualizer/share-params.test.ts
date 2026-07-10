import { describe, expect, it } from 'vitest';
import { buildVisualizerShareParams, parseVisualizerShareParams } from './share-params';

const NAKAYAMA_1200_TURF = 10501;
const PUMP_SOME_IRON = '100271';
const TAKING_THE_LEAD = '200531';

describe('visualizer share params', () => {
  it('round-trips skills and course through build → parse', () => {
    const params = buildVisualizerShareParams(
      [PUMP_SOME_IRON, TAKING_THE_LEAD],
      NAKAYAMA_1200_TURF
    );

    expect(parseVisualizerShareParams(params)).toEqual({
      skillIds: [PUMP_SOME_IRON, TAKING_THE_LEAD],
      courseId: NAKAYAMA_1200_TURF
    });
  });

  it('drops unknown skill IDs and deduplicates', () => {
    const params = new URLSearchParams({
      skills: `999999999,${PUMP_SOME_IRON},${PUMP_SOME_IRON}, ,${TAKING_THE_LEAD}`
    });

    expect(parseVisualizerShareParams(params)?.skillIds).toEqual([PUMP_SOME_IRON, TAKING_THE_LEAD]);
  });

  it('returns null courseId for unknown or malformed courses', () => {
    expect(parseVisualizerShareParams(new URLSearchParams({ course: '1' }))?.courseId).toBeNull();
    expect(parseVisualizerShareParams(new URLSearchParams({ course: 'abc' }))?.courseId).toBeNull();
    expect(
      parseVisualizerShareParams(new URLSearchParams({ course: String(NAKAYAMA_1200_TURF) }))
        ?.courseId
    ).toBe(NAKAYAMA_1200_TURF);
  });

  it('caps imported skills at the visualizer limit', () => {
    // 11 real skill IDs; the parser must keep only the first 10.
    const elevenSkillIds = [
      '100271',
      '200531',
      '200331',
      '100481',
      '202111',
      '202112',
      '900271',
      '200532',
      '201241',
      '201242',
      '201251'
    ];
    const params = new URLSearchParams({ skills: elevenSkillIds.join(',') });

    expect(parseVisualizerShareParams(params)?.skillIds).toEqual(elevenSkillIds.slice(0, 10));
  });

  it('returns null when neither param is present', () => {
    expect(parseVisualizerShareParams(new URLSearchParams())).toBeNull();
    expect(parseVisualizerShareParams(new URLSearchParams({ other: 'x' }))).toBeNull();
  });
});
