import { describe, expect, it } from 'vitest';
import { StrategyName, Strategy } from '@/lib/uma-domain/runner/definitions';
import { parseUmadumpTrainedCharaJson, veteranBuildFingerprint } from './parser';

const trainedChara = {
  viewer_id: 311943848596,
  trained_chara_id: 12,
  card_id: 100401,
  speed: 987,
  stamina: 445,
  power: 608,
  wiz: 372,
  guts: 364,
  rank_score: 7466,
  proper_ground_turf: 7,
  proper_ground_dirt: 4,
  proper_running_style_nige: 7,
  proper_running_style_senko: 3,
  proper_running_style_sashi: 2,
  proper_running_style_oikomi: 1,
  proper_distance_short: 7,
  proper_distance_mile: 7,
  proper_distance_middle: 7,
  proper_distance_long: 6,
  talent_level: 2,
  running_style: 1,
  create_time: '2025-07-10 03:21:45',
  skill_array: [
    { skill_id: 100041, level: 2 },
    { skill_id: 200142, level: 1 }
  ],
  support_card_list: [{ support_card_id: 30002 }],
  memo: 'MemoExample'
};

describe('parseUmadumpTrainedCharaJson', () => {
  it('preserves the Veteran fields provided by trained_chara_data.json', () => {
    const result = parseUmadumpTrainedCharaJson(JSON.stringify([trainedChara]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.skippedEntries).toBe(0);
    expect(result.skippedSkills).toBe(0);
    expect(result.runners[0]).toMatchObject({
      importNotes: 'MemoExample',
      state: {
        outfitId: '100401',
        speed: 987,
        stamina: 445,
        power: 608,
        guts: 364,
        wisdom: 372,
        strategy: StrategyName[Strategy.FrontRunner],
        rankScore: 7466,
        star: 2,
        skills: ['100041', '200142'],
        skillLevels: { '100041': 2, '200142': 1 },
        aptitudes: {
          distanceShort: 'A',
          distanceMile: 'A',
          distanceMiddle: 'A',
          distanceLong: 'B',
          turf: 'A',
          dirt: 'D',
          nige: 'A',
          senko: 'E',
          sashi: 'F',
          oikomi: 'G'
        }
      }
    });
  });

  it('rejects invalid JSON, non-array roots, and empty dumps with actionable errors', () => {
    expect(parseUmadumpTrainedCharaJson('{').ok).toBe(false);
    expect(parseUmadumpTrainedCharaJson('{}')).toEqual({
      ok: false,
      error: 'This is not an umadump trained-character file. Expected a JSON array.'
    });
    expect(parseUmadumpTrainedCharaJson('[]')).toEqual({
      ok: false,
      error: 'This umadump file contains no trained characters.'
    });
  });

  it('keeps usable runners while reporting malformed entries and skills', () => {
    const result = parseUmadumpTrainedCharaJson(
      JSON.stringify([
        { card_id: 123 },
        {
          ...trainedChara,
          memo: '  ',
          running_style: 3,
          skill_array: [
            { skill_id: 100041, skill_level: 3 },
            { skill_id: 0, level: 1 },
            { skill_id: 200142, level: 0 }
          ],
          extra_data: { future: true }
        }
      ])
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.skippedEntries).toBe(1);
    expect(result.skippedSkills).toBe(2);
    expect(result.runners[0].importNotes).toBe('Imported from umadump');
    expect(result.runners[0].state.strategy).toBe(StrategyName[Strategy.LateSurger]);
    expect(result.runners[0].state.skillLevels).toEqual({ '100041': 3 });
  });
});

describe('veteranBuildFingerprint', () => {
  it('ignores skill order and local-only presentation metadata', () => {
    const result = parseUmadumpTrainedCharaJson(JSON.stringify([trainedChara]));
    if (!result.ok) throw new Error(result.error);
    const runner = result.runners[0].state;

    const reordered = {
      ...runner,
      skills: runner.skills.toReversed(),
      randomMobId: 9999,
      linkedRunnerId: 'local-link'
    };

    expect(veteranBuildFingerprint(reordered)).toBe(veteranBuildFingerprint(runner));
  });
});
