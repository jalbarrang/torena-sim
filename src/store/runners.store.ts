import { create } from 'zustand';

import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import { toast } from 'sonner';
import { cloneDeep } from 'es-toolkit';
import type { IRunnerState } from '@/modules/runners/components/runner-card/types';
import { createRunnerState, runawaySkillId } from '@/modules/runners/components/runner-card/types';
import { getGeneVersionSkillId, getUniqueSkillForByUmaId } from '@/modules/skills/utils';
import { skillsService } from '@/modules/data/services/SkillService';

export const MIN_RUNNERS = 2;
export const MAX_RUNNERS = 12;

/**
 * Deterministic field ids assigned to the legacy `uma1`/`uma2` runners during
 * the v0 → v1 persist migration. The skill-cost-meta store's migration rekeys
 * its `"uma1:*"` / `"uma2:*"` composite keys (and `runnerSettingsById`) onto
 * these exact ids without cross-store coordination — keep both migrations in
 * sync. See `skill-cost-meta.store.ts`.
 */
export const LEGACY_FIELD_ID_A = 'legacy-uma1';
export const LEGACY_FIELD_ID_B = 'legacy-uma2';

/** A runner in the field with a stable identity. */
export type FieldRunner = IRunnerState & { fieldId: string };

/**
 * Compare-pair role. The whole app keeps the compare pair keyed by these two
 * role ids (`uma1` = compare slot A, `uma2` = compare slot B). Everything scoped
 * to the pair — stats, injected debuffs, forced positions, scenario overrides,
 * racetrack overlays — stays role-keyed; only the runners store resolves a role
 * to the underlying `fieldId`.
 */
export type CompareRole = 'uma1' | 'uma2';

type IRunnersStore = {
  runners: Array<FieldRunner>;
  compareA: string; // fieldId in slot A
  compareB: string; // fieldId in slot B
  editingId: string; // fieldId shown in the editor
};

const createFieldId = () => crypto.randomUUID();

const isRunnerState = (value: unknown): value is IRunnerState => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.outfitId === 'string' &&
    typeof v.speed === 'number' &&
    typeof v.stamina === 'number' &&
    typeof v.power === 'number' &&
    typeof v.guts === 'number' &&
    typeof v.wisdom === 'number' &&
    typeof v.strategy === 'string' &&
    Array.isArray(v.skills)
  );
};

const isFieldRunner = (value: unknown): value is FieldRunner => {
  return (
    isRunnerState(value) &&
    typeof (value as Record<string, unknown>).fieldId === 'string' &&
    (value as Record<string, unknown>).fieldId !== ''
  );
};

const createDefaultState = (): IRunnersStore => {
  const a: FieldRunner = { ...createRunnerState(), fieldId: createFieldId() };
  const b: FieldRunner = { ...createRunnerState(), fieldId: createFieldId() };
  return { runners: [a, b], compareA: a.fieldId, compareB: b.fieldId, editingId: a.fieldId };
};

/**
 * Validate an untrusted persisted blob into a well-formed store, or return
 * `null` when it cannot be repaired. Enforces the field-size (2..=12), unique
 * `fieldId`, and `compareA !== compareB` invariants. Never throws.
 */
const validateState = (value: unknown): IRunnersStore | null => {
  if (typeof value !== 'object' || value === null) return null;
  const s = value as Partial<IRunnersStore>;
  if (!Array.isArray(s.runners)) return null;

  const runners = s.runners.filter(isFieldRunner);
  if (runners.length < MIN_RUNNERS || runners.length > MAX_RUNNERS) return null;

  const ids = new Set(runners.map((r) => r.fieldId));
  if (ids.size !== runners.length) return null;

  const compareA = typeof s.compareA === 'string' && ids.has(s.compareA) ? s.compareA : runners[0].fieldId;
  let compareB = typeof s.compareB === 'string' && ids.has(s.compareB) ? s.compareB : runners[1].fieldId;
  if (compareB === compareA) {
    compareB = runners.find((r) => r.fieldId !== compareA)!.fieldId;
  }
  const editingId = typeof s.editingId === 'string' && ids.has(s.editingId) ? s.editingId : compareA;

  return { runners, compareA, compareB, editingId };
};

type LegacyRunnersBlob = {
  uma1?: unknown;
  uma2?: unknown;
  runnerId?: unknown;
};

/** Migrate the legacy `{ uma1, uma2, runnerId }` blob (stored version 0/undefined). */
const migrateLegacy = (blob: LegacyRunnersBlob): IRunnersStore => {
  const uma1 = isRunnerState(blob.uma1) ? blob.uma1 : createRunnerState();
  const uma2 = isRunnerState(blob.uma2) ? blob.uma2 : createRunnerState();
  const a: FieldRunner = { ...cloneDeep(uma1), fieldId: LEGACY_FIELD_ID_A };
  const b: FieldRunner = { ...cloneDeep(uma2), fieldId: LEGACY_FIELD_ID_B };
  const editingId = blob.runnerId === 'uma2' ? LEGACY_FIELD_ID_B : LEGACY_FIELD_ID_A;
  return { runners: [a, b], compareA: LEGACY_FIELD_ID_A, compareB: LEGACY_FIELD_ID_B, editingId };
};

/** Persist migration for the runners store (exported for unit tests). */
export const migrateRunnersPersisted = (
  persistedState: unknown,
  version: number
): IRunnersStore => {
  try {
    if (version >= 1) {
      return validateState(persistedState) ?? createDefaultState();
    }
    return migrateLegacy((persistedState ?? {}) as LegacyRunnersBlob);
  } catch {
    return createDefaultState();
  }
};

export const useRunnersStore = create<IRunnersStore>()(
  persist((_) => createDefaultState(), {
    name: 'umalator-runners',
    storage: createJSONStorage(() => localStorage),
    version: 1,
    migrate: migrateRunnersPersisted,
    merge: (persistedState, currentState) => {
      return validateState(persistedState) ?? currentState;
    }
  })
);

const getState = () => useRunnersStore.getState();

const findRunner = (fieldId: string): FieldRunner | undefined => {
  return getState().runners.find((r) => r.fieldId === fieldId);
};

/** Resolve a compare role to the fieldId currently holding it. */
export const getCompareFieldId = (role: CompareRole): string => {
  const s = getState();
  return role === 'uma1' ? s.compareA : s.compareB;
};

// Hooks

const useRunnerByFieldId = (fieldId: string): FieldRunner => {
  return useRunnersStore(
    useShallow((state) => state.runners.find((r) => r.fieldId === fieldId) ?? state.runners[0])
  );
};

export const useCompareRoles = () => {
  return useRunnersStore(useShallow((state) => ({ compareA: state.compareA, compareB: state.compareB })));
};

/**
 * The two compare-pair runners resolved from their roles. `uma1` = slot A,
 * `uma2` = slot B (pair-role aliasing). Use when a consumer wants the pair as
 * the legacy `{ uma1, uma2 }` shape.
 */
export const useComparePairRunners = () => {
  return useRunnersStore(
    useShallow((state) => ({
      uma1: state.runners.find((r) => r.fieldId === state.compareA) ?? state.runners[0],
      uma2: state.runners.find((r) => r.fieldId === state.compareB) ?? state.runners[1]
    }))
  );
};

/** Non-hook read of the compare-pair + context runners. */
export const getFieldRunners = () => {
  const s = getState();
  const uma1 = s.runners.find((r) => r.fieldId === s.compareA) ?? s.runners[0];
  const uma2 = s.runners.find((r) => r.fieldId === s.compareB) ?? s.runners[1];
  const context = s.runners.filter((r) => r.fieldId !== s.compareA && r.fieldId !== s.compareB);
  return { uma1, uma2, context };
};

export const useRunners = () => {
  return useRunnersStore(useShallow((state) => state.runners));
};

export const useRunner = () => {
  const editingId = useRunnersStore(useShallow((state) => state.editingId));
  const runner = useRunnerByFieldId(editingId);

  const hasOutfit = runner.outfitId !== '';
  const hasRunawaySkill = runner.skills.includes(runawaySkillId);

  const handleUpdateRunner = (runnerState: IRunnerState) => {
    setRunner(editingId, runnerState);
  };

  const handleResetRunner = () => {
    resetCompareRunner(editingId);
    toast.success('Runner reset');
  };

  const handleAddSkill = (skillId: string) => {
    const skill = skillsService.getById(skillId);
    const skillRarity = skill?.rarity;
    let newSkillId = skillId;

    // If Runner has outfit, it means it has a unique skill.
    // So if we are adding a unique skill, add the gene version instead
    if (hasOutfit && skillRarity && isUniqueSkill(skillRarity)) {
      newSkillId = getGeneVersionSkillId(skillId);
    }

    setSkillToRunner(editingId, newSkillId);
  };

  return {
    runnerId: editingId,
    runner,
    updateRunner: handleUpdateRunner,
    resetRunner: handleResetRunner,
    addSkill: handleAddSkill,
    hasRunawaySkill
  };
};

// Mutators (all keyed by fieldId)

const mapRunner = (fieldId: string, fn: (runner: FieldRunner) => FieldRunner) => {
  useRunnersStore.setState((prev) => ({
    runners: prev.runners.map((r) => (r.fieldId === fieldId ? fn(r) : r))
  }));
};

export const setRunner = (fieldId: string, runnerState: IRunnerState) => {
  mapRunner(fieldId, () => ({ ...cloneDeep(runnerState), fieldId }));
};

const resetCompareRunner = (fieldId: string) => {
  mapRunner(fieldId, () => ({ ...createRunnerState(), fieldId }));
};

export const resetAllRunners = () => {
  useRunnersStore.setState((prev) => {
    const compareA = prev.compareA;
    const compareB = prev.compareB;
    return {
      runners: [
        { ...createRunnerState(), fieldId: compareA },
        { ...createRunnerState(), fieldId: compareB }
      ],
      compareA,
      compareB,
      editingId: compareA
    };
  });

  toast.success('All runners reset');
};

export const showRunner = (fieldId: string) => {
  if (!findRunner(fieldId)) return;
  useRunnersStore.setState({ editingId: fieldId });
};

/**
 * Replace the entire field (used by snapshot import). Mints fresh fieldIds,
 * clamps to {@link MAX_RUNNERS}, backfills to {@link MIN_RUNNERS}, and resolves
 * the compare pair from the given indices (guaranteeing `A !== B`).
 */
export const replaceField = (
  runnerStates: Array<IRunnerState>,
  compareAIndex: number,
  compareBIndex: number
) => {
  const runners: Array<FieldRunner> = runnerStates
    .slice(0, MAX_RUNNERS)
    .map((r) => ({ ...cloneDeep(r), fieldId: createFieldId() }));

  while (runners.length < MIN_RUNNERS) {
    runners.push({ ...createRunnerState(), fieldId: createFieldId() });
  }

  const compareA = runners[compareAIndex]?.fieldId ?? runners[0].fieldId;
  let compareB = runners[compareBIndex]?.fieldId ?? runners[1].fieldId;
  if (compareB === compareA) {
    compareB = runners.find((r) => r.fieldId !== compareA)!.fieldId;
  }

  useRunnersStore.setState({ runners, compareA, compareB, editingId: compareA });
};

/** Add a default runner (up to {@link MAX_RUNNERS}); returns its fieldId or `null`. */
export const addRunner = (): string | null => {
  const s = getState();
  if (s.runners.length >= MAX_RUNNERS) {
    toast.error(`Maximum ${MAX_RUNNERS} runners`);
    return null;
  }

  const runner: FieldRunner = { ...createRunnerState(), fieldId: createFieldId() };
  useRunnersStore.setState((prev) => ({ runners: [...prev.runners, runner] }));

  return runner.fieldId;
};

/** Remove a runner (never below {@link MIN_RUNNERS}); reassigns A/B roles as needed. */
export const removeRunner = (fieldId: string) => {
  const s = getState();
  if (s.runners.length <= MIN_RUNNERS) {
    toast.error(`Minimum ${MIN_RUNNERS} runners`);
    return;
  }
  if (!findRunner(fieldId)) return;

  const remaining = s.runners.filter((r) => r.fieldId !== fieldId);
  let compareA = s.compareA;
  let compareB = s.compareB;
  let editingId = s.editingId;

  if (compareA === fieldId) {
    compareA = remaining.find((r) => r.fieldId !== compareB)!.fieldId;
  }
  if (compareB === fieldId) {
    compareB = remaining.find((r) => r.fieldId !== compareA)!.fieldId;
  }
  if (editingId === fieldId) {
    editingId = compareA;
  }

  useRunnersStore.setState({ runners: remaining, compareA, compareB, editingId });
};

/** Assign `fieldId` to a compare role; the displaced holder becomes a context runner. */
export const setCompareRole = (fieldId: string, role: CompareRole) => {
  const s = getState();
  if (!findRunner(fieldId)) return;

  if (role === 'uma1') {
    const compareB = s.compareB === fieldId ? s.compareA : s.compareB;
    useRunnersStore.setState({ compareA: fieldId, compareB });
  } else {
    const compareA = s.compareA === fieldId ? s.compareB : s.compareA;
    useRunnersStore.setState({ compareB: fieldId, compareA });
  }
};

export const setSkillToRunner = (fieldId: string, skillId: string) => {
  const runner = findRunner(fieldId);
  if (!runner) return;

  if (runner.skills.includes(skillId)) {
    toast.error('Runner already has this skill');
    return;
  }

  mapRunner(fieldId, (r) => {
    const next = cloneDeep(r);
    next.skills.push(skillId);
    return next;
  });
};

export const swapWithRunner = (fromFieldId: string, toFieldId: string) => {
  const from = findRunner(fromFieldId);
  const to = findRunner(toFieldId);
  if (!from || !to) return;

  useRunnersStore.setState((prev) => ({
    runners: prev.runners.map((r) => {
      if (r.fieldId === fromFieldId) return { ...cloneDeep(to), fieldId: fromFieldId };
      if (r.fieldId === toFieldId) return { ...cloneDeep(from), fieldId: toFieldId };
      return r;
    })
  }));
};

export const copyToRunner = (fromFieldId: string, toFieldId: string) => {
  const from = findRunner(fromFieldId);
  if (!from) return;

  mapRunner(toFieldId, () => ({ ...cloneDeep(from), fieldId: toFieldId }));
  toast.success('Runner copied');
};

export const replaceRunnerOutfit = (
  runner: IRunnerState,
  newOutfitId: string,
  currentSkills: Array<string>
): IRunnerState => {
  const newSkills: Array<string> = [];

  for (const skillId of currentSkills) {
    const skillData = skillsService.getById(skillId);

    // Clean up skills that are not 3* or lower
    if (skillData?.rarity && skillData.rarity < 3) {
      newSkills.push(skillId);
    }
  }

  if (newOutfitId) {
    newSkills.push(getUniqueSkillForByUmaId(newOutfitId));
  }

  const newRunnerState = cloneDeep(runner);
  newRunnerState.outfitId = newOutfitId;
  newRunnerState.skills = newSkills;

  return newRunnerState;
};

export const isWhiteSkill = (skillRarity: number) => {
  return skillRarity === 1;
};

export const isGoldSkill = (skillRarity: number) => {
  return skillRarity === 2;
};

export const isUniqueSkill = (skillRarity: number) => {
  return [3, 4, 5].includes(skillRarity);
};

export const isEvolutionSkill = (skillRarity: number) => {
  return skillRarity === 6;
};

// Library Integration Functions

export const loadRunnerFromLibrary = (
  fieldId: string,
  libraryRunner: IRunnerState & { id: string }
) => {
  const runnerData = cloneDeep(libraryRunner);
  runnerData.linkedRunnerId = libraryRunner.id;

  mapRunner(fieldId, () => ({ ...runnerData, fieldId }));
  toast.success(`Loaded "${libraryRunner.id}" to simulation`);
};

export const syncRunnerToLibrary = (fieldId: string) => {
  const runnerState = findRunner(fieldId);

  if (!runnerState?.linkedRunnerId) {
    toast.error('No linked runner to sync');
    return null;
  }

  return runnerState.linkedRunnerId;
};

export const unlinkRunner = (fieldId: string) => {
  mapRunner(fieldId, (r) => {
    const next = cloneDeep(r);
    delete next.linkedRunnerId;
    return next;
  });

  toast.success('Runner unlinked from library');
};

export const linkRunner = (fieldId: string, libraryRunnerId: string) => {
  mapRunner(fieldId, (r) => {
    const next = cloneDeep(r);
    next.linkedRunnerId = libraryRunnerId;
    return next;
  });

  toast.success('Runner linked to library');
};
