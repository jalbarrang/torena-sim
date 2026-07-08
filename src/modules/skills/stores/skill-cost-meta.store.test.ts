import { describe, expect, it } from 'vitest';
import { migrateSkillCostMetaPersisted } from './skill-cost-meta.store';
import { LEGACY_FIELD_ID_A, LEGACY_FIELD_ID_B } from '@/store/runners.store';

describe('migrateSkillCostMetaPersisted', () => {
  it('rekeys legacy uma1/uma2 composite keys and runner settings to the legacy fieldIds', () => {
    const legacy = {
      skillMetaByKey: {
        'uma1:100234': { hintLevel: 3, bought: true },
        'uma2:200456': { hintLevel: 1 },
        'pacer:300789': { hintLevel: 2 }
      },
      runnerSettingsById: {
        uma1: { hasFastLearner: true },
        uma2: { hasFastLearner: false }
      }
    };

    const migrated = migrateSkillCostMetaPersisted(legacy, 0);

    // hint levels / bought flags preserved under the new ids
    expect(migrated.skillMetaByKey[`${LEGACY_FIELD_ID_A}:100234`]).toEqual({
      hintLevel: 3,
      bought: true
    });
    expect(migrated.skillMetaByKey[`${LEGACY_FIELD_ID_B}:200456`]).toEqual({ hintLevel: 1 });
    // non-field ids (pacer) pass through untouched
    expect(migrated.skillMetaByKey['pacer:300789']).toEqual({ hintLevel: 2 });
    // fast-learner state preserved
    expect(migrated.runnerSettingsById[LEGACY_FIELD_ID_A]).toEqual({ hasFastLearner: true });
    expect(migrated.runnerSettingsById[LEGACY_FIELD_ID_B]).toEqual({ hasFastLearner: false });
  });

  it('leaves already-migrated (version 1) state unchanged', () => {
    const current = {
      skillMetaByKey: { [`${LEGACY_FIELD_ID_A}:100234`]: { hintLevel: 2 } },
      runnerSettingsById: {}
    };
    const migrated = migrateSkillCostMetaPersisted(current, 1);
    expect(migrated.skillMetaByKey).toEqual(current.skillMetaByKey);
  });
});
