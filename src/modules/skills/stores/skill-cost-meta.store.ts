import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { calculateSkillCost } from '@/modules/skill-planner/cost-calculator';
import type { HintLevel } from '@/modules/skill-planner/types';
import { useShallow } from 'zustand/shallow';
import { getBaseTier, getUpgradeTier } from '@/modules/skills/skill-relationships';
import { buildSkillCostSummary } from '@/modules/skills/skill-cost-summary';
import { LEGACY_FIELD_ID_A, LEGACY_FIELD_ID_B } from '@/store/runners.store';

const SKILL_COST_META_STORE_NAME = 'umalator-skill-cost-meta';

export type SkillCostMeta = {
  hintLevel: HintLevel;
  bought?: boolean;
  received?: boolean;
  removed?: boolean;
};

type RunnerCostSettings = {
  hasFastLearner: boolean;
};

type SkillCostMetaState = {
  skillMetaByKey: Record<string, SkillCostMeta>;
  runnerSettingsById: Record<string, RunnerCostSettings>;
};

const DEFAULT_META: SkillCostMeta = {
  hintLevel: 0
};

const getSkillKey = (runnerId: string, skillId: string) => `${runnerId}:${skillId}`;

const normalizeMeta = (meta: SkillCostMeta): SkillCostMeta | undefined => {
  const next: SkillCostMeta = {
    hintLevel: meta.hintLevel,
    bought: meta.bought || undefined,
    received: meta.received || undefined,
    removed: meta.removed || undefined
  };

  const hasFlags = next.bought || next.received || next.removed;

  if (next.hintLevel === 0 && !hasFlags) {
    return undefined;
  }

  return next;
};

const resolveMeta = (
  state: SkillCostMetaState,
  runnerId: string,
  skillId: string
): SkillCostMeta => {
  const key = getSkillKey(runnerId, skillId);
  const meta = state.skillMetaByKey[key];

  if (!meta) {
    return DEFAULT_META;
  }

  return {
    hintLevel: meta.hintLevel ?? 0,
    bought: meta.bought,
    received: meta.received,
    removed: meta.removed
  };
};

// Runner ids used to change from the fixed compare roles `uma1`/`uma2` to the
// runners store's stable `fieldId`s. The runners store migrates the two legacy
// runners to deterministic ids (`LEGACY_FIELD_ID_A`/`B`); this migration rekeys
// persisted skill-cost metadata onto those same ids so hint levels, bought
// flags, and fast-learner state survive. 'pacer' and any other non-field id
// pass through unchanged.
const rekeyRunnerId = (runnerId: string): string => {
  if (runnerId === 'uma1') return LEGACY_FIELD_ID_A;
  if (runnerId === 'uma2') return LEGACY_FIELD_ID_B;
  return runnerId;
};

/** Persist migration for the skill-cost-meta store (exported for unit tests). */
export const migrateSkillCostMetaPersisted = (
  persistedState: unknown,
  version: number
): SkillCostMetaState => {
  const state = (persistedState ?? {}) as SkillCostMetaState;

  if (version >= 1) {
    return {
      skillMetaByKey: state.skillMetaByKey ?? {},
      runnerSettingsById: state.runnerSettingsById ?? {}
    };
  }

  // v0 → v1: rekey "uma1:*" / "uma2:*" composite keys to the legacy fieldIds.
  const skillMetaByKey: Record<string, SkillCostMeta> = {};
  for (const [key, meta] of Object.entries(state.skillMetaByKey ?? {})) {
    const separatorIndex = key.indexOf(':');
    if (separatorIndex === -1) {
      skillMetaByKey[key] = meta;
      continue;
    }
    const runnerId = key.slice(0, separatorIndex);
    const skillId = key.slice(separatorIndex + 1);
    skillMetaByKey[`${rekeyRunnerId(runnerId)}:${skillId}`] = meta;
  }

  const runnerSettingsById: Record<string, RunnerCostSettings> = {};
  for (const [runnerId, settings] of Object.entries(state.runnerSettingsById ?? {})) {
    runnerSettingsById[rekeyRunnerId(runnerId)] = settings;
  }

  return { skillMetaByKey, runnerSettingsById };
};

export const useSkillCostMetaStore = create<SkillCostMetaState>()(
  persist(
    (_) => ({
      skillMetaByKey: {},
      runnerSettingsById: {}
    }),
    {
      name: SKILL_COST_META_STORE_NAME,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (persistedState, version) => migrateSkillCostMetaPersisted(persistedState, version)
    }
  )
);

// Actions

const updateSkillMeta = (runnerId: string, skillId: string, updates: Partial<SkillCostMeta>) => {
  useSkillCostMetaStore.setState((state) => {
    const key = getSkillKey(runnerId, skillId);
    const current = resolveMeta(state, runnerId, skillId);
    const normalized = normalizeMeta({ ...current, ...updates });

    if (!normalized) {
      const next = { ...state.skillMetaByKey };
      delete next[key];
      return { skillMetaByKey: next };
    }

    return {
      skillMetaByKey: {
        ...state.skillMetaByKey,
        [key]: normalized
      }
    };
  });
};

export const setHintLevel = (runnerId: string, skillId: string, hintLevel: HintLevel) => {
  updateSkillMeta(runnerId, skillId, { hintLevel });
};

export const setBought = (runnerId: string, skillId: string, bought: boolean) => {
  useSkillCostMetaStore.setState((state) => {
    const nextSkillMetaByKey = { ...state.skillMetaByKey };

    const applyBoughtState = (targetSkillId: string, isBought: boolean) => {
      const key = getSkillKey(runnerId, targetSkillId);
      const current = resolveMeta(
        { ...state, skillMetaByKey: nextSkillMetaByKey },
        runnerId,
        targetSkillId
      );
      const normalized = normalizeMeta({ ...current, bought: isBought });

      if (!normalized) {
        delete nextSkillMetaByKey[key];
        return;
      }

      nextSkillMetaByKey[key] = normalized;
    };

    applyBoughtState(skillId, bought);

    const baseTierId = getBaseTier(skillId);
    const upgradeTierId = getUpgradeTier(baseTierId);
    if (upgradeTierId && skillId === upgradeTierId && baseTierId && bought) {
      applyBoughtState(baseTierId, true);
    }

    if (upgradeTierId && skillId === baseTierId && !bought) {
      applyBoughtState(upgradeTierId, false);
    }

    return { skillMetaByKey: nextSkillMetaByKey };
  });
};

const setReceived = (runnerId: string, skillId: string, received: boolean) => {
  updateSkillMeta(runnerId, skillId, { received });
};

const setRemoved = (runnerId: string, skillId: string, removed: boolean) => {
  updateSkillMeta(runnerId, skillId, { removed });
};

export const getSkillCostMeta = (runnerId: string, skillId: string): SkillCostMeta => {
  const state = useSkillCostMetaStore.getState();
  return resolveMeta(state, runnerId, skillId);
};

const getNetCostForSkill = (runnerId: string, skillId: string): number => {
  const state = useSkillCostMetaStore.getState();
  const meta = resolveMeta(state, runnerId, skillId);

  if (meta.bought) {
    return 0;
  }

  return calculateSkillCost(
    skillId,
    meta.hintLevel,
    state.runnerSettingsById[runnerId]?.hasFastLearner ?? false
  );
};

export function computeSkillCostSummary(
  skillId: string,
  runnerId: string,
  skillMetaMap: Record<string, SkillCostMeta>,
  hasFastLearner: boolean
) {
  return buildSkillCostSummary({
    skillId,
    hasFastLearner,
    getSkillMeta: (targetSkillId) => {
      const key = `${runnerId}:${targetSkillId}`;
      return skillMetaMap[key] ?? DEFAULT_META;
    }
  });
}

/**
 * Computes the total net cost for a skill, including representative prerequisite/family costs.
 */
function computeTotalNetCost(
  skillId: string,
  runnerId: string,
  skillMetaMap: Record<string, SkillCostMeta>,
  hasFastLearner: boolean
): number {
  return computeSkillCostSummary(skillId, runnerId, skillMetaMap, hasFastLearner).netTotal;
}

export const setFastLearner = (runnerId: string, hasFastLearner: boolean) => {
  useSkillCostMetaStore.setState((state) => ({
    runnerSettingsById: {
      ...state.runnerSettingsById,
      [runnerId]: { hasFastLearner }
    }
  }));
};

const runnerHasFastLearner = (runnerId: string): boolean => {
  return useSkillCostMetaStore.getState().runnerSettingsById[runnerId]?.hasFastLearner ?? false;
};

const useSkillCostMeta = (runnerId: string, skillId: string) => {
  return useSkillCostMetaStore(useShallow((state) => resolveMeta(state, runnerId, skillId)));
};

export const useRunnerHasFastLearner = (runnerId: string) => {
  return useSkillCostMetaStore(
    useShallow((state) => {
      const runner = state.runnerSettingsById[runnerId];
      if (!runner) {
        return false;
      }

      return runner.hasFastLearner;
    })
  );
};
