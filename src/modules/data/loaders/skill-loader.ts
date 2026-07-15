import type {
  SkillActivationCheck,
  SkillEntry,
  SkillReferenceEntry,
  SkillsMap
} from '@/modules/data/services/SkillService';
import type { SkillAlternative } from '@/lib/uma-domain/skills/skill.types';

type GameToraEffect = {
  type: number;
  value: number;
  target?: number;
  target_type?: number;
  value_scale?: number;
  value_usage?: number;
  value_level_usage?: number;
};

type GameToraConditionGroup = {
  base_time: number;
  cooldown_time?: number;
  condition?: string;
  precondition?: string;
  effects?: Array<GameToraEffect>;
};

type GameToraGeneVersion = {
  id: number;
  rarity: number;
  activation: number;
  iconid?: number;
  cost?: number;
  enname?: string;
  name_en?: string;
  jpname?: string;
  endesc?: string;
  desc_en?: string;
  condition_groups?: Array<GameToraConditionGroup>;
  parent_skills?: Array<number>;
};

type GameToraLocalizedSkill = {
  condition_groups?: Array<GameToraConditionGroup>;
  char?: Array<number>;
  gene_version?: Partial<GameToraGeneVersion>;
  type?: string | Array<string>;
  enname?: string;
  name_en?: string;
  endesc?: string;
  desc_en?: string;
};

type SkillSnapshot = {
  id: number;
  rarity: number;
  activation: number;
  iconid?: number;
  cost?: number;
  enname?: string;
  name_en?: string;
  jpname?: string;
  endesc?: string;
  desc_en?: string;
  char?: Array<number>;
  type?: string | Array<string>;
  condition_groups?: Array<GameToraConditionGroup>;
  gene_version?: GameToraGeneVersion;
  loc?: {
    en?: GameToraLocalizedSkill;
  };
};

type ResolvedGameToraSkillSnapshot = Omit<SkillSnapshot, 'gene_version'> & {
  gene_version?: GameToraGeneVersion;
};

export type LoadSkillsResult = {
  skills: SkillsMap;
  releasedSkillIds: Set<string>;
  activationChecks: Record<string, SkillActivationCheck>;
};

function cloneSkillEntry(entry: SkillEntry): SkillEntry {
  return {
    ...entry,
    tags: [...(entry.tags ?? [])],
    alternatives: entry.alternatives.map((alternative) => ({
      ...alternative,
      effects: alternative.effects.map((effect) => ({ ...effect }))
    })),
    versions: [...entry.versions],
    family: entry.family.map((familyEntry) => ({ ...familyEntry })),
    character: [...entry.character],
    sources: entry.sources?.map((source) => ({ ...source })),
    supportSources: entry.supportSources?.map((source) => ({ ...source })),
    gene_version: entry.gene_version ? { ...entry.gene_version } : undefined,
    unique_version: entry.unique_version ? { ...entry.unique_version } : undefined
  };
}

function resolveLocalizedGeneVersion(skill: SkillSnapshot): GameToraGeneVersion | undefined {
  const { gene_version: geneVersion } = skill;

  if (!geneVersion) {
    return undefined;
  }

  const localizedGeneVersion = skill.loc?.en?.gene_version;
  if (!localizedGeneVersion) {
    return geneVersion;
  }

  return {
    ...geneVersion,
    ...localizedGeneVersion,
    condition_groups: localizedGeneVersion.condition_groups ?? geneVersion.condition_groups
  };
}

function resolveLocalizedSkill(skill: SkillSnapshot): ResolvedGameToraSkillSnapshot {
  const localizedSkill = skill.loc?.en;

  return {
    ...skill,
    ...localizedSkill,
    condition_groups: localizedSkill?.condition_groups ?? skill.condition_groups,
    char: localizedSkill?.char ?? skill.char,
    type: localizedSkill?.type ?? skill.type,
    gene_version: resolveLocalizedGeneVersion(skill)
  };
}

function resolveSkillName(
  value: {
    name_en?: string;
    enname?: string;
    jpname?: string;
  },
  fallbackName?: string
): string {
  return value.name_en || value.enname || fallbackName || value.jpname || '';
}

function resolveActivationCheck(activation: number | undefined): SkillActivationCheck {
  return activation === 1 ? 'wit-check' : 'guaranteed';
}

function mergeAlternatives(
  groups: Array<GameToraConditionGroup> | undefined,
  existingAlternatives: Array<SkillAlternative> | undefined
): Array<SkillAlternative> {
  if (!groups || groups.length === 0) {
    return (
      existingAlternatives?.map((alternative) => ({
        ...alternative,
        effects: alternative.effects.map((effect) => ({ ...effect }))
      })) ?? []
    );
  }

  return groups.map((group, groupIndex) => {
    const existingAlternative = existingAlternatives?.[groupIndex];

    return {
      baseDuration: group.base_time,
      cooldownTime: group.cooldown_time ?? existingAlternative?.cooldownTime,
      condition: group.condition ?? '',
      precondition: group.precondition ?? existingAlternative?.precondition,
      effects: (group.effects ?? []).map((effect, effectIndex) => {
        const existingEffect = existingAlternative?.effects[effectIndex];

        return {
          type: effect.type,
          modifier: effect.value,
          target: (effect.target_type ??
            effect.target ??
            existingEffect?.target ??
            1) as SkillAlternative['effects'][number]['target'],
          valueUsage: effect.value_usage ?? effect.value_scale ?? existingEffect?.valueUsage,
          valueLevelUsage: effect.value_level_usage ?? existingEffect?.valueLevelUsage
        };
      })
    };
  });
}

function toReferenceEntry(value: {
  id: string | number;
  name: string;
  rarity: number;
  iconId: string | number;
}): SkillReferenceEntry {
  return {
    id: Number(value.id),
    name: value.name,
    rarity: value.rarity,
    iconId: String(value.iconId)
  };
}

type BuildMergedSkillEntryParams = {
  resolvedSkill: ResolvedGameToraSkillSnapshot | GameToraGeneVersion;
  existingEntry?: SkillEntry;
  character: Array<number>;
  defaultGroupId?: number;
  defaultOrder?: number;
  defaultBaseCost?: number;
  defaultType?: string | Array<string>;
};

function buildMergedSkillEntry(params: BuildMergedSkillEntryParams): SkillEntry {
  const {
    resolvedSkill,
    existingEntry,
    character,
    defaultGroupId = 0,
    defaultOrder = 0,
    defaultBaseCost = 0,
    defaultType = ''
  } = params;

  const resolvedIconId =
    existingEntry?.iconId ??
    ('iconid' in resolvedSkill && resolvedSkill.iconid !== undefined
      ? String(resolvedSkill.iconid)
      : '');

  return {
    ...existingEntry,
    id: String(resolvedSkill.id),
    rarity: resolvedSkill.rarity,
    tags: existingEntry?.tags ? [...existingEntry.tags] : [],
    alternatives: mergeAlternatives(resolvedSkill.condition_groups, existingEntry?.alternatives),
    groupId: existingEntry?.groupId ?? defaultGroupId,
    versions: existingEntry?.versions ? [...existingEntry.versions] : [],
    family: existingEntry?.family ? existingEntry.family.map((entry) => ({ ...entry })) : [],
    iconId: resolvedIconId,
    baseCost:
      existingEntry?.baseCost ??
      ('cost' in resolvedSkill ? (resolvedSkill.cost ?? defaultBaseCost) : defaultBaseCost),
    gradeValue: existingEntry?.gradeValue ?? 0,
    order: existingEntry?.order ?? defaultOrder,
    name: resolveSkillName(resolvedSkill, existingEntry?.name),
    character: character.length > 0 ? [...character] : [...(existingEntry?.character ?? [])],
    sources: existingEntry?.sources?.map((source) => ({ ...source })),
    supportSources: existingEntry?.supportSources?.map((source) => ({ ...source })),
    gene_version: existingEntry?.gene_version ? { ...existingEntry.gene_version } : undefined,
    unique_version: existingEntry?.unique_version ? { ...existingEntry.unique_version } : undefined,
    type: existingEntry?.type ?? defaultType,
    description: existingEntry?.description,
    descriptionGametora:
      existingEntry?.descriptionGametora ??
      ('endesc' in resolvedSkill ? resolvedSkill.endesc : undefined) ??
      'No English description yet',
    lastUpdated: existingEntry?.lastUpdated ?? 'unreleased'
  };
}

function compareParentReferences(a: SkillReferenceEntry, b: SkillReferenceEntry): number {
  return b.rarity - a.rarity || String(a.id).localeCompare(String(b.id));
}

export function loadSkills(
  masterSkills: SkillsMap,
  gameToraSkills: Array<SkillSnapshot>
): LoadSkillsResult {
  const releasedSkillIds = new Set(Object.keys(masterSkills));
  const activationChecks: Record<string, SkillActivationCheck> = {};
  const mergedSkills: SkillsMap = Object.fromEntries(
    Object.entries(masterSkills).map(([skillId, skill]) => [skillId, cloneSkillEntry(skill)])
  );
  const geneParentReferences = new Map<string, Array<SkillReferenceEntry>>();
  const skillGeneLinks: Array<{ skillId: string; geneSkillId: string }> = [];

  for (const rawSkill of gameToraSkills) {
    const resolvedSkill = resolveLocalizedSkill(rawSkill);
    const skillId = String(resolvedSkill.id);
    const existingSkillEntry = mergedSkills[skillId];
    const character = resolvedSkill.char ?? existingSkillEntry?.character ?? [];

    mergedSkills[skillId] = buildMergedSkillEntry({
      resolvedSkill,
      existingEntry: existingSkillEntry,
      character,
      defaultBaseCost: resolvedSkill.cost ?? 0,
      defaultType: resolvedSkill.type
    });
    activationChecks[skillId] = resolveActivationCheck(resolvedSkill.activation);

    if (!resolvedSkill.gene_version) {
      continue;
    }

    const geneVersion = resolvedSkill.gene_version;
    const geneSkillId = String(geneVersion.id);
    const existingGeneEntry = mergedSkills[geneSkillId];

    mergedSkills[geneSkillId] = buildMergedSkillEntry({
      resolvedSkill: geneVersion,
      existingEntry: existingGeneEntry,
      character,
      defaultBaseCost: geneVersion.cost ?? 0,
      defaultType: resolvedSkill.type
    });

    // Inherit parent's name when the gene version has no name of its own
    if (!mergedSkills[geneSkillId].name && mergedSkills[skillId]?.name) {
      mergedSkills[geneSkillId].name = mergedSkills[skillId].name;
    }
    activationChecks[geneSkillId] = resolveActivationCheck(geneVersion.activation);

    skillGeneLinks.push({ skillId, geneSkillId });

    const parentReference = toReferenceEntry({
      id: skillId,
      name: mergedSkills[skillId].name,
      rarity: mergedSkills[skillId].rarity,
      iconId: mergedSkills[skillId].iconId
    });
    const parentReferences = geneParentReferences.get(geneSkillId) ?? [];

    if (!parentReferences.some((reference) => reference.id === parentReference.id)) {
      parentReferences.push(parentReference);
      geneParentReferences.set(geneSkillId, parentReferences);
    }
  }

  for (const { skillId, geneSkillId } of skillGeneLinks) {
    const skillEntry = mergedSkills[skillId];
    const geneEntry = mergedSkills[geneSkillId];

    if (!skillEntry || !geneEntry) {
      continue;
    }

    skillEntry.gene_version = toReferenceEntry({
      id: geneEntry.id,
      name: geneEntry.name,
      rarity: geneEntry.rarity,
      iconId: geneEntry.iconId
    });
  }

  for (const [geneSkillId, parentReferences] of geneParentReferences) {
    const geneEntry = mergedSkills[geneSkillId];

    if (!geneEntry) {
      continue;
    }

    if (geneEntry.unique_version) {
      continue;
    }

    const canonicalParent = [...parentReferences].sort(compareParentReferences)[0];
    if (!canonicalParent) {
      continue;
    }

    geneEntry.unique_version = { ...canonicalParent };
  }

  return {
    skills: mergedSkills,
    releasedSkillIds,
    activationChecks
  };
}
