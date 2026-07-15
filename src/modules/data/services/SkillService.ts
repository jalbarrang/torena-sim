import { ISkillType } from '@/lib/uma-domain/skills/definitions';
import type { SkillAlternative } from '@/lib/uma-domain/skills/skill.types';
import {
  areAlternativesSimulatable,
  findUnsupportedSkillMechanics,
  findUnknownConditionTokens,
  type UnsupportedSkillMechanic
} from '@/lib/uma-domain/skills/simulatability';
import type { SkillMatch } from '@/modules/runners/data/types';
import { SkillFilterer, type SkillFiltererConfig } from './SkillFilterer';
import type { LoadSkillsResult } from '@/modules/data/loaders/skill-loader';

// =======
// Types
// =======

export type SkillReferenceEntry = {
  id: number;
  name: string;
  rarity: number;
  iconId: string;
};

type SkillGeneVersionEntry = SkillReferenceEntry;

export type SkillUmaSourceEntry = {
  outfitId: number;
  needRank: number;
  name: string;
  outfit: string;
};

export type SkillSupportCardSourceEntry = {
  supportCardId: number;
  charaId: number;
  rarity: number;
  supportCardType: number;
  name: string;
  sourceType?: 'hint' | 'event' | 'chain-event' | 'random-event';
};

export type SkillActivationCheck = 'guaranteed' | 'wit-check';

export type SkillEntry = {
  id: string;
  rarity: number;
  /** Authoritative `skill_data.tag_id` values from master data. */
  tags: Array<number>;
  alternatives: Array<SkillAlternative>;
  groupId: number;
  versions: Array<number>;
  family: Array<SkillReferenceEntry>;
  iconId: string;
  baseCost: number;
  /** Per-skill evaluation-point contribution (master.mdb skill_data.grade_value). */
  gradeValue: number;
  order: number;
  name: string;
  /** Uma outfit ids that can provide this skill. */
  character: Array<number>;
  sources?: Array<SkillUmaSourceEntry>;
  /** Support cards that grant this skill (hints from master extract, events from GameTora). */
  supportSources?: Array<SkillSupportCardSourceEntry>;
  gene_version?: SkillGeneVersionEntry;
  unique_version?: SkillGeneVersionEntry;
  type?: string | Array<string>;
  /** Earliest known release date (YYYY-MM-DD) from character/support card data. */
  releaseDate?: string;
  /** Official EN description from master.mdb text_data category 48. Empty for skills not yet in master. */
  description?: string;
  /** In-game EN description from GameTora (endesc, fallback desc_en). */
  descriptionGametora?: string;
  /** Date (YYYY-MM-DD) the skill's mechanics/description last changed, or "unreleased" if not in the current master.mdb extract. */
  lastUpdated?: string;
};

export type SkillsMap = Record<string, SkillEntry>;

export type SkillLookupEntry = {
  id: string;
  geneId?: string;
  name: string;
  rarity: number;
  released: boolean;
};

export type SkillServiceOptions = {
  releasedSkillIds: Iterable<string>;
  activationChecks: Record<string, SkillActivationCheck>;
};

export class SkillService {
  private readonly skillCollection: SkillsMap;
  private readonly releasedSkillIds: Set<string>;
  private readonly activationChecks: Map<string, SkillActivationCheck>;

  private skillLookup: Map<string, SkillLookupEntry> | null = null;
  private skillLookupCandidates: Map<string, Array<SkillLookupEntry>> | null = null;
  private simulatabilityCache: Map<string, boolean> | null = null;

  constructor(skillsData: SkillsMap, options: SkillServiceOptions) {
    const { releasedSkillIds, activationChecks } = options;

    this.skillCollection = skillsData;

    this.releasedSkillIds = new Set(releasedSkillIds ?? Object.keys(skillsData));
    this.activationChecks = new Map(Object.entries(activationChecks ?? {}));
  }

  // ============
  // Simulatability
  // ============

  /**
   * Whether a skill's conditions can be fully parsed by the simulation engine.
   * Skills with unknown condition tokens return false — they can be displayed
   * but must not enter the simulator.
   */
  isSimulatable = (skillId: string): boolean => {
    if (!this.simulatabilityCache) {
      this.simulatabilityCache = new Map();
    }

    const cached = this.simulatabilityCache.get(skillId);
    if (cached !== undefined) return cached;

    const skill = this.skillCollection[skillId];
    if (!skill) {
      this.simulatabilityCache.set(skillId, false);
      return false;
    }

    const result = areAlternativesSimulatable(skill.alternatives);
    this.simulatabilityCache.set(skillId, result);
    return result;
  };

  /**
   * Returns unknown condition tokens for a skill, or an empty array if fully supported.
   * Useful for debug/UI display of why a skill can't be simulated.
   */
  getUnsupportedTokens = (skillId: string): Array<string> => {
    const skill = this.skillCollection[skillId];
    if (!skill) return [];
    return findUnknownConditionTokens(skill.alternatives);
  };

  /** Returns structured condition and value-policy reasons a skill cannot run. */
  getUnsupportedMechanics = (skillId: string): Array<UnsupportedSkillMechanic> => {
    const skill = this.skillCollection[skillId];
    if (!skill) return [];
    return findUnsupportedSkillMechanics(skill.alternatives);
  };

  /**
   * Filter a list of skill IDs to only those that are simulatable.
   */
  filterSimulatable = (skillIds: Array<string>): Array<string> => {
    return skillIds.filter(this.isSimulatable);
  };

  isReleased = (skillId: string): boolean => {
    return this.releasedSkillIds.has(skillId);
  };

  getActivationCheck = (skillId: string): SkillActivationCheck | undefined => {
    return this.activationChecks.get(skillId);
  };

  // ============
  // Filterer Factory
  // ============

  createFilterer = (config: SkillFiltererConfig): SkillFilterer => {
    return new SkillFilterer(this, config);
  };

  // ============
  // Utils
  // ===========

  skillComparator = (a: string, b: string): number => {
    const x = this.skillCollection[a].order;
    const y = this.skillCollection[b].order;

    return +(y < x) - +(x < y) || +(b < a) - +(a < b);
  };

  translateSkillNamesForLang = (lang: 'en' | 'ja'): Record<string, string> => {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(this.skillCollection)) {
      // Names from master are currently English-only; for now JA falls back to EN.
      if (lang === 'en' || lang === 'ja') {
        result[key] = value.name;
      }
    }

    return result;
  };

  // =====
  // Query Methods
  // =====

  getAll(): Array<SkillEntry> {
    return Object.values(this.skillCollection);
  }

  getById(id: string): SkillEntry | undefined {
    const skill = this.skillCollection[id];
    return skill;
  }

  getMany(ids: Array<string>): Array<SkillEntry> {
    const result: Array<SkillEntry> = [];
    for (let i = 0; i < ids.length; i++) {
      const skill = this.skillCollection[ids[i]];

      if (skill !== undefined) {
        result.push(skill);
      }
    }

    return result;
  }

  getAlternativesById(id: string): Array<SkillAlternative> {
    const skill = this.skillCollection[id];

    if (skill === undefined) {
      return [];
    }

    return skill.alternatives;
  }

  getByIconType(iconType: string): Array<SkillEntry> {
    const result: Array<SkillEntry> = [];
    const skillsArray = this.getAll();

    for (let i = 0; i < skillsArray.length; i++) {
      const skill = skillsArray[i];
      if (skill.iconId.startsWith(iconType)) {
        result.push(skill);
      }
    }

    return result;
  }

  getByGroupId(groupId: number): Array<SkillEntry> {
    const result: Array<SkillEntry> = [];
    const skillsArray = this.getAll();

    for (let i = 0; i < skillsArray.length; i++) {
      const skill = skillsArray[i];
      if (skill.groupId === groupId) {
        result.push(skill);
      }
    }

    return result;
  }

  getByRarity(rarity: number): Array<SkillEntry> {
    const result: Array<SkillEntry> = [];
    const skillsArray = this.getAll();

    for (let i = 0; i < skillsArray.length; i++) {
      const skill = skillsArray[i];
      if (skill.rarity === rarity) {
        result.push(skill);
      }
    }

    return result;
  }

  getByEffectType(effectType: ISkillType): Array<SkillEntry> {
    const result: Array<SkillEntry> = [];
    const skillsArray = this.getAll();

    for (let i = 0; i < skillsArray.length; i++) {
      const skill = skillsArray[i];
      const alternatives = skill.alternatives;

      for (let j = 0; j < alternatives.length; j++) {
        const alternative = alternatives[j];
        if (alternative.effects.some((effect) => effect.type === effectType)) {
          result.push(skill);
        }
      }
    }

    return result;
  }

  // ============
  // Helper Methods
  // ============

  getUniqueSkillIds(): Array<string> {
    const uniqueSkillRarities = new Set([4, 5]);
    const result: Array<string> = [];
    const skillsArray = this.getAll();

    for (let i = 0; i < skillsArray.length; i++) {
      const skill = skillsArray[i];
      if (skill.character?.length === 1 && uniqueSkillRarities.has(skill.rarity)) {
        result.push(skill.id);
      }
    }

    return result;
  }

  getNonUniqueSkillIds(): Array<string> {
    const result: Array<string> = [];
    const skillsArray = this.getAll();

    for (let i = 0; i < skillsArray.length; i++) {
      const skill = skillsArray[i];
      if (skill.rarity < 3 || skill.rarity > 4) {
        result.push(skill.id);
      }
    }

    return result;
  }

  getNameById(id: string): string {
    return this.skillCollection[id].name;
  }

  normalizeSkillId(skillId: string): string {
    return skillId.split('-', 1)[0] ?? skillId;
  }

  getNames(): Array<string> {
    return Object.values(this.skillCollection).map((skill) => skill.name);
  }

  findVersionOfSkill(id: string, existingIds: Array<string>): string | undefined {
    const skill = this.skillCollection[id];

    if (skill === undefined) {
      return undefined;
    }

    return skill.versions
      .map(String)
      .find((versionId) => versionId !== id && existingIds.includes(versionId));
  }

  // ============
  // OCR Matching
  // ============

  /**
   * Normalizes skill names for OCR matching while preserving skill-grade symbols.
   * Implements the same symbol handling used in uma-tools OCR matching.
   */
  normalizeSkillName(value: string): string {
    if (!value) {
      return '';
    }

    return value
      .normalize('NFKC')
      .replaceAll('◯', '○')
      .replaceAll('⭕', '○')
      .replaceAll('◦', '○')
      .replaceAll('⃝', '○')
      .replaceAll('⦿', '◎')
      .replaceAll('⊚', '◎')
      .replaceAll('✕', '×')
      .replaceAll('✖', '×')
      .replaceAll('©', '◎')
      .replaceAll('®', '○')
      .replaceAll(/\b(?:lvl|level)\s*\d+\b/giu, ' ')
      .replace(/\s+[Oo0]$/u, '○')
      .replace(/\s+[Xx]$/u, '×')
      .toLowerCase()
      .replaceAll(/[[\]\s\-_・!！?？,、.。:：;；'"""''「」『』【】()（）☆★]/gu, '')
      .trim();
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: Array<Array<number>> = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  private similarity(a: string, b: string): number {
    if (a === b) {
      return 1;
    }

    if (a.length === 0 || b.length === 0) {
      return 0;
    }

    const distance = this.levenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);

    return 1 - distance / maxLength;
  }

  private skillIdPrefixRank(skillId: string): number {
    const normalizedId = this.normalizeSkillId(skillId);
    const prefix = normalizedId.charAt(0);

    switch (prefix) {
      case '1':
        return 0;
      case '2':
        return 1;
      case '9':
        return 2;
      default:
        return 3;
    }
  }

  private sortSkillLookupEntries(entries: Array<SkillLookupEntry>): Array<SkillLookupEntry> {
    return [...entries].sort((a, b) => {
      const releaseRank = Number(b.released) - Number(a.released);
      if (releaseRank !== 0) {
        return releaseRank;
      }

      const prefixRank = this.skillIdPrefixRank(a.id) - this.skillIdPrefixRank(b.id);
      if (prefixRank !== 0) {
        return prefixRank;
      }

      const rarityRank = b.rarity - a.rarity;
      if (rarityRank !== 0) {
        return rarityRank;
      }

      return a.id.localeCompare(b.id);
    });
  }

  private selectCanonicalSkillLookupEntry(entries: Array<SkillLookupEntry>): SkillLookupEntry {
    return this.sortSkillLookupEntries(entries)[0];
  }

  private hasSkillLevelIndicator(value: string): boolean {
    return /\b(?:lvl|level)\s*\d+\b/iu.test(value);
  }
  private selectMatchedSkillLookupEntry(
    entries: Array<SkillLookupEntry>,
    originalText: string
  ): SkillLookupEntry {
    const hasLevel = this.hasSkillLevelIndicator(originalText);
    const sortedEntries = this.sortSkillLookupEntries(entries);

    if (hasLevel) {
      return (
        sortedEntries.find((entry) => this.normalizeSkillId(entry.id).startsWith('1')) ??
        sortedEntries[0]
      );
    }

    return (
      sortedEntries.find((entry) => this.normalizeSkillId(entry.id).startsWith('9')) ??
      sortedEntries[0]
    );
  }

  private buildSkillLookup(): void {
    if (this.skillLookup && this.skillLookupCandidates) {
      return;
    }

    this.skillLookup = new Map<string, SkillLookupEntry>();
    this.skillLookupCandidates = new Map<string, Array<SkillLookupEntry>>();

    for (const skill of Object.values(this.skillCollection)) {
      const key = this.normalizeSkillName(skill.name);

      if (!key) {
        continue;
      }

      const nextEntry: SkillLookupEntry = {
        id: `${skill.id}`,
        geneId: skill.gene_version?.id ? `${skill.gene_version.id}` : undefined,
        name: skill.name,
        rarity: skill.rarity,
        released: this.isReleased(skill.id)
      };

      const entries = this.skillLookupCandidates.get(key);
      if (entries) {
        if (!entries.some((entry) => entry.id === nextEntry.id)) {
          entries.push(nextEntry);
        }
        continue;
      }

      this.skillLookupCandidates.set(key, [nextEntry]);
    }

    for (const [key, entries] of this.skillLookupCandidates) {
      this.skillLookup.set(key, this.selectCanonicalSkillLookupEntry(entries));
    }
  }

  getSkillLookup(): Map<string, SkillLookupEntry> {
    this.buildSkillLookup();
    return this.skillLookup!;
  }

  getSkillLookupCandidates(): Map<string, Array<SkillLookupEntry>> {
    this.buildSkillLookup();
    return this.skillLookupCandidates!;
  }

  /** Find best skill match for OCR text */
  findBestSkillMatch(ocrText: string): SkillMatch | null {
    const lookupCandidates = this.getSkillLookupCandidates();
    const normalizedOcr = this.normalizeSkillName(ocrText);

    if (!normalizedOcr || normalizedOcr.length < 3) {
      return null;
    }

    const exactMatches = lookupCandidates.get(normalizedOcr);
    if (exactMatches && exactMatches.length > 0) {
      const exactMatch = this.selectMatchedSkillLookupEntry(exactMatches, ocrText);

      return {
        id: exactMatch.id,
        geneId: exactMatch.geneId,
        name: exactMatch.name,
        confidence: 1,
        originalText: ocrText
      };
    }

    let bestMatch: SkillMatch | null = null;
    let bestScore = 0;
    const minThreshold = 0.55;

    for (const [key, entries] of lookupCandidates) {
      let score = this.similarity(normalizedOcr, key);

      if (score < minThreshold && normalizedOcr.includes(key)) {
        score = 0.85;
      }

      if (score < minThreshold && key.includes(normalizedOcr) && normalizedOcr.length >= 5) {
        score = 0.75;
      }

      if (score > bestScore && score >= minThreshold) {
        const entry = this.selectMatchedSkillLookupEntry(entries, ocrText);

        bestScore = score;
        bestMatch = {
          id: entry.id,
          geneId: entry.geneId,
          name: entry.name,
          confidence: score,
          originalText: ocrText
        };
      }
    }

    return bestMatch;
  }

  resolveSkillId(skillId: string, hasLevel: boolean): string {
    if (hasLevel) {
      return skillId;
    }

    const skill = this.skillCollection[skillId];
    if (!skill?.gene_version?.id) {
      return skillId;
    }

    return `${skill.gene_version.id}`;
  }
}

// Populated once by `bootstrapData()` (or the test setup) via `initSkillService`.
// Consumers import this binding and read it synchronously after bootstrap; ESM
// live bindings surface the assignment to every importer.
export let skillsService: SkillService = undefined as unknown as SkillService;

export function initSkillService(loaded: LoadSkillsResult): void {
  skillsService = new SkillService(loaded.skills, {
    releasedSkillIds: loaded.releasedSkillIds,
    activationChecks: loaded.activationChecks
  });
}
