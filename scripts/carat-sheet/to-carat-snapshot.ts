#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCaratPlanSnapshotJson } from '../../src/modules/carat/share/snapshot';
import type { CaratPlanSnapshot } from '../../src/modules/carat/share/types';

type SheetBanner = {
  name: string;
  type: 'Uma' | 'Support' | 'Step Up';
  start: { date: string | null };
  plannedPulls: number | null;
};

type SheetPlan = {
  userInputs: {
    freeCarats: number;
    paidCarats: number;
    umaTickets: number;
    supportTickets: number;
    settings: {
      teamTrialsClass: string;
      clubRank: string;
      championsMeetingPlacement: string;
      legendOfHeroesRank: string;
      dailyCaratPack: string;
      trainingPass: string;
    };
  };
  banners: SheetBanner[];
};

type TimelineEvent = {
  id: string;
  type: string;
  card_type: 'character' | 'support' | null;
  title?: string | null;
  global_release_date?: string | null;
  jp_release_date?: string | null;
  related_characters?: string[] | null;
  related_support_cards?: string[] | null;
  related_support_card_names?: string[] | null;
  pickup_card_ids?: number[] | null;
};

type TimelinePayload = {
  events: TimelineEvent[];
};

type SupportCardCatalogEntry = {
  support_id: number;
  char_name: string;
};

type Snapshot = CaratPlanSnapshot;

type MatchCandidate = {
  id: string;
  title: string | null;
  type: string;
  cardType: string | null;
  releaseDate: string | null;
  daysFromSheetStart: number | null;
  matchedCardNames: string[];
  eventCardNames: string[];
  catalogCardNames: string[];
};

type UnmatchedBanner = {
  sheetIndex: number;
  name: string;
  type: string;
  startDate: string | null;
  reason: string;
  candidates: MatchCandidate[];
};

type MatchedBanner = {
  sheetIndex: number;
  name: string;
  type: string;
  startDate: string | null;
  event: MatchCandidate;
  resolution: string;
};

type CliOptions = {
  inputPath: string;
  timelinePath?: string;
  timelineUrl: string;
  outputPath: string;
  reportPath: string;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_INPUT_PATH = path.join(ROOT, 'results', 'reference-sheet', 'latias-pull-plan.json');
const SUPPORT_CARD_CATALOG_PATH = path.join(
  ROOT,
  'src',
  'modules',
  'data',
  'json',
  'gametora',
  'support-cards.json'
);
const DEFAULT_TIMELINE_URL = 'https://torena-sim-timeline-proxy.torena-sim.workers.dev/timeline';
const DEFAULT_TIMELINE_ORIGIN = 'https://torena-sim.pages.dev';
const MINIMUM_MATCH_RATE = 0.8;

const IDENTITY_ALIASES: Record<string, string> = {
  'kenko hoshina': 'kiyoko hoshina',
  'tucker brine': 'tucker bryne'
};

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/carat-sheet/to-carat-snapshot.ts [compiled-plan.json] [timeline.json]',
    '       [--input <compiled-plan.json>] [--timeline <timeline.json>]',
    '       [--timeline-url <worker-url>] [--output <snapshot.json>] [--report <report.json>]',
    '',
    'When --timeline is omitted, fetches --timeline-url (or TIMELINE_PROXY_URL) using TIMELINE_PROXY_KEY when set.',
    `Without a key, the request sends Origin: ${DEFAULT_TIMELINE_ORIGIN} (override with TIMELINE_PROXY_ORIGIN).`
  ].join('\n');
}

function parseCli(argv: string[]): CliOptions {
  const positional: string[] = [];
  const options: Partial<CliOptions> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.\n\n${usage()}`);
    }

    switch (argument) {
      case '--input':
        options.inputPath = value;
        break;
      case '--timeline':
        options.timelinePath = value;
        break;
      case '--timeline-url':
        options.timelineUrl = value;
        break;
      case '--output':
        options.outputPath = value;
        break;
      case '--report':
        options.reportPath = value;
        break;
      default:
        throw new Error(`Unknown option ${argument}.\n\n${usage()}`);
    }
    index += 1;
  }

  if (positional.length > 2) {
    throw new Error(`Expected at most two positional paths.\n\n${usage()}`);
  }

  return {
    inputPath: path.resolve(options.inputPath ?? positional[0] ?? DEFAULT_INPUT_PATH),
    timelinePath: options.timelinePath ?? positional[1],
    timelineUrl: options.timelineUrl ?? process.env.TIMELINE_PROXY_URL ?? DEFAULT_TIMELINE_URL,
    outputPath: path.resolve(
      options.outputPath ?? path.join(ROOT, 'results', 'reference-sheet', 'latias-snapshot.json')
    ),
    reportPath: path.resolve(
      options.reportPath ??
        path.join(ROOT, 'results', 'reference-sheet', 'latias-snapshot-report.json')
    )
  };
}

function normalizeName(value: string): string {
  const normalized = value
    .replaceAll(/\s*\([^)]*\)/g, ' ')
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ');

  const withoutDisplaySuffix = normalized.replace(/\s+power$/, '');
  return IDENTITY_ALIASES[withoutDisplaySuffix] ?? withoutDisplaySuffix;
}

function sheetCardNames(name: string): string[] {
  return name
    .split(/\s+\+\s+/)
    .map(normalizeName)
    .filter(Boolean);
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
}

function catalogCardNames(
  event: TimelineEvent,
  supportCardsById: ReadonlyMap<number, string>
): string[] {
  return uniqueNames(
    (event.pickup_card_ids ?? [])
      .map((id) => supportCardsById.get(id))
      .filter((name): name is string => typeof name === 'string')
      .map(normalizeName)
      .filter(Boolean)
  );
}

function eventCardNames(
  event: TimelineEvent,
  supportCardsById: ReadonlyMap<number, string>
): string[] {
  return uniqueNames(
    [
      event.title,
      ...(event.related_characters ?? []),
      ...(event.related_support_cards ?? []),
      ...(event.related_support_card_names ?? []),
      ...catalogCardNames(event, supportCardsById)
    ]
      .filter((name): name is string => typeof name === 'string')
      .map(normalizeName)
      .filter(Boolean)
  );
}

function releaseDate(event: TimelineEvent): string | null {
  const date = event.global_release_date ?? event.jp_release_date;
  if (!date || Number.isNaN(Date.parse(date))) return null;
  return new Date(date).toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  const leftTimestamp = Date.parse(`${left}T00:00:00Z`);
  const rightTimestamp = Date.parse(`${right}T00:00:00Z`);
  return Math.round((leftTimestamp - rightTimestamp) / 86_400_000);
}

function primaryEventTypeMatches(sheetType: SheetBanner['type'], event: TimelineEvent): boolean {
  if (sheetType === 'Uma')
    return event.type === 'character_banner' && event.card_type === 'character';
  if (sheetType === 'Support') {
    return event.type === 'support_card_banner' && event.card_type === 'support';
  }
  return event.type === 'paid_banner';
}

function paidFallbackMatches(sheetType: SheetBanner['type'], event: TimelineEvent): boolean {
  if (event.type !== 'paid_banner') return false;
  if (sheetType === 'Uma') return event.card_type === 'character';
  if (sheetType === 'Support') return event.card_type === 'support';
  return false;
}

function candidateFor(
  banner: SheetBanner,
  event: TimelineEvent,
  supportCardsById: ReadonlyMap<number, string>
): MatchCandidate | null {
  const eventStartDate = releaseDate(event);
  const targets = sheetCardNames(banner.name);
  const names = eventCardNames(event, supportCardsById);
  const matchedCardNames = targets.filter((target) => names.includes(target));
  const daysFromSheetStart =
    eventStartDate && banner.start.date ? daysBetween(eventStartDate, banner.start.date) : null;

  return {
    id: event.id,
    title: event.title ?? null,
    type: event.type,
    cardType: event.card_type,
    releaseDate: eventStartDate,
    daysFromSheetStart,
    matchedCardNames,
    eventCardNames: names,
    catalogCardNames: catalogCardNames(event, supportCardsById)
  };
}

function candidatesFor(
  banner: SheetBanner,
  timeline: TimelinePayload,
  supportCardsById: ReadonlyMap<number, string>,
  eventMatches: (sheetType: SheetBanner['type'], event: TimelineEvent) => boolean
): MatchCandidate[] {
  return timeline.events
    .filter((event) => eventMatches(banner.type, event))
    .map((event) => candidateFor(banner, event, supportCardsById))
    .filter((candidate): candidate is MatchCandidate => candidate !== null)
    .sort(
      (left, right) =>
        right.matchedCardNames.length - left.matchedCardNames.length ||
        Math.abs(left.daysFromSheetStart ?? Number.POSITIVE_INFINITY) -
          Math.abs(right.daysFromSheetStart ?? Number.POSITIVE_INFINITY) ||
        left.id.localeCompare(right.id)
    );
}

function closestByDate(
  matches: MatchCandidate[],
  sheetStartDate: string | null
): MatchCandidate | null {
  if (!sheetStartDate || matches.length === 0) return null;
  const dated = matches.filter((candidate) => candidate.daysFromSheetStart !== null);
  if (dated.length === 0) return null;
  const closestDistance = Math.min(
    ...dated.map((candidate) => Math.abs(candidate.daysFromSheetStart!))
  );
  const closest = dated.filter(
    (candidate) => Math.abs(candidate.daysFromSheetStart!) === closestDistance
  );
  return closest.length === 1 ? closest[0] : null;
}

function resolveCandidates(
  banner: SheetBanner,
  candidates: MatchCandidate[],
  poolDescription: string
):
  | { match: MatchCandidate; resolution: string }
  | { match: null; reason: string; candidates: MatchCandidate[] } {
  const targetCount = sheetCardNames(banner.name).length;
  const exactMatches = candidates.filter(
    (candidate) => candidate.matchedCardNames.length === targetCount
  );

  if (exactMatches.length === 1) {
    return {
      match: exactMatches[0],
      resolution: `Unique normalized all-card identity match in ${poolDescription}.`
    };
  }

  if (exactMatches.length > 1) {
    const closest = closestByDate(exactMatches, banner.start.date);
    if (closest) {
      return {
        match: closest,
        resolution: `Multiple normalized all-card identity matches in ${poolDescription}; selected the unique closest projected Global date without applying a date cutoff.`
      };
    }

    return {
      match: null,
      reason: banner.start.date
        ? `Multiple normalized all-card identity matches in ${poolDescription} tied or lacked dates; no id was selected.`
        : `Multiple normalized all-card identity matches in ${poolDescription}, but the sheet banner has no date for deterministic disambiguation.`,
      candidates: exactMatches
    };
  }

  return {
    match: null,
    reason: `No normalized all-card identity match was found in ${poolDescription}.`,
    candidates: candidates.filter((candidate) => candidate.matchedCardNames.length > 0).slice(0, 10)
  };
}

function resolveMatch(
  banner: SheetBanner,
  timeline: TimelinePayload,
  supportCardsById: ReadonlyMap<number, string>
):
  | { match: MatchCandidate; resolution: string }
  | { match: null; unmatched: Omit<UnmatchedBanner, 'sheetIndex'> } {
  const primaryCandidates = candidatesFor(
    banner,
    timeline,
    supportCardsById,
    primaryEventTypeMatches
  );
  const primary = resolveCandidates(banner, primaryCandidates, 'same-type standard banners');
  if (primary.match) return primary;
  if (primary.reason.startsWith('Multiple')) {
    return {
      match: null,
      unmatched: {
        name: banner.name,
        type: banner.type,
        startDate: banner.start.date,
        reason: primary.reason,
        candidates: primary.candidates
      }
    };
  }

  if (banner.type !== 'Step Up') {
    const paidCandidates = candidatesFor(banner, timeline, supportCardsById, paidFallbackMatches);
    const paid = resolveCandidates(
      banner,
      paidCandidates,
      'same-card-type paid banners (fallback)'
    );
    if (paid.match) return paid;
    if (paid.reason.startsWith('Multiple')) {
      return {
        match: null,
        unmatched: {
          name: banner.name,
          type: banner.type,
          startDate: banner.start.date,
          reason: `${primary.reason} ${paid.reason}`,
          candidates: paid.candidates
        }
      };
    }
  }

  return {
    match: null,
    unmatched: {
      name: banner.name,
      type: banner.type,
      startDate: banner.start.date,
      reason: primary.reason,
      candidates: primary.candidates
    }
  };
}

function mapDropdown<T>(label: string, value: string, mapping: Record<string, T>): T {
  const mapped = mapping[normalizeName(value)];
  if (!mapped) {
    throw new Error(`Unsupported ${label} value ${JSON.stringify(value)} in compiled plan.`);
  }
  return mapped;
}

function buildSettings(plan: SheetPlan): Snapshot['settings'] {
  const input = plan.userInputs;
  return {
    server: 'global',
    startingFreeCarats: input.freeCarats,
    startingPaidCarats: input.paidCarats,
    umaTickets: input.umaTickets,
    supportTickets: input.supportTickets,
    monthlyCarats: 15_000,
    monthlyTickets: 27,
    teamTrialsClass: mapDropdown('Team Trials class', input.settings.teamTrialsClass, {
      'class 1': 'class-1',
      'class 2': 'class-2',
      'class 3': 'class-3',
      'class 4': 'class-4',
      'class 5': 'class-5',
      'class 6': 'class-6'
    }),
    clubRank: mapDropdown('club rank', input.settings.clubRank, {
      none: 'none',
      e: 'e',
      'e+': 'e+',
      d: 'd',
      'd+': 'd+',
      c: 'c',
      'c+': 'c+',
      b: 'b',
      'b+': 'b+',
      a: 'a',
      'a+': 'a+',
      's-': 's-',
      s: 's',
      's+': 's+'
    }),
    cmPlacement: mapDropdown(
      'Champions Meeting placement',
      input.settings.championsMeetingPlacement,
      {
        none: 'none',
        participant: 'participant',
        finalist: 'finalist',
        winner: 'winner',
        third: 'third',
        second: 'second',
        first: 'first'
      }
    ),
    lohRank: mapDropdown('Legend of Heroes rank', input.settings.legendOfHeroesRank, {
      none: 'none',
      bronze: 'bronze',
      silver: 'silver',
      gold: 'gold',
      platinum: 'platinum',
      'platinum 1': 'platinum-1',
      'platinum 2': 'platinum-2',
      'platinum 3': 'platinum-3',
      'platinum 4': 'platinum-4'
    }),
    dailyCaratPack: mapDropdown('daily carat pack', input.settings.dailyCaratPack, {
      yes: true,
      no: false
    }),
    trainingPass: mapDropdown('training pass', input.settings.trainingPass, {
      none: 'none',
      free: 'free',
      paid: 'paid'
    }),
    trackPaidCarats: true
  };
}

function assertSheetPlan(value: unknown): asserts value is SheetPlan {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Compiled plan must be a JSON object.');
  }

  const plan = value as Partial<SheetPlan>;
  if (!plan.userInputs || !Array.isArray(plan.banners)) {
    throw new Error('Compiled plan is missing userInputs or banners.');
  }
}

function assertTimelinePayload(value: unknown): asserts value is TimelinePayload {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as TimelinePayload).events)
  ) {
    throw new Error('Timeline JSON is missing an events array.');
  }
}

function assertSupportCardCatalog(value: unknown): asserts value is SupportCardCatalogEntry[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as SupportCardCatalogEntry).support_id === 'number' &&
        typeof (entry as SupportCardCatalogEntry).char_name === 'string'
    )
  ) {
    throw new Error('Support-card catalog has an unexpected shape.');
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

function timelineEndpoint(workerUrl: string): string {
  const url = new URL(workerUrl);
  if (!url.pathname.endsWith('/timeline')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/timeline`;
  }
  return url.toString();
}

async function loadTimeline(
  options: CliOptions
): Promise<{ timeline: TimelinePayload; source: string }> {
  if (options.timelinePath) {
    const timeline = await readJson(path.resolve(options.timelinePath));
    assertTimelinePayload(timeline);
    return { timeline, source: `cached JSON: ${path.resolve(options.timelinePath)}` };
  }

  const endpoint = timelineEndpoint(options.timelineUrl);
  const headers = new Headers({
    Origin: process.env.TIMELINE_PROXY_ORIGIN ?? DEFAULT_TIMELINE_ORIGIN
  });
  const proxyKey = process.env.TIMELINE_PROXY_KEY;
  if (proxyKey) headers.set('X-Proxy-Key', proxyKey);

  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    throw new Error(
      `Timeline fetch failed: ${response.status} ${response.statusText} (${endpoint}).`
    );
  }

  const timeline = (await response.json()) as unknown;
  assertTimelinePayload(timeline);
  return { timeline, source: `fetched: ${endpoint}` };
}

function assertSnapshotParses(snapshot: Snapshot): void {
  if (parseCaratPlanSnapshotJson(JSON.stringify(snapshot)) === null) {
    throw new Error('Generated snapshot was rejected by parseCaratPlanSnapshotJson.');
  }
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const source = await readJson(options.inputPath);
  assertSheetPlan(source);
  const { timeline, source: timelineSource } = await loadTimeline(options);
  const supportCardCatalog = await readJson(SUPPORT_CARD_CATALOG_PATH);
  assertSupportCardCatalog(supportCardCatalog);
  const supportCardsById = new Map(
    supportCardCatalog.map((card) => [card.support_id, card.char_name])
  );
  const unmatched: UnmatchedBanner[] = [];
  const matched: MatchedBanner[] = [];
  const plannedBanners: Snapshot['plannedBanners'] = [];

  for (const [sheetIndex, banner] of source.banners.entries()) {
    const resolution = resolveMatch(banner, timeline, supportCardsById);
    if (!resolution.match) {
      unmatched.push({ sheetIndex, ...resolution.unmatched });
      continue;
    }

    matched.push({
      sheetIndex,
      name: banner.name,
      type: banner.type,
      startDate: banner.start.date,
      event: resolution.match,
      resolution: resolution.resolution
    });
    plannedBanners.push({
      id: resolution.match.id,
      plannedPulls: Math.max(0, Math.floor(banner.plannedPulls ?? 0)),
      startingDupes: 0,
      copyGoals: {},
      ownedCopies: {},
      order: sheetIndex
    });
  }

  const snapshot: Snapshot = {
    version: 2,
    timestamp: Date.now(),
    name: 'Latias4Ever pull plan (reference sheet import)',
    settings: buildSettings(source),
    plannedBanners,
    paidPurchases: {},
    selectorChoices: {}
  };
  assertSnapshotParses(snapshot);

  const total = source.banners.length;
  const matchRate = total === 0 ? 0 : plannedBanners.length / total;
  const report = {
    source: {
      compiledPlan: options.inputPath,
      timeline: timelineSource,
      supportCardCatalog: SUPPORT_CARD_CATALOG_PATH
    },
    matching: {
      strategy:
        'Normalized all-card names are the primary identity. Parenthetical display variants and the workbook suffix "Power" are removed; known live spelling drift is canonicalized; pickup_card_ids are resolved through the local support-card catalog for group/display labels. Standard same-type banners are preferred, then same-card-type paid banners. Dates never gate identity and only select the unique closest projected Global date when repeated all-card matches exist; a null-date banner requires a unique identity match.',
      totalSheetBanners: total,
      matchedBanners: plannedBanners.length,
      unmatchedBanners: unmatched.length,
      matchRate,
      minimumRequiredMatchRate: MINIMUM_MATCH_RATE
    },
    matched,
    unmatched
  };

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `Matched ${plannedBanners.length}/${total} sheet banners (${(matchRate * 100).toFixed(1)}%). ` +
      `Snapshot: ${options.outputPath}. Report: ${options.reportPath}.`
  );

  if (matchRate < MINIMUM_MATCH_RATE) {
    throw new Error(
      `Match rate ${(matchRate * 100).toFixed(1)}% is below the required ${(MINIMUM_MATCH_RATE * 100).toFixed(0)}%. ` +
        `Review actual candidates in ${options.reportPath}; no ids were invented for unmatched rows.`
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exit(1);
});
