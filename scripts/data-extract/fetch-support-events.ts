#!/usr/bin/env node
/**
 * Fetch support card event data from GameTora's manifest API and merge
 * eventSkills into the local support-cards.json.
 *
 * This script fills the gap that master.mdb cannot: mapping support card
 * events to the skills they reward. It fetches training event data,
 * decrypts event names, decodes reward entries, and writes two outputs:
 *
 *   1. support-cards.json — eventSkills array populated per card
 *   2. support-events.json — full event data (names, choices, rewards)
 *
 * Usage:
 *   pnpm run fetch:support-events
 *   pnpm run fetch:support-events -- --dry-run
 */

import { Command } from 'commander';
import { readJsonFileIfExists, sortByNumericKey, writeJsonFile } from '../master-data/shared';
import { loadManifest, loadManifestData } from './gametora-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SupportSkillEntry = {
  id: number;
  name: string;
  rarity: number;
};

type SupportCardEntry = {
  id: number;
  name: string;
  charaId: number;
  charaName: string;
  rarity: number;
  supportCardType: number;
  hintSkills: Array<SupportSkillEntry>;
  eventSkills: Array<SupportSkillEntry>;
};

type SupportCardsMap = Record<string, SupportCardEntry>;

type SkillEntry = {
  id: string;
  name: string;
  rarity: number;
};

type SkillsMap = Record<string, SkillEntry>;

/** Decoded event reward — a single stat/skill line. */
type DecodedReward = {
  key: string;
  label: string;
  value: string;
  /** Populated when key === 'sk' — the raw skill ID from evrew. */
  skillId?: number;
};

type EventChoice = {
  label: string;
  rewards: Array<DecodedReward>;
};

type SupportEvent = {
  eventName: string;
  storyId: number | null;
  choices: Array<EventChoice>;
};

type SupportEventsMap = Record<string, Array<SupportEvent>>;

type FetchSupportEventsOptions = {
  dryRun: boolean;
};

// Raw types from GameTora's encoded JSON
type RawEvrew = Array<null | [string, string, ...Array<number>]>;
type RawTrainingEvents = Array<[number, Array<RawEventEntry>]>;
type RawEventEntry = [
  nameIndex: number,
  choices: Array<RawChoice>,
  storyId?: number,
  ...rest: Array<unknown>
];
type RawChoice = [choiceIndex: number, rewardIds: Array<number>];

/**
 * Group cards have a different structure:
 * [supportCardId, [memberCharaIds], [events...]]
 */
type RawGroupTrainingEvents = Array<[number, Array<number>, Array<RawEventEntry>]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORT_CARDS_PATH = 'src/modules/data/json/support-cards.json';
const SUPPORT_EVENTS_PATH = 'src/modules/data/json/support-events.json';
const SKILLS_PATH = 'src/modules/data/json/skills.json';

/** XOR cipher key for event names. */
const GT_NAME_KEY = 106;
/** Offset subtracted from event name index before looking up in te_names. */
const GT_NAME_OFFSET = 86;
/** Offset subtracted from reward IDs before looking up in evrew. */
const GT_REWARD_OFFSET = 36;

/** evrew stat-key → human-readable label. */
const REWARD_KEY_MAP: Record<string, string> = {
  sp: 'Speed',
  st: 'Stamina',
  po: 'Power',
  gu: 'Guts',
  in: 'Wit',
  wi: 'Wit',
  sk: 'Skill Pts',
  pt: 'Skill Pts',
  bo: 'Bond',
  bo_ch: 'Bond',
  bo_l: 'Bond',
  bo_r: 'Bond',
  vi: 'Energy',
  en: 'Energy',
  hp: 'Energy',
  mo: 'Motivation',
  fa: 'Fans',
  me: 'Max Energy',
  he: 'Motivation'
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCliArgs(argv: Array<string>): FetchSupportEventsOptions {
  const program = new Command();

  program
    .name('fetch-support-events')
    .description('Fetch support card event data from GameTora and merge eventSkills')
    .option('--dry-run', 'fetch and decode but do not write files');

  program.parse(argv);

  const options = program.opts<{ dryRun?: boolean }>();

  return { dryRun: Boolean(options.dryRun) };
}

// ---------------------------------------------------------------------------
// XOR cipher (GameTora event name encoding)
// ---------------------------------------------------------------------------

function gtDecrypt(encoded: string, key: number): string {
  if (!encoded) return '';
  const bytes = Buffer.from(encoded, 'base64');
  const keyStr = `k${key}`;
  const keyBytes = Buffer.from(keyStr, 'utf8');
  const result = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i]! ^ keyBytes[i % keyBytes.length]!;
  }
  return result.toString('utf8');
}

// ---------------------------------------------------------------------------
// Skill name map
// ---------------------------------------------------------------------------

async function loadSkillNameMap(): Promise<Record<string, { name: string; rarity: number }>> {
  const skills = await readJsonFileIfExists<SkillsMap>(SKILLS_PATH);
  if (!skills) return {};

  const map: Record<string, { name: string; rarity: number }> = {};
  for (const [id, entry] of Object.entries(skills)) {
    if (entry?.name) {
      map[id] = { name: entry.name, rarity: entry.rarity ?? 0 };
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Event name decoding
// ---------------------------------------------------------------------------

function decodeEventName(
  nameIndex: number,
  teNamesEn: Array<string | null>,
  teNamesJa: Array<string | null>
): string {
  const adjusted = nameIndex - GT_NAME_OFFSET;
  const encodedEn = teNamesEn[adjusted];
  const encodedJa = teNamesJa[adjusted];

  const nameEn = encodedEn ? gtDecrypt(encodedEn, GT_NAME_KEY) : '';
  const nameJa = encodedJa ? gtDecrypt(encodedJa, GT_NAME_KEY) : '';

  return nameEn || nameJa || `Event #${nameIndex}`;
}

// ---------------------------------------------------------------------------
// Reward decoding
// ---------------------------------------------------------------------------

function decodeRewards(
  rewardIds: Array<number>,
  evrew: RawEvrew,
  skillMap: Record<string, { name: string; rarity: number }>
): Array<DecodedReward> {
  const rewards: Array<DecodedReward> = [];

  for (const rid of rewardIds) {
    const entry = evrew[rid - GT_REWARD_OFFSET];
    if (!entry) continue;

    const [key, value, extra] = entry;
    if (value == null) continue;

    const label = REWARD_KEY_MAP[key] ?? key;

    if (key === 'sk' && extra != null) {
      const skill = skillMap[String(extra)];
      const skillName = skill?.name ?? `Skill#${extra}`;
      rewards.push({ key, label: skillName, value: `hint ${value}`, skillId: extra });
    } else {
      rewards.push({ key, label, value });
    }
  }

  return rewards;
}

// ---------------------------------------------------------------------------
// Training event parser
// ---------------------------------------------------------------------------

function parseTrainingEvents(
  rawEntries: RawTrainingEvents,
  teNamesEn: Array<string | null>,
  teNamesJa: Array<string | null>,
  evrew: RawEvrew,
  skillMap: Record<string, { name: string; rarity: number }>
): SupportEventsMap {
  const result: SupportEventsMap = {};

  for (const entry of rawEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;

    const entityId = entry[0];
    const events = entry[1];
    if (!Array.isArray(events)) continue;

    const entityEvents: Array<SupportEvent> = [];

    for (const evt of events) {
      if (!Array.isArray(evt) || evt.length < 2) continue;

      const nameIndex = evt[0];
      const eventName = decodeEventName(nameIndex, teNamesEn, teNamesJa);
      const choiceData = evt[1];
      const storyId = typeof evt[2] === 'number' ? evt[2] : null;

      if (!Array.isArray(choiceData)) continue;

      const validChoices = choiceData.filter(
        (c): c is RawChoice => Array.isArray(c) && Array.isArray(c[1])
      );

      if (validChoices.length === 0) {
        entityEvents.push({ eventName, storyId, choices: [] });
        continue;
      }

      const choices: Array<EventChoice> = [];

      if (validChoices.length === 1) {
        const rewards = decodeRewards(validChoices[0]![1], evrew, skillMap);
        choices.push({ label: '', rewards });
      } else {
        for (let ci = 0; ci < validChoices.length; ci++) {
          const label = ci === 0 ? 'Top Option' : ci === 1 ? 'Bottom Option' : `Option ${ci + 1}`;
          const rewards = decodeRewards(validChoices[ci]![1], evrew, skillMap);
          choices.push({ label, rewards });
        }
      }

      entityEvents.push({ eventName, storyId, choices });
    }

    result[String(entityId)] = entityEvents;
  }

  return result;
}

// ---------------------------------------------------------------------------
// eventSkills extractor
// ---------------------------------------------------------------------------

/**
 * Extract unique skill rewards from a card's events and return them as
 * SupportSkillEntry items suitable for the eventSkills array.
 */
function extractEventSkills(
  events: Array<SupportEvent>,
  skillMap: Record<string, { name: string; rarity: number }>
): Array<SupportSkillEntry> {
  const seen = new Set<number>();
  const skills: Array<SupportSkillEntry> = [];

  for (const event of events) {
    for (const choice of event.choices) {
      for (const reward of choice.rewards) {
        if (reward.skillId != null && !seen.has(reward.skillId)) {
          seen.add(reward.skillId);
          const skill = skillMap[String(reward.skillId)];
          skills.push({
            id: reward.skillId,
            name: skill?.name ?? `Skill ${reward.skillId}`,
            rarity: skill?.rarity ?? 0
          });
        }
      }
    }
  }

  return skills.sort((a, b) => a.rarity - b.rarity || a.id - b.id);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function fetchSupportEvents(options: FetchSupportEventsOptions = { dryRun: false }) {
  const { dryRun } = options;

  console.log('Loading local skill data...');
  const skillMap = await loadSkillNameMap();
  console.log(`  ${Object.keys(skillMap).length} skills loaded`);

  console.log('\nFetching GameTora manifest...');
  const manifest = await loadManifest();
  console.log(`  Manifest loaded (${Object.keys(manifest).length} entries)`);

  console.log('\nFetching training event data...');
  const [
    ssrEvents,
    srEvents,
    sharedEvents,
    friendEvents,
    groupEvents,
    teNamesEn,
    teNamesJa,
    evrew
  ] = await Promise.all([
    loadManifestData<RawTrainingEvents>(manifest, 'training_events/ssr'),
    loadManifestData<RawTrainingEvents>(manifest, 'training_events/sr'),
    loadManifestData<RawTrainingEvents>(manifest, 'training_events/shared'),
    loadManifestData<RawTrainingEvents>(manifest, 'training_events/friend'),
    loadManifestData<RawGroupTrainingEvents>(manifest, 'training_events/group'),
    loadManifestData<Array<string | null>>(manifest, 'dict/te_names_en'),
    loadManifestData<Array<string | null>>(manifest, 'dict/te_names_ja'),
    loadManifestData<RawEvrew>(manifest, 'dict/evrew')
  ]);

  if (!evrew) {
    throw new Error('Failed to load evrew (event reward dictionary)');
  }
  if (!teNamesEn && !teNamesJa) {
    throw new Error('Failed to load event name dictionaries');
  }

  const safeTeNamesEn = teNamesEn ?? [];
  const safeTeNamesJa = teNamesJa ?? [];

  // Parse card-specific events (SSR + SR) — keyed by support card ID
  const allEventsMap: SupportEventsMap = {};
  let ssrCount = 0;
  let srCount = 0;

  if (ssrEvents) {
    const parsed = parseTrainingEvents(ssrEvents, safeTeNamesEn, safeTeNamesJa, evrew, skillMap);
    for (const [id, events] of Object.entries(parsed)) {
      allEventsMap[id] = events;
      ssrCount++;
    }
  }

  if (srEvents) {
    const parsed = parseTrainingEvents(srEvents, safeTeNamesEn, safeTeNamesJa, evrew, skillMap);
    for (const [id, events] of Object.entries(parsed)) {
      allEventsMap[id] = [...(allEventsMap[id] ?? []), ...events];
      srCount++;
    }
  }

  console.log(`  Parsed ${ssrCount} SSR + ${srCount} SR card-specific event sets`);

  // Parse shared events — keyed by character ID, applies to ALL support cards
  // for that character (R, SR, SSR). These are the generic character events
  // that play regardless of card rarity.
  const sharedByCharaId: SupportEventsMap = {};
  let sharedCount = 0;

  if (sharedEvents) {
    const parsed = parseTrainingEvents(sharedEvents, safeTeNamesEn, safeTeNamesJa, evrew, skillMap);
    for (const [charaId, events] of Object.entries(parsed)) {
      sharedByCharaId[charaId] = events;
      sharedCount++;
    }
  }

  console.log(`  Parsed ${sharedCount} shared (character-level) event sets`);

  // Parse friend events — keyed by character ID, applies to friend-type cards
  const friendByCharaId: SupportEventsMap = {};
  let friendCount = 0;

  if (friendEvents) {
    const parsed = parseTrainingEvents(friendEvents, safeTeNamesEn, safeTeNamesJa, evrew, skillMap);
    for (const [charaId, events] of Object.entries(parsed)) {
      friendByCharaId[charaId] = events;
      friendCount++;
    }
  }

  console.log(`  Parsed ${friendCount} friend event sets`);

  // Parse group events — keyed by support card ID, structure differs:
  // [cardId, [memberCharaIds], [events...]]
  let groupCount = 0;

  if (groupEvents) {
    for (const entry of groupEvents) {
      if (!Array.isArray(entry) || entry.length < 3) continue;

      const cardId = entry[0];
      const rawEvents = entry[2];
      if (!Array.isArray(rawEvents)) continue;

      // Wrap in the standard format so parseTrainingEvents can handle it
      const wrapped: RawTrainingEvents = [[cardId, rawEvents]];
      const parsed = parseTrainingEvents(wrapped, safeTeNamesEn, safeTeNamesJa, evrew, skillMap);
      const events = parsed[String(cardId)];
      if (events) {
        allEventsMap[String(cardId)] = [...(allEventsMap[String(cardId)] ?? []), ...events];
        groupCount++;
      }
    }
  }

  console.log(`  Parsed ${groupCount} group event sets`);
  console.log(`  Total cards with direct events: ${Object.keys(allEventsMap).length}`);

  // Count total events and skill rewards
  let totalEvents = 0;
  let totalSkillRewards = 0;
  for (const events of Object.values(allEventsMap)) {
    totalEvents += events.length;
    for (const event of events) {
      for (const choice of event.choices) {
        totalSkillRewards += choice.rewards.filter((r) => r.skillId != null).length;
      }
    }
  }
  console.log(`  Total events: ${totalEvents}`);
  console.log(`  Total skill rewards: ${totalSkillRewards}`);

  // Merge into support-cards.json
  console.log('\nMerging eventSkills into support-cards.json...');
  const supportCards = await readJsonFileIfExists<SupportCardsMap>(SUPPORT_CARDS_PATH);

  if (!supportCards) {
    throw new Error(`Could not read ${SUPPORT_CARDS_PATH} — run extract:support-cards first`);
  }

  // Build a charaId → support card IDs index for shared/friend event mapping
  const cardsByCharaId = new Map<number, Array<string>>();
  for (const [cardId, card] of Object.entries(supportCards)) {
    const existing = cardsByCharaId.get(card.charaId) ?? [];
    existing.push(cardId);
    cardsByCharaId.set(card.charaId, existing);
  }

  // Merge shared events into every support card for that character
  let sharedMerged = 0;
  for (const [charaId, events] of Object.entries(sharedByCharaId)) {
    const cardIds = cardsByCharaId.get(Number(charaId)) ?? [];
    for (const cardId of cardIds) {
      allEventsMap[cardId] = [...(allEventsMap[cardId] ?? []), ...events];
      sharedMerged++;
    }
  }
  console.log(`  Shared events applied to ${sharedMerged} card(s)`);

  // Merge friend events into friend-type support cards for that character
  let friendMerged = 0;
  for (const [charaId, events] of Object.entries(friendByCharaId)) {
    const cardIds = cardsByCharaId.get(Number(charaId)) ?? [];
    for (const cardId of cardIds) {
      // Only apply to friend-type cards (supportCardType 6)
      if (supportCards[cardId]?.supportCardType === 6) {
        allEventsMap[cardId] = [...(allEventsMap[cardId] ?? []), ...events];
        friendMerged++;
      }
    }
  }
  console.log(`  Friend events applied to ${friendMerged} card(s)`);

  let mergedCount = 0;
  let unmatchedCount = 0;
  const unmatchedIds: Array<string> = [];

  for (const [cardId, events] of Object.entries(allEventsMap)) {
    const card = supportCards[cardId];
    if (card) {
      card.eventSkills = extractEventSkills(events, skillMap);
      mergedCount++;
    } else {
      unmatchedCount++;
      unmatchedIds.push(cardId);
    }
  }

  const totalEventSkills = Object.values(supportCards).reduce(
    (sum, card) => sum + card.eventSkills.length,
    0
  );

  console.log(`  Merged: ${mergedCount} cards`);
  console.log(`  Unmatched (JP-only or missing from local data): ${unmatchedCount}`);
  console.log(`  Total eventSkills across all cards: ${totalEventSkills}`);

  if (unmatchedIds.length > 0 && unmatchedIds.length <= 10) {
    console.log(`  Unmatched IDs: ${unmatchedIds.join(', ')}`);
  }

  if (dryRun) {
    console.log('\n[dry-run] Skipping file writes.');

    // Print a sample
    const sampleId = Object.keys(allEventsMap)[0];
    if (sampleId) {
      const sampleEvents = allEventsMap[sampleId]!;
      console.log(`\nSample events for card ${sampleId}:`);
      for (const event of sampleEvents.slice(0, 3)) {
        console.log(`  ${event.eventName}`);
        for (const choice of event.choices) {
          const prefix = choice.label ? `    [${choice.label}] ` : ' '.repeat(4);
          for (const reward of choice.rewards) {
            if (reward.skillId != null) {
              console.log(`${prefix}${reward.label} ${reward.value}`);
            } else {
              console.log(`${prefix}${reward.label} ${reward.value}`);
            }
          }
        }
      }
    }

    return;
  }

  // Write support-cards.json with updated eventSkills
  await writeJsonFile(SUPPORT_CARDS_PATH, sortByNumericKey(supportCards));
  console.log(`\nWrote ${SUPPORT_CARDS_PATH}`);

  // Write support-events.json (full event data for UI consumption)
  await writeJsonFile(SUPPORT_EVENTS_PATH, allEventsMap);
  console.log(`Wrote ${SUPPORT_EVENTS_PATH}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const options = parseCliArgs(process.argv);

  fetchSupportEvents(options).catch((error) => {
    console.error('Failed to fetch support events:', error.message);
    process.exit(1);
  });
}

export { fetchSupportEvents, parseCliArgs };
export type { SupportEvent, SupportEventsMap };
