import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent, TimelinePayload } from '@/modules/carat/data/timeline-types';
import type { CaratSettings, PlannedBanner } from '@/store/carat.store';
import { projectIncome, projectMonthlyIncomeBreakdown } from './income';
import { computePlan } from './plan';
import { parseCaratPlanSnapshotJson } from '../share/snapshot';
import referenceFixtureJson from './__fixtures__/reference-latias.json';
import referenceSnapshotJson from './__fixtures__/reference-latias-snapshot.json';
import referenceTimelineEventsJson from './__fixtures__/reference-latias-timeline-events.json';

type ReferenceIncome = Record<
  | 'timelineHandouts'
  | 'dailyQuest'
  | 'teamTrials'
  | 'clubRank'
  | 'trainingPass'
  | 'dailyPack'
  | 'championsMeeting'
  | 'legendOfHeroes'
  | 'fiftyDayLogin'
  | 'misc',
  number | null
>;

type ReferenceBanner = {
  name: string;
  type: 'Uma' | 'Support' | 'Step Up';
  start: { date: string | null };
  income: ReferenceIncome;
};

type ReferenceFixture = {
  anchors: {
    timelineNow: { date: string | null };
    incomeStart: { date: string | null };
  };
  banners: ReferenceBanner[];
  summary: {
    yearCarats: number;
    yearDays: number;
  };
};

type DeterministicTimelineFixture = {
  window: {
    from: string;
    to: string;
  };
  events: Array<Pick<TimelineEvent, 'id' | 'type' | 'global_release_date' | 'jp_release_date'>>;
};

const REFERENCE_FIXTURE = referenceFixtureJson as ReferenceFixture;
const SNAPSHOT = parseCaratPlanSnapshotJson(JSON.stringify(referenceSnapshotJson));
const REFERENCE_TIMELINE_EVENTS = referenceTimelineEventsJson as DeterministicTimelineFixture;
const REFERENCE_YEAR_TIMELINE_HANDOUTS = 109_170;
const REFERENCE_YEAR_LOGIN_CARATS = 2_050;
const REFERENCE_DOCUMENTED_CM_DATES = [
  '2026-07-22',
  '2026-09-15',
  '2026-09-15',
  '2026-11-12',
  '2026-11-12',
  '2026-11-12',
  '2026-11-29',
  '2026-11-29',
  '2027-01-27',
  '2027-02-18',
  '2027-04-05',
  '2027-05-14',
  '2027-07-02'
] as const;

function emptyTimeline(): TimelinePayload {
  return {
    anniversaries: [],
    calculation: {},
    events: [],
    version: 'reference-latias-deterministic'
  };
}

// The sheet's component totals and the task's reference configuration establish B+ as the effective club rank for this comparison.
function dateAtDailyReset(date: string): Date {
  return new Date(`${date}T22:00:00.000Z`);
}

function datedBanners(): Array<ReferenceBanner & { start: { date: string } }> {
  return REFERENCE_FIXTURE.banners
    .filter(
      (banner): banner is ReferenceBanner & { start: { date: string } } =>
        banner.start.date !== null && banner.income.championsMeeting !== null
    )
    .sort((left, right) => left.start.date.localeCompare(right.start.date));
}

function cumulativeChampionsMeetingEvents(
  banners: Array<ReferenceBanner & { start: { date: string } }>
): TimelineEvent[] {
  let previousCumulativeCarats = 0;
  const events: TimelineEvent[] = [];

  for (const [bannerIndex, banner] of banners.entries()) {
    const cumulativeCarats = banner.income.championsMeeting;
    if (cumulativeCarats === null) continue;

    const addedCarats = cumulativeCarats - previousCumulativeCarats;
    if (addedCarats < 0 || addedCarats % 1_600 !== 0) {
      throw new Error(
        `Reference CM cumulative value ${cumulativeCarats} at ${banner.start.date} cannot be represented as Third-place rewards.`
      );
    }

    for (let eventIndex = 0; eventIndex < addedCarats / 1_600; eventIndex += 1) {
      events.push({
        id: `reference-cm-${bannerIndex}-${eventIndex}`,
        card_type: null,
        type: 'champions_meeting',
        global_release_date: dateAtDailyReset(banner.start.date).toISOString()
      });
    }

    previousCumulativeCarats = cumulativeCarats;
  }

  return events;
}

function buildTimeline(
  banners: Array<ReferenceBanner & { start: { date: string } }>,
  plannedBanners: PlannedBanner[],
  incomeEvents: TimelineEvent[] = []
): TimelinePayload {
  const bannerEvents: TimelineEvent[] = banners.map((banner, index) => ({
    id: plannedBanners[index].id,
    card_type: banner.type === 'Uma' ? 'character' : 'support',
    type: banner.type === 'Uma' ? 'character_banner' : 'support_card_banner',
    global_release_date: dateAtDailyReset(banner.start.date).toISOString()
  }));

  return {
    anniversaries: [],
    calculation: {},
    events: [...bannerEvents, ...cumulativeChampionsMeetingEvents(banners), ...incomeEvents],
    version: 'reference-latias-deterministic'
  };
}

function documentedChampionsMeetingEvents(): TimelineEvent[] {
  return REFERENCE_DOCUMENTED_CM_DATES.map((date, index) => ({
    id: `reference-documented-cm-${index + 1}`,
    card_type: null,
    type: 'champions_meeting',
    global_release_date: dateAtDailyReset(date).toISOString()
  }));
}

function yearTimeline(includeChampionsMeetings: boolean): TimelinePayload {
  return {
    ...emptyTimeline(),
    events: [
      ...REFERENCE_TIMELINE_EVENTS.events.map((event) => ({ ...event, card_type: null })),
      ...(includeChampionsMeetings ? documentedChampionsMeetingEvents() : [])
    ]
  };
}

function baseline(reference: number, ours: number) {
  return {
    reference,
    ours,
    delta: ours - reference,
    deltaPercent: (ours - reference) / reference
  };
}

describe('Latias plan reference differential', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the deterministic snapshot and sheet dates', () => {
    expect(SNAPSHOT).not.toBeNull();

    const timelineNow = REFERENCE_FIXTURE.anchors.timelineNow.date;
    expect(timelineNow).toBe('2026-07-18');
    vi.useFakeTimers();
    vi.setSystemTime(dateAtDailyReset(timelineNow!));

    const banners = datedBanners();
    const plannedBanners = SNAPSHOT!.plannedBanners
      .slice(0, banners.length)
      .map((banner, index) => ({
        ...banner,
        // The source snapshot has one repeated upstream id; the sheet row index preserves its distinct planned position without changing app code.
        id: `reference-sheet-${index}-${banner.id}`
      }));
    const timeline = buildTimeline(banners, plannedBanners);
    const rows = computePlan(SNAPSHOT!.settings, timeline, plannedBanners);

    expect(rows).toHaveLength(banners.length);
    expect(rows.map((row) => row.event.id)).toEqual(
      [...plannedBanners]
        .sort((left, right) => {
          const leftEvent = timeline.events.find((event) => event.id === left.id)!;
          const rightEvent = timeline.events.find((event) => event.id === right.id)!;
          return (
            Date.parse(leftEvent.global_release_date ?? '') -
            Date.parse(rightEvent.global_release_date ?? '')
          );
        })
        .map((banner) => banner.id)
    );
  });

  it('keeps cumulative recurring, CM, and LoH components within final tolerances', () => {
    expect(SNAPSHOT).not.toBeNull();

    const anchor = REFERENCE_FIXTURE.anchors.incomeStart.date;
    const banners = datedBanners();
    const latest = banners.at(-1)!;
    const toDate = dateAtDailyReset(latest.start.date);
    const plannedBanners = SNAPSHOT!.plannedBanners
      .slice(0, banners.length)
      .map((banner, index) => ({ ...banner, id: `reference-sheet-${index}-${banner.id}` }));
    const timeline = buildTimeline(banners, plannedBanners);
    const settings: CaratSettings = SNAPSHOT!.settings;
    const noOptionalIncome: CaratSettings = {
      ...settings,
      teamTrialsClass: 'class-1',
      clubRank: 'none',
      cmPlacement: 'none',
      lohRank: 'none',
      dailyCaratPack: false,
      trainingPass: 'none'
    };
    const fromDate = dateAtDailyReset(anchor!);
    const dailyQuest = projectIncome(noOptionalIncome, timeline, fromDate, toDate).carats;
    const componentIncome = <K extends keyof CaratSettings>(key: K, value: CaratSettings[K]) =>
      projectIncome({ ...noOptionalIncome, [key]: value }, timeline, fromDate, toDate).carats -
      dailyQuest;
    const components = {
      dailyQuest: baseline(latest.income.dailyQuest!, dailyQuest),
      teamTrials: baseline(
        latest.income.teamTrials!,
        componentIncome('teamTrialsClass', settings.teamTrialsClass)
      ),
      clubRank: baseline(latest.income.clubRank!, componentIncome('clubRank', settings.clubRank)),
      dailyPack: baseline(
        latest.income.dailyPack!,
        componentIncome('dailyCaratPack', settings.dailyCaratPack)
      ),
      trainingPass: baseline(
        latest.income.trainingPass!,
        componentIncome('trainingPass', settings.trainingPass)
      ),
      championsMeeting: baseline(
        latest.income.championsMeeting!,
        componentIncome('cmPlacement', settings.cmPlacement)
      ),
      legendOfHeroes: baseline(
        latest.income.legendOfHeroes!,
        componentIncome('lohRank', settings.lohRank)
      )
    };

    expect(Math.abs(components.dailyQuest.deltaPercent)).toBeLessThan(0.1);
    expect(Math.abs(components.teamTrials.deltaPercent)).toBeLessThan(0.1);
    expect(Math.abs(components.clubRank.deltaPercent)).toBeLessThan(0.1);
    expect(Math.abs(components.dailyPack.deltaPercent)).toBeLessThan(0.1);
    expect(Math.abs(components.trainingPass.deltaPercent)).toBeLessThan(0.1);
    expect(components.championsMeeting.delta).toBe(0);
    expect(Math.abs(components.legendOfHeroes.deltaPercent)).toBeLessThan(0.15);
  });

  it('keeps year-one event handouts and login income within 10%', () => {
    expect(SNAPSHOT).not.toBeNull();

    const from = new Date(REFERENCE_TIMELINE_EVENTS.window.from);
    const to = new Date(REFERENCE_TIMELINE_EVENTS.window.to);
    const noOptionalIncome: CaratSettings = {
      ...SNAPSHOT!.settings,
      teamTrialsClass: 'class-1',
      clubRank: 'none',
      cmPlacement: 'none',
      lohRank: 'none',
      dailyCaratPack: false,
      trainingPass: 'none'
    };
    const withoutEvents = projectIncome(noOptionalIncome, emptyTimeline(), from, to);
    const withEvents = projectIncome(noOptionalIncome, yearTimeline(false), from, to);
    const modeledEventIncome = withEvents.carats - withoutEvents.carats;
    const elapsedDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1_000);
    const modeledLoginIncome = withoutEvents.carats - (75 + 150 / 7) * elapsedDays;
    const eventDelta = baseline(REFERENCE_YEAR_TIMELINE_HANDOUTS, modeledEventIncome);
    const loginDelta = baseline(REFERENCE_YEAR_LOGIN_CARATS, modeledLoginIncome);

    expect(modeledEventIncome).toBeCloseTo(101_740, 6);
    expect(withEvents.umaTickets - withoutEvents.umaTickets).toBeCloseTo(28, 6);
    expect(withEvents.supportTickets - withoutEvents.supportTickets).toBeCloseTo(28, 6);
    expect(Math.abs(eventDelta.deltaPercent)).toBeLessThan(0.1);
    expect(Math.abs(loginDelta.deltaPercent)).toBeLessThan(0.1);
  });

  it('lands the full 13-CM all-in monthly header between 17k and 21k', () => {
    expect(SNAPSHOT).not.toBeNull();

    const now = new Date(REFERENCE_TIMELINE_EVENTS.window.from);
    const withoutCm = projectMonthlyIncomeBreakdown(SNAPSHOT!.settings, yearTimeline(false), now);
    const withCm = projectMonthlyIncomeBreakdown(SNAPSHOT!.settings, yearTimeline(true), now);
    const componentSum =
      withCm.recurring.carats +
      withCm.championsMeeting.carats +
      withCm.leagueOfHeroes.carats +
      withCm.eventsAndCalendar.carats;

    expect(documentedChampionsMeetingEvents()).toHaveLength(13);
    expect(componentSum).toBeCloseTo(withCm.total.carats, 8);
    expect(withoutCm.championsMeeting.carats).toBe(0);
    expect(withCm.total.carats - withoutCm.total.carats).toBeCloseTo((1_600 * 13 * 30) / 365, 6);
    expect(withCm.total.carats).toBeGreaterThan(17_000);
    expect(withCm.total.carats).toBeLessThan(21_000);
  });

  it("keeps total income within 5% of the workbook's exact one-year reference window", () => {
    expect(SNAPSHOT).not.toBeNull();

    const from = new Date(REFERENCE_TIMELINE_EVENTS.window.from);
    const to = new Date(REFERENCE_TIMELINE_EVENTS.window.to);
    const timeline = yearTimeline(true);
    const modeled = projectIncome(SNAPSHOT!.settings, timeline, from, to).carats;
    const reference = REFERENCE_FIXTURE.summary.yearCarats;
    const deltaPercent = (modeled - reference) / reference;

    // The cached timeline contributes 43 dated handout events; the committed sheet's
    // cumulative CM ledger documents 13 Third-place rewards in this same window.
    expect((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)).toBe(
      REFERENCE_FIXTURE.summary.yearDays
    );
    expect(REFERENCE_TIMELINE_EVENTS.events).toHaveLength(43);
    expect(documentedChampionsMeetingEvents()).toHaveLength(13);
    expect(modeled).toBeCloseTo(236_001.7401, 4);
    expect(Math.abs(deltaPercent)).toBeLessThan(0.05);
  });
});
