#!/usr/bin/env tsx
/**
 * Fetch eventData from GameTora for all support cards and produce a JSON mapping
 * of support_id → { chain_event_skills, random_event_skills }.
 *
 * Usage: tsx scripts/fetch-event-skill-sources.ts
 * Output: src/modules/data/json/gametora/event-skill-sources.json
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import supportCardsJson from '../src/modules/data/json/gametora/support-cards.json';

const OUTPUT_FILE = resolve(
  import.meta.dirname,
  '../src/modules/data/json/gametora/event-skill-sources.json'
);

const GAMETORA_BASE = 'https://gametora.com';
const CONCURRENCY = 10;
const LOG_INTERVAL = 50;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

type SupportCardSnapshot = {
  support_id: number;
  url_name?: string;
  event_skills?: Array<number> | null;
};

type EventReward = { t: string; v: string; d?: number };
type EventChoice = { o: string; r: Array<EventReward> };
type TrainingEvent = { i: number; n: string; c: Array<EventChoice> };
type EventData = { arrows?: Array<TrainingEvent>; random?: Array<TrainingEvent> };

type EventSkillSourceEntry = {
  chain_event_skills: Array<number>;
  random_event_skills: Array<number>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchBuildId(): Promise<string> {
  const resp = await fetch(`${GAMETORA_BASE}/umamusume/supports`);
  const html = await resp.text();
  const match = html.match(/"buildId":"([^"]+)"/);

  if (!match) {
    throw new Error('Could not find GameTora buildId in page HTML');
  }

  return match[1];
}

function extractSkillIds(events: Array<TrainingEvent>): Array<number> {
  const skills = new Set<number>();

  for (const event of events) {
    for (const choice of event.c) {
      for (const reward of choice.r) {
        if (reward.t === 'sk' && reward.d != null) {
          skills.add(reward.d);
        }
      }
    }
  }

  return Array.from(skills).sort((a, b) => a - b);
}

async function fetchCardEventData(
  buildId: string,
  urlName: string
): Promise<EventSkillSourceEntry | null> {
  const url = `${GAMETORA_BASE}/_next/data/${buildId}/umamusume/supports/${urlName}.json`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const eventDataRaw = data?.pageProps?.eventData;

  if (!eventDataRaw) {
    return null;
  }

  const raw: string | undefined = eventDataRaw.en ?? eventDataRaw.ja;

  if (!raw) {
    return null;
  }

  const events: EventData = JSON.parse(raw);
  const chainSkills = extractSkillIds(events.arrows ?? []);
  const randomSkills = extractSkillIds(events.random ?? []);

  if (chainSkills.length === 0 && randomSkills.length === 0) {
    return null;
  }

  return {
    chain_event_skills: chainSkills,
    random_event_skills: randomSkills
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const cards = (supportCardsJson as Array<SupportCardSnapshot>).filter(
  (sc) => sc.event_skills?.length && sc.url_name
);

console.log(`Fetching event data for ${cards.length} support cards...`);

const buildId = await fetchBuildId();
console.log(`Build ID: ${buildId}`);

const result: Record<string, EventSkillSourceEntry> = {};
const errors: Array<string> = [];
let processed = 0;

// Process in batches of CONCURRENCY
for (let i = 0; i < cards.length; i += CONCURRENCY) {
  const batch = cards.slice(i, i + CONCURRENCY);

  const settled = await Promise.allSettled(
    batch.map(async (card) => {
      let lastError: unknown;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const entry = await fetchCardEventData(buildId, card.url_name!);

          if (entry) {
            result[String(card.support_id)] = entry;
          }

          return;
        } catch (err) {
          lastError = err;
          await sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }

      throw lastError;
    })
  );

  for (let j = 0; j < settled.length; j++) {
    const outcome = settled[j];

    if (outcome.status === 'rejected') {
      const card = batch[j];
      const msg = `${card.support_id} (${card.url_name}): ${outcome.reason}`;
      errors.push(msg);
      console.error(`  ERROR: ${msg}`);
    }
  }

  processed += batch.length;

  if (processed % LOG_INTERVAL === 0 || processed === cards.length) {
    console.log(`  Processed ${processed}/${cards.length}...`);
  }
}

console.log(
  `\nDone. ${Object.keys(result).length} cards with event data, ${errors.length} errors.`
);

if (errors.length > 0) {
  console.log('\nErrors:');

  for (const err of errors) {
    console.log(`  ${err}`);
  }
}

await writeFile(OUTPUT_FILE, JSON.stringify(result));
console.log(`Written to ${OUTPUT_FILE}`);
