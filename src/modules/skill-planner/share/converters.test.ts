import { describe, expect, it } from 'vitest';
import { buildExportData, exportDataToImport } from './converters';
import { encodeSkillPlanner, decodeSkillPlanner } from './encoding';
import type { SkillPlannerExportData } from './types';
import { Mood } from '@/lib/uma-domain/runner/definitions';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';

const mockRunner: IRunnerState = {
  outfitId: '100601',
  speed: 1200,
  stamina: 800,
  power: 600,
  guts: 400,
  wisdom: 900,
  strategy: 'Front Runner',
  distanceAptitude: 'S',
  surfaceAptitude: 'A',
  strategyAptitude: 'B',
  mood: Mood.Great,
  skills: ['200011', '201151']
};

describe('buildExportData', () => {
  it('converts store runner to export data', () => {
    const result = buildExportData({
      runner: mockRunner,
      obtainedSkillIds: ['200011', '201151'],
      candidates: [
        { skillId: '200014', hintLevel: 2 },
        { skillId: '300001', hintLevel: 5 }
      ],
      budget: 1500,
      hasFastLearner: true
    });

    expect(result.card_id).toBe(100601);
    expect(result.speed).toBe(1200);
    expect(result.wiz).toBe(900);
    expect(result.proper_distance_short).toBe(8); // S = 8
    expect(result.proper_ground_turf).toBe(7); // A = 7
    expect(result.proper_running_style_nige).toBe(6); // B = 6
    expect(result.strategy).toBe(1); // Front Runner
    expect(result.mood).toBe(2); // Great
    expect(result.budget).toBe(1500);
    expect(result.fast_learner).toBe(true);
    expect(result.obtained_skills).toEqual([{ skill_id: 200011 }, { skill_id: 201151 }]);
    expect(result.candidate_skills).toEqual([
      { skill_id: 200014, hint_level: 2 },
      { skill_id: 300001, hint_level: 5 }
    ]);
  });

  it('maps all strategy names to their numeric values', () => {
    const strategies: Array<[IRunnerState['strategy'], number]> = [
      ['Front Runner', 1],
      ['Pace Chaser', 2],
      ['Late Surger', 3],
      ['End Closer', 4],
      ['Runaway', 5]
    ];

    for (const [name, value] of strategies) {
      const result = buildExportData({
        runner: { ...mockRunner, strategy: name },
        obtainedSkillIds: [],
        candidates: [],
        budget: 0,
        hasFastLearner: false
      });
      expect(result.strategy).toBe(value);
    }
  });
});

describe('exportDataToImport', () => {
  it('converts export data back to store-compatible shapes', () => {
    const exportData: SkillPlannerExportData = {
      card_id: 100601,
      speed: 1200,
      stamina: 800,
      power: 600,
      guts: 400,
      wiz: 900,
      proper_distance_short: 8,
      proper_distance_mile: 8,
      proper_distance_middle: 8,
      proper_distance_long: 8,
      proper_ground_turf: 7,
      proper_ground_dirt: 7,
      proper_running_style_nige: 6,
      proper_running_style_senko: 6,
      proper_running_style_sashi: 6,
      proper_running_style_oikomi: 6,
      strategy: 1,
      mood: 2,
      budget: 1500,
      fast_learner: true,
      obtained_skills: [{ skill_id: 200011 }],
      candidate_skills: [{ skill_id: 200014, hint_level: 3 }]
    };

    const result = exportDataToImport(exportData);

    expect(result.runner.outfitId).toBe('100601');
    expect(result.runner.speed).toBe(1200);
    expect(result.runner.wisdom).toBe(900);
    expect(result.runner.distanceAptitude).toBe('S');
    expect(result.runner.surfaceAptitude).toBe('A');
    expect(result.runner.strategyAptitude).toBe('B');
    expect(result.runner.strategy).toBe('Front Runner');
    expect(result.runner.mood).toBe(2);
    expect(result.obtainedSkillIds).toEqual(['200011']);
    expect(result.candidates).toEqual([{ skillId: '200014', hintLevel: 3 }]);
    expect(result.budget).toBe(1500);
    expect(result.hasFastLearner).toBe(true);
  });

  it('takes max aptitude from sub-fields when they differ', () => {
    const exportData: SkillPlannerExportData = {
      card_id: 100601,
      speed: 1200,
      stamina: 800,
      power: 600,
      guts: 400,
      wiz: 900,
      proper_distance_short: 3,
      proper_distance_mile: 7,
      proper_distance_middle: 8,
      proper_distance_long: 5,
      proper_ground_turf: 8,
      proper_ground_dirt: 4,
      proper_running_style_nige: 7,
      proper_running_style_senko: 6,
      proper_running_style_sashi: 5,
      proper_running_style_oikomi: 3,
      strategy: 3,
      mood: 0,
      budget: 0,
      fast_learner: false,
      obtained_skills: [],
      candidate_skills: []
    };

    const result = exportDataToImport(exportData);

    expect(result.runner.distanceAptitude).toBe('S'); // max(3,7,8,5) = 8 → S
    expect(result.runner.surfaceAptitude).toBe('S'); // max(8,4) = 8 → S
    expect(result.runner.strategyAptitude).toBe('A'); // max(7,6,5,3) = 7 → A
    expect(result.runner.strategy).toBe('Late Surger');
    expect(result.runner.mood).toBe(0);
  });

  it('maps all strategy values back to names', () => {
    const strategies: Array<[number, string]> = [
      [1, 'Front Runner'],
      [2, 'Pace Chaser'],
      [3, 'Late Surger'],
      [4, 'End Closer'],
      [5, 'Runaway']
    ];

    for (const [value, name] of strategies) {
      const data: SkillPlannerExportData = {
        card_id: 0,
        speed: 0,
        stamina: 0,
        power: 0,
        guts: 0,
        wiz: 0,
        proper_distance_short: 0,
        proper_distance_mile: 0,
        proper_distance_middle: 0,
        proper_distance_long: 0,
        proper_ground_turf: 0,
        proper_ground_dirt: 0,
        proper_running_style_nige: 0,
        proper_running_style_senko: 0,
        proper_running_style_sashi: 0,
        proper_running_style_oikomi: 0,
        strategy: value,
        mood: 0,
        budget: 0,
        fast_learner: false,
        obtained_skills: [],
        candidate_skills: []
      };
      const result = exportDataToImport(data);
      expect(result.runner.strategy).toBe(name);
    }
  });
});

describe('full pipeline: store → export → encode → decode → import', () => {
  it('preserves all data through the complete round-trip', () => {
    const exportData = buildExportData({
      runner: mockRunner,
      obtainedSkillIds: ['200011', '201151'],
      candidates: [
        { skillId: '200014', hintLevel: 2 },
        { skillId: '300001', hintLevel: 5 }
      ],
      budget: 1500,
      hasFastLearner: true
    });

    const encoded = encodeSkillPlanner(exportData);
    const decoded = decodeSkillPlanner(encoded)!;
    const imported = exportDataToImport(decoded);

    expect(imported.runner.outfitId).toBe(mockRunner.outfitId);
    expect(imported.runner.speed).toBe(mockRunner.speed);
    expect(imported.runner.wisdom).toBe(mockRunner.wisdom);
    expect(imported.runner.strategy).toBe(mockRunner.strategy);
    expect(imported.runner.mood).toBe(mockRunner.mood);
    expect(imported.obtainedSkillIds).toEqual(['200011', '201151']);
    expect(imported.candidates).toEqual([
      { skillId: '200014', hintLevel: 2 },
      { skillId: '300001', hintLevel: 5 }
    ]);
    expect(imported.budget).toBe(1500);
    expect(imported.hasFastLearner).toBe(true);
  });
});
