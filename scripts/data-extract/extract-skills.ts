#!/usr/bin/env node
/**
 * Extract unified skill data from master.mdb
 * Combines metadata, names, and activation/effect data into one file.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { Command } from 'commander';
import { closeDatabase, openDatabase, queryAll } from '../master-data/database';
import {
  readJsonFileIfExists,
  resolveMasterDbPath,
  sortByNumericKey,
  writeJsonFile
} from '../master-data/shared';
import type { SkillEntry } from '../../src/modules/data/services/SkillService';
import type { ISkillTarget } from '@/lib/uma-domain/skills/definitions';

interface SkillRow {
  id: number;
  rarity: number;
  tag_id: string | null;
  grade_value: number;
  precondition_1: string;
  condition_1: string;
  float_ability_time_1: number;
  float_cooldown_time_1: number;
  ability_type_1_1: number;
  float_ability_value_1_1: number;
  target_type_1_1: number;
  ability_value_usage_1_1: number;
  ability_value_level_usage_1_1: number;
  ability_type_1_2: number;
  float_ability_value_1_2: number;
  target_type_1_2: number;
  ability_value_usage_1_2: number;
  ability_value_level_usage_1_2: number;
  ability_type_1_3: number;
  float_ability_value_1_3: number;
  target_type_1_3: number;
  ability_value_usage_1_3: number;
  ability_value_level_usage_1_3: number;
  precondition_2: string;
  condition_2: string;
  float_ability_time_2: number;
  float_cooldown_time_2: number;
  ability_type_2_1: number;
  float_ability_value_2_1: number;
  target_type_2_1: number;
  ability_value_usage_2_1: number;
  ability_value_level_usage_2_1: number;
  ability_type_2_2: number;
  float_ability_value_2_2: number;
  target_type_2_2: number;
  ability_value_usage_2_2: number;
  ability_value_level_usage_2_2: number;
  ability_type_2_3: number;
  float_ability_value_2_3: number;
  target_type_2_3: number;
  ability_value_usage_2_3: number;
  ability_value_level_usage_2_3: number;
  group_id: number;
  icon_id: number;
  need_skill_point: number;
  disp_order: number;
  start_date: number;
}

interface SkillNameRow {
  index: number;
  text: string;
}

interface UniqueSkillOwnerRow {
  skillId: number;
  outfitId: number;
}

interface SkillUmaSourceRow {
  skillId: number;
  outfitId: number;
  needRank: number;
}

interface SkillSupportCardSourceRow {
  skillId: number;
  supportCardId: number;
  charaId: number;
  rarity: number;
  supportCardType: number;
  name: string;
  sourceType: 'hint' | 'event';
}

interface GeneVersionRow {
  unique_id: number;
  gene_id: number;
}

interface TextRow {
  index: number;
  text: string;
}

type SkillEffect = {
  type: number;
  modifier: number;
  target: ISkillTarget;
  valueUsage?: number;
  valueLevelUsage?: number;
};

type SkillAlternative = {
  precondition: string;
  condition: string;
  baseDuration: number;
  cooldownTime?: number;
  effects: Array<SkillEffect>;
};

const SCENARIO_SKILLS = new Set([
  210011,
  210012,
  210021,
  210022,
  210031,
  210032,
  210041,
  210042,
  210051,
  210052, // Aoharu
  210061,
  210062, // Make A New Track
  210071,
  210072, // Grand Live
  210081,
  210082, // updated URA
  210261,
  210262,
  210271,
  210272,
  210281,
  210282, // Grand Masters
  210291 // RFTS (white version)
]);

const EXCLUDED_SKILLS = new Set([
  // Narita Brian's Story
  300011, 300021,
  // Silence Suzuka's Story
  300031, 300041, 300051, 300061, 300071, 300081, 300091, 300101
]);

const SPLIT_ALTERNATIVES = new Set([100701, 900701]);

const GAMETORA_SKILLS_PATH = path.join(process.cwd(), 'src/modules/data/json/gametora/skills.json');
const GAME_VERSION_PATH = path.join(process.cwd(), 'game-version.json');
const SKILL_HISTORY_PATH = path.join(process.cwd(), 'scripts/data-extract/skill-history.json');

type SkillHistoryEntry = { hash: string; lastUpdated: string };
type SkillHistory = Record<string, SkillHistoryEntry>;
type GameToraSkillRaw = { id: number; endesc?: string; desc_en?: string };
type GameVersion = { updatedAt?: string };

const NO_ENGLISH_DESCRIPTION = 'No English description yet';

/**
 * Stable content fingerprint over gameplay-relevant fields only. Sources, family,
 * and display order are excluded because they churn for reasons unrelated to a
 * skill's mechanics or text.
 */
function fingerprintSkill(skill: SkillEntry): string {
  const canonical = {
    rarity: skill.rarity,
    baseCost: skill.baseCost,
    gradeValue: skill.gradeValue,
    description: skill.description ?? '',
    alternatives: skill.alternatives.map((alt) => ({
      precondition: alt.precondition,
      condition: alt.condition,
      baseDuration: alt.baseDuration,
      cooldownTime: alt.cooldownTime,
      effects: alt.effects.map((effect) => ({
        type: effect.type,
        modifier: effect.modifier,
        target: effect.target,
        valueUsage: effect.valueUsage,
        valueLevelUsage: effect.valueLevelUsage
      }))
    }))
  };
  return createHash('sha1').update(JSON.stringify(canonical)).digest('hex');
}

type ExtractSkillsOptions = {
  replaceMode: boolean;
  dbPath?: string;
};

function parseCliArgs(argv: Array<string>): ExtractSkillsOptions {
  const program = new Command();

  program
    .name('extract-skills')
    .description('Extract unified skill data from master.mdb')
    .option('-r, --replace', 'replace existing extracted data')
    .option('--full', 'alias for --replace')
    .argument('[dbPath]', 'path to master.mdb');

  program.parse(argv);

  const options = program.opts<{ replace?: boolean; full?: boolean }>();
  const [dbPath] = program.args as Array<string>;

  return {
    replaceMode: Boolean(options.replace || options.full),
    dbPath
  };
}

// Scenario skills (Aoharu usages 3–7 and kin) scale at race time with the racing team's combined stats, including in TT/CM. We can't know the team here, so pre-apply the best tier (1.2×) — the sim then treats the value as Direct. See docs/mechanics/README.md § "Aoharu Skills (3-7)".
function patchModifier(id: number, value: number): number {
  if (SCENARIO_SKILLS.has(id)) {
    return value * 1.2;
  }
  return value;
}

export function parseSkillTags(value: string | null | undefined): Array<number> {
  if (!value) {
    return [];
  }

  return value.split('/').flatMap((segment) => {
    const trimmed = segment.trim();
    if (!/^\d+$/u.test(trimmed)) {
      return [];
    }

    const tag = Number(trimmed);
    return Number.isSafeInteger(tag) ? [tag] : [];
  });
}

function createEffect(
  skillId: number,
  type: number,
  modifier: number,
  target: number,
  valueUsage: number,
  valueLevelUsage: number
): SkillEffect {
  return {
    type,
    modifier: patchModifier(skillId, modifier),
    target: target as ISkillTarget,
    valueUsage,
    valueLevelUsage
  };
}

function buildEffects(row: SkillRow, prefix: '1' | '2'): Array<SkillEffect> {
  const effects: Array<SkillEffect> = [];

  if (prefix === '1') {
    effects.push(
      createEffect(
        row.id,
        row.ability_type_1_1,
        row.float_ability_value_1_1,
        row.target_type_1_1,
        row.ability_value_usage_1_1,
        row.ability_value_level_usage_1_1
      )
    );

    if (row.ability_type_1_2 !== 0) {
      effects.push(
        createEffect(
          row.id,
          row.ability_type_1_2,
          row.float_ability_value_1_2,
          row.target_type_1_2,
          row.ability_value_usage_1_2,
          row.ability_value_level_usage_1_2
        )
      );
    }

    if (row.ability_type_1_3 !== 0) {
      effects.push(
        createEffect(
          row.id,
          row.ability_type_1_3,
          row.float_ability_value_1_3,
          row.target_type_1_3,
          row.ability_value_usage_1_3,
          row.ability_value_level_usage_1_3
        )
      );
    }
  } else {
    effects.push(
      createEffect(
        row.id,
        row.ability_type_2_1,
        row.float_ability_value_2_1,
        row.target_type_2_1,
        row.ability_value_usage_2_1,
        row.ability_value_level_usage_2_1
      )
    );

    if (row.ability_type_2_2 !== 0) {
      effects.push(
        createEffect(
          row.id,
          row.ability_type_2_2,
          row.float_ability_value_2_2,
          row.target_type_2_2,
          row.ability_value_usage_2_2,
          row.ability_value_level_usage_2_2
        )
      );
    }

    if (row.ability_type_2_3 !== 0) {
      effects.push(
        createEffect(
          row.id,
          row.ability_type_2_3,
          row.float_ability_value_2_3,
          row.target_type_2_3,
          row.ability_value_usage_2_3,
          row.ability_value_level_usage_2_3
        )
      );
    }
  }

  return effects;
}

function buildAlternatives(row: SkillRow): Array<SkillAlternative> {
  const alternatives: Array<SkillAlternative> = [
    {
      precondition: row.precondition_1 === '0' ? '' : row.precondition_1,
      condition: row.condition_1,
      baseDuration: row.float_ability_time_1,
      cooldownTime: row.float_cooldown_time_1,
      effects: buildEffects(row, '1')
    }
  ];

  if (row.condition_2 && row.condition_2 !== '' && row.condition_2 !== '0') {
    alternatives.push({
      precondition: row.precondition_2 === '0' ? '' : row.precondition_2,
      condition: row.condition_2,
      baseDuration: row.float_ability_time_2,
      cooldownTime: row.float_cooldown_time_2,
      effects: buildEffects(row, '2')
    });
  }

  return alternatives;
}

function isConcreteOutfitId(outfitId: number): boolean {
  return outfitId >= 100000;
}

function createSkillReference(skill: SkillEntry) {
  return {
    id: Number(skill.id),
    name: skill.name,
    rarity: skill.rarity,
    iconId: skill.iconId
  };
}

function reduceUniqueSkillOwners(rows: Array<UniqueSkillOwnerRow>): Map<string, number> {
  const owners = new Map<string, number>();

  for (const row of rows) {
    // Base rarity uniques sometimes point at placeholder dress ids like 101.
    // Only keep concrete outfit ids because runtime ownership checks use full outfit ids.
    if (!isConcreteOutfitId(row.outfitId)) {
      continue;
    }

    const skillId = row.skillId.toString();
    const currentOwner = owners.get(skillId);

    if (currentOwner === undefined || row.outfitId < currentOwner) {
      owners.set(skillId, row.outfitId);
    }
  }

  return owners;
}

function reduceSkillUmaSources(
  rows: Array<SkillUmaSourceRow>
): Map<string, Array<SkillUmaSourceRow>> {
  const sources = new Map<string, Map<number, SkillUmaSourceRow>>();

  for (const row of rows) {
    if (!isConcreteOutfitId(row.outfitId)) {
      continue;
    }

    const skillId = row.skillId.toString();
    const skillSources = sources.get(skillId) ?? new Map<number, SkillUmaSourceRow>();
    const current = skillSources.get(row.outfitId);

    if (!current || row.needRank < current.needRank) {
      skillSources.set(row.outfitId, row);
    }

    sources.set(skillId, skillSources);
  }

  const result = new Map<string, Array<SkillUmaSourceRow>>();

  for (const [skillId, outfitSources] of sources) {
    result.set(
      skillId,
      Array.from(outfitSources.values()).sort((a, b) => a.outfitId - b.outfitId)
    );
  }

  return result;
}

function reduceSkillSupportCardSources(
  rows: Array<SkillSupportCardSourceRow>
): Map<string, Array<SkillSupportCardSourceRow>> {
  const sources = new Map<string, Map<number, SkillSupportCardSourceRow>>();

  for (const row of rows) {
    const skillId = row.skillId.toString();
    const skillSources = sources.get(skillId) ?? new Map<number, SkillSupportCardSourceRow>();
    skillSources.set(row.supportCardId, row);
    sources.set(skillId, skillSources);
  }

  const result = new Map<string, Array<SkillSupportCardSourceRow>>();

  for (const [skillId, supportSources] of sources) {
    result.set(
      skillId,
      Array.from(supportSources.values()).sort(
        (a, b) => b.rarity - a.rarity || a.supportCardId - b.supportCardId
      )
    );
  }

  return result;
}

async function extractSkills(options: ExtractSkillsOptions = { replaceMode: false }) {
  console.log('📖 Extracting unified skills...\n');

  const { replaceMode, dbPath: cliDbPath } = options;
  const dbPath = await resolveMasterDbPath(cliDbPath);

  console.log(
    `Mode: ${replaceMode ? '⚠️  Full Replacement' : '✓ Merge (preserves future content)'}`
  );
  console.log(`Database: ${dbPath}\n`);

  const db = openDatabase(dbPath);

  try {
    const rows = queryAll<SkillRow>(
      db,
      `SELECT s.id, s.rarity, s.tag_id, s.grade_value,
              s.precondition_1,
              s.condition_1,
              s.float_ability_time_1,
              s.float_cooldown_time_1,
              s.ability_type_1_1, s.float_ability_value_1_1, s.target_type_1_1,
              s.ability_value_usage_1_1, s.ability_value_level_usage_1_1,
              s.ability_type_1_2, s.float_ability_value_1_2, s.target_type_1_2,
              s.ability_value_usage_1_2, s.ability_value_level_usage_1_2,
              s.ability_type_1_3, s.float_ability_value_1_3, s.target_type_1_3,
              s.ability_value_usage_1_3, s.ability_value_level_usage_1_3,
              s.precondition_2,
              s.condition_2,
              s.float_ability_time_2,
              s.float_cooldown_time_2,
              s.ability_type_2_1, s.float_ability_value_2_1, s.target_type_2_1,
              s.ability_value_usage_2_1, s.ability_value_level_usage_2_1,
              s.ability_type_2_2, s.float_ability_value_2_2, s.target_type_2_2,
              s.ability_value_usage_2_2, s.ability_value_level_usage_2_2,
              s.ability_type_2_3, s.float_ability_value_2_3, s.target_type_2_3,
              s.ability_value_usage_2_3, s.ability_value_level_usage_2_3,
              s.group_id, s.icon_id, COALESCE(sp.need_skill_point, 0) as need_skill_point, s.disp_order, s.start_date
       FROM skill_data s
       LEFT JOIN single_mode_skill_need_point sp ON s.id = sp.id`
    );

    const nameRows = queryAll<SkillNameRow>(
      db,
      `SELECT [index], text
       FROM text_data
       WHERE category = 47`
    );

    console.log(`Found ${rows.length} skill records`);
    console.log(`Found ${nameRows.length} skill names\n`);

    const descRows = queryAll<SkillNameRow>(
      db,
      `SELECT [index], text
       FROM text_data
       WHERE category = 48`
    );

    const namesById: Record<string, string> = {};
    for (const row of nameRows) {
      namesById[row.index.toString()] = row.text;
    }

    const descriptionsById: Record<string, string> = {};
    for (const row of descRows) {
      descriptionsById[row.index.toString()] = row.text;
    }

    // GameTora in-game EN text (endesc, fallback desc_en), keyed by skill id.
    const gametoraSkills =
      (await readJsonFileIfExists<Array<GameToraSkillRaw>>(GAMETORA_SKILLS_PATH)) ?? [];
    const gametoraDescById = new Map<string, string>();
    for (const gametoraSkill of gametoraSkills) {
      if (gametoraSkill.endesc) {
        gametoraDescById.set(gametoraSkill.id.toString(), gametoraSkill.endesc);
      }
    }

    // Date stamped on skills whose fingerprint changed since the last extract.
    const gameVersion = await readJsonFileIfExists<GameVersion>(GAME_VERSION_PATH);
    const stampDate = gameVersion?.updatedAt
      ? gameVersion.updatedAt.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const history = (await readJsonFileIfExists<SkillHistory>(SKILL_HISTORY_PATH)) ?? {};

    const extractedSkills: Record<string, SkillEntry> = {};

    for (const row of rows) {
      if (EXCLUDED_SKILLS.has(row.id)) {
        continue;
      }

      const alternatives = buildAlternatives(row);
      const name = namesById[row.id.toString()] ?? '';
      const releaseDate =
        row.start_date > 0 ? new Date(row.start_date * 1000).toISOString().slice(0, 10) : undefined;

      const baseEntry: Omit<SkillEntry, 'alternatives'> = {
        id: row.id.toString(),
        rarity: row.rarity,
        tags: parseSkillTags(row.tag_id),
        groupId: row.group_id,
        versions: [],
        iconId: row.icon_id.toString(),
        family: [],
        baseCost: row.need_skill_point,
        gradeValue: row.grade_value,
        order: row.disp_order,
        name,
        character: [],
        releaseDate,
        description: descriptionsById[row.id.toString()] ?? '',
        descriptionGametora: gametoraDescById.get(row.id.toString()) ?? NO_ENGLISH_DESCRIPTION
      };

      if (SPLIT_ALTERNATIVES.has(row.id)) {
        for (const [index, alt] of alternatives.entries()) {
          const suffix = index === 0 ? '' : `-${index}`;
          const key = `${row.id}${suffix}`;
          extractedSkills[key] = {
            ...baseEntry,
            alternatives: [alt]
          };
        }
      } else {
        extractedSkills[row.id.toString()] = {
          ...baseEntry,
          alternatives
        };
      }
    }

    // Stamp lastUpdated by diffing each skill's fingerprint against the committed history.
    const nextHistory: SkillHistory = {};
    let changedCount = 0;
    for (const [key, skill] of Object.entries(extractedSkills)) {
      const hash = fingerprintSkill(skill);
      const previous = history[key];
      let lastUpdated: string;

      if (!previous) {
        // First time we have seen this skill: bootstrap to its release date so we
        // do not claim every skill changed on the run that introduced history.
        lastUpdated = skill.releaseDate ?? stampDate;
      } else if (previous.hash === hash) {
        lastUpdated = previous.lastUpdated;
      } else {
        lastUpdated = stampDate;
        changedCount++;
      }

      skill.lastUpdated = lastUpdated;
      nextHistory[key] = { hash, lastUpdated };
    }
    console.log(`Stamped lastUpdated (${changedCount} changed since last extract)`);

    const uniqueSkillOwnerRows = queryAll<UniqueSkillOwnerRow>(
      db,
      `WITH skill_slots AS (
         SELECT id AS skill_set_id, skill_id1 AS skill_id FROM skill_set WHERE skill_id1 <> 0
         UNION ALL SELECT id, skill_id2 FROM skill_set WHERE skill_id2 <> 0
         UNION ALL SELECT id, skill_id3 FROM skill_set WHERE skill_id3 <> 0
         UNION ALL SELECT id, skill_id4 FROM skill_set WHERE skill_id4 <> 0
         UNION ALL SELECT id, skill_id5 FROM skill_set WHERE skill_id5 <> 0
         UNION ALL SELECT id, skill_id6 FROM skill_set WHERE skill_id6 <> 0
         UNION ALL SELECT id, skill_id7 FROM skill_set WHERE skill_id7 <> 0
         UNION ALL SELECT id, skill_id8 FROM skill_set WHERE skill_id8 <> 0
         UNION ALL SELECT id, skill_id9 FROM skill_set WHERE skill_id9 <> 0
         UNION ALL SELECT id, skill_id10 FROM skill_set WHERE skill_id10 <> 0
       )
       SELECT DISTINCT
         sd.id AS skillId,
         crd.card_id AS outfitId
       FROM card_rarity_data crd
       JOIN card_data cd
         ON cd.id = crd.card_id
       JOIN skill_slots ss
         ON ss.skill_set_id = crd.skill_set
       JOIN skill_data sd
         ON sd.id = ss.skill_id
       WHERE sd.rarity = 5`
    );

    const skillUmaSourceRows = queryAll<SkillUmaSourceRow>(
      db,
      `WITH skill_slots AS (
         SELECT id AS skill_set_id, skill_id1 AS skill_id FROM skill_set WHERE skill_id1 <> 0
         UNION ALL SELECT id, skill_id2 FROM skill_set WHERE skill_id2 <> 0
         UNION ALL SELECT id, skill_id3 FROM skill_set WHERE skill_id3 <> 0
         UNION ALL SELECT id, skill_id4 FROM skill_set WHERE skill_id4 <> 0
         UNION ALL SELECT id, skill_id5 FROM skill_set WHERE skill_id5 <> 0
         UNION ALL SELECT id, skill_id6 FROM skill_set WHERE skill_id6 <> 0
         UNION ALL SELECT id, skill_id7 FROM skill_set WHERE skill_id7 <> 0
         UNION ALL SELECT id, skill_id8 FROM skill_set WHERE skill_id8 <> 0
         UNION ALL SELECT id, skill_id9 FROM skill_set WHERE skill_id9 <> 0
         UNION ALL SELECT id, skill_id10 FROM skill_set WHERE skill_id10 <> 0
       )
       SELECT DISTINCT
         avs.skill_id AS skillId,
         cd.id AS outfitId,
         avs.need_rank AS needRank
       FROM card_data cd
       JOIN available_skill_set avs
         ON avs.available_skill_set_id = cd.available_skill_set_id
       UNION
       SELECT DISTINCT
         ss.skill_id AS skillId,
         crd.card_id AS outfitId,
         0 AS needRank
       FROM card_rarity_data crd
       JOIN skill_slots ss
         ON ss.skill_set_id = crd.skill_set`
    );
    const umaNameRows = queryAll<TextRow>(
      db,
      `SELECT [index], text FROM text_data WHERE category = 6 AND [index] < 2000`
    );
    const outfitNameRows = queryAll<TextRow>(
      db,
      `SELECT [index], text FROM text_data WHERE category = 5`
    );
    const umaNamesById = new Map(umaNameRows.map((row) => [row.index.toString(), row.text]));
    const outfitNamesById = new Map(outfitNameRows.map((row) => [row.index.toString(), row.text]));

    const skillUmaSources = reduceSkillUmaSources(skillUmaSourceRows);
    let sourceCount = 0;

    for (const [skillId, sources] of skillUmaSources) {
      const skill = extractedSkills[skillId];
      if (!skill) {
        continue;
      }

      skill.character = sources.map((source) => source.outfitId);
      skill.sources = sources.map((source) => {
        const outfitKey = source.outfitId.toString();
        const umaId = outfitKey.slice(0, 4);
        return {
          outfitId: source.outfitId,
          needRank: source.needRank,
          name: umaNamesById.get(umaId) ?? umaId,
          outfit: outfitNamesById.get(outfitKey) ?? outfitKey
        };
      });
      sourceCount++;
    }

    console.log(`Mapped ${sourceCount} skills to uma outfit sources`);

    const skillSupportCardSourceRows = queryAll<SkillSupportCardSourceRow>(
      db,
      `SELECT DISTINCT
         h.hint_value_1 AS skillId,
         sc.id AS supportCardId,
         sc.chara_id AS charaId,
         sc.rarity AS rarity,
         sc.support_card_type AS supportCardType,
         COALESCE(t.text, '') AS name,
         'hint' AS sourceType
       FROM single_mode_hint_gain h
       JOIN support_card_data sc
         ON sc.skill_set_id = h.hint_id
       LEFT JOIN text_data t
         ON t.category = 76
        AND t.[index] = sc.id
       WHERE h.hint_gain_type = 0
         AND h.hint_value_1 <> 0`
    );
    const skillSupportCardSources = reduceSkillSupportCardSources(skillSupportCardSourceRows);
    let supportSourceCount = 0;

    for (const [skillId, sources] of skillSupportCardSources) {
      const skill = extractedSkills[skillId];
      if (!skill) {
        continue;
      }

      skill.supportSources = sources.map((source) => ({
        supportCardId: source.supportCardId,
        charaId: source.charaId,
        rarity: source.rarity,
        supportCardType: source.supportCardType,
        name: source.name,
        sourceType: source.sourceType
      }));
      supportSourceCount++;
    }

    console.log(`Mapped ${supportSourceCount} skills to support card sources`);

    const uniqueSkillOwners = reduceUniqueSkillOwners(uniqueSkillOwnerRows);
    let ownerCount = 0;

    for (const [skillId, outfitId] of uniqueSkillOwners) {
      const skill = extractedSkills[skillId];
      if (!skill) {
        continue;
      }

      // Only unique skills are safe to tie to a single uma outfit.
      skill.character = [outfitId];
      {
        const outfitKey = outfitId.toString();
        const umaId = outfitKey.slice(0, 4);
        skill.sources = [
          {
            outfitId,
            needRank: 0,
            name: umaNamesById.get(umaId) ?? umaId,
            outfit: outfitNamesById.get(outfitKey) ?? outfitKey
          }
        ];
      }
      ownerCount++;
    }

    console.log(`Mapped ${ownerCount} unique skills to owning outfits`);

    const geneVersionRows = queryAll<GeneVersionRow>(
      db,
      `SELECT u.id AS unique_id, g.id AS gene_id
       FROM skill_data u
       JOIN skill_data g ON g.id = u.id + 800000
       WHERE u.rarity IN (4, 5)
         AND g.rarity = 1`
    );

    for (const row of geneVersionRows) {
      const uniqueSkill = extractedSkills[row.unique_id.toString()];
      const geneSkill = extractedSkills[row.gene_id.toString()];
      if (uniqueSkill && geneSkill) {
        uniqueSkill.gene_version = createSkillReference(geneSkill);
        geneSkill.unique_version = createSkillReference(uniqueSkill);
        geneSkill.character = [...uniqueSkill.character];
        geneSkill.sources = uniqueSkill.sources?.map((source) => ({ ...source }));
        // Gene/inherited skills have no GameTora endesc of their own; inherit the
        // parent unique skill's in-game EN text.
        geneSkill.descriptionGametora = uniqueSkill.descriptionGametora;
      } else if (uniqueSkill) {
        uniqueSkill.gene_version = { id: row.gene_id, name: '', rarity: 1, iconId: '' };
      }
    }

    console.log(`Mapped ${geneVersionRows.length} gene versions to unique skills`);

    const groupMap = new Map<number, Set<string>>();
    for (const skill of Object.values(extractedSkills)) {
      const members = groupMap.get(skill.groupId) ?? new Set<string>();
      members.add(skill.id);
      groupMap.set(skill.groupId, members);
    }

    let familyCount = 0;
    let versionCount = 0;
    for (const membersSet of groupMap.values()) {
      const members = Array.from(membersSet);
      if (members.length < 2) {
        continue;
      }
      familyCount++;

      for (const id of members) {
        const skill = extractedSkills[id];
        if (skill) {
          const siblingIds = members.filter((memberId) => memberId !== id);
          skill.versions = siblingIds.map(Number);
          skill.family = siblingIds
            .map((memberId) => extractedSkills[memberId])
            .filter((member): member is SkillEntry => member !== undefined)
            .map(createSkillReference);
          versionCount++;
        }
      }
    }

    console.log(`Initialized ${familyCount} multi-member families (${versionCount} linked skills)`);

    const outputPath = path.join(process.cwd(), 'src/modules/data/json/skills.json');

    let finalSkills: Record<string, SkillEntry>;
    if (replaceMode) {
      finalSkills = extractedSkills;
      console.log(
        `\n⚠️  Full replacement mode: ${Object.keys(extractedSkills).length} skills from master.mdb only`
      );
    } else {
      const existingData = await readJsonFileIfExists<Record<string, SkillEntry>>(outputPath);
      if (existingData) {
        const newCount = Object.keys(extractedSkills).length;
        finalSkills = { ...existingData, ...extractedSkills };
        const finalCount = Object.keys(finalSkills).length;
        const preserved = finalCount - newCount;

        console.log('\n✓ Merge mode:');
        console.log(`  → ${newCount} skills from master.mdb (current content)`);
        console.log(`  → ${preserved} additional skills preserved (future content)`);
        console.log(`  → ${finalCount} total skills`);
      } else {
        finalSkills = extractedSkills;
        console.log('\n✓ No existing file found, using master.mdb data only');
      }
    }

    const finalSkillsByGroupId = new Map<number, Array<SkillEntry>>();
    for (const skill of Object.values(finalSkills)) {
      const groupSkills = finalSkillsByGroupId.get(skill.groupId) ?? [];
      groupSkills.push(skill);
      finalSkillsByGroupId.set(skill.groupId, groupSkills);
    }

    for (const skill of Object.values(finalSkills)) {
      if (!Array.isArray(skill.versions)) {
        skill.versions = [];
      }
      if (!Array.isArray(skill.family)) {
        skill.family = (finalSkillsByGroupId.get(skill.groupId) ?? [])
          .filter((member) => member.id !== skill.id)
          .map(createSkillReference);
      }
    }

    // Skills preserved through merge but absent from the current master extract are
    // upcoming content: mark them unreleased and backfill their GameTora text.
    for (const [key, skill] of Object.entries(finalSkills)) {
      if (!extractedSkills[key]) {
        skill.lastUpdated = 'unreleased';
        skill.descriptionGametora =
          gametoraDescById.get(key.split('-', 1)[0]) ??
          skill.descriptionGametora ??
          NO_ENGLISH_DESCRIPTION;
      }
    }

    const sorted = sortByNumericKey(finalSkills);
    await writeJsonFile(outputPath, sorted);
    console.log(`\n✓ Written to ${outputPath}`);

    await writeJsonFile(SKILL_HISTORY_PATH, sortByNumericKey(nextHistory));
    console.log(`✓ Skill history written to ${SKILL_HISTORY_PATH}`);
  } finally {
    closeDatabase(db);
  }
}

if (import.meta.main) {
  const options = parseCliArgs(process.argv);

  extractSkills(options).catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

export { extractSkills, parseCliArgs };
