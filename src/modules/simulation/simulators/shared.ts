// Data-dependent simulation helpers (read `skillsService`). MAIN-THREAD ONLY —
// importing this module pulls the skill dataset into the bundle, so it must
// never be reached from `src/workers/**`. Worker-side code imports the data-free
// helpers from `shared-pure.ts` directly. Pure helpers are re-exported here so
// existing main-side callers keep their `from './shared'` imports working.

import { SkillTarget, SkillType } from '@/lib/uma-domain/skills/definitions';
import type { ISkillTarget, ISkillType } from '@/lib/uma-domain/skills/definitions';
import { skillsService } from '@/modules/data/services/SkillService';
import { normalizeSkillId, createSkillSorterByGroupWith, type EffectMeta } from './shared-pure';

export * from './shared-pure';

function getSkillEffectMetadata(skillId: string): Array<EffectMeta> {
  const baseSkillId = normalizeSkillId(skillId);
  let effects: Array<{ type: number; target?: number }>;
  try {
    const skillData = skillsService.getById(baseSkillId);
    effects = skillData?.alternatives?.[0]?.effects ?? [];
  } catch {
    effects = [];
  }

  if (effects.length === 0) {
    return [{ effectType: SkillType.Noop, effectTarget: SkillTarget.Self }];
  }

  return effects.map((effect) => ({
    effectType: (effect.type ?? SkillType.Noop) as ISkillType,
    effectTarget: (effect.target ?? SkillTarget.Self) as ISkillTarget
  }));
}

export function getFallbackEffectMeta(skillId: string): EffectMeta {
  return getSkillEffectMetadata(skillId)[0];
}

export function createSkillSorterByGroup(allSkills: Array<string>) {
  return createSkillSorterByGroupWith(allSkills, (baseId) => {
    try {
      return skillsService.getById(baseId)?.groupId;
    } catch {
      return undefined;
    }
  });
}
