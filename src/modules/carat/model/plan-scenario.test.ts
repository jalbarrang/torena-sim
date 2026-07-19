import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineEvent, TimelinePayload } from '@/modules/carat/data/timeline-types';
import { monthlyRecurringCarats } from '@/modules/carat/model/income';
import { computePlan } from '@/modules/carat/model/plan';
import { defaultCaratSettings, type CaratSettings, type PlannedBanner } from '@/store/carat.store';

// Real-world plan captured from the app ("Plan 2"). This pins the end-to-end
// evaluation so income, ticket accrual, cost and balance stay correct.
//
// Reference instant is pinned: ticket/carat accrual normalises every date to
// the 22:00 UTC daily reset, so any "now" that falls on 2026-06-29's reset
// produces these exact numbers.
const NOW = '2026-06-29T22:00:00.000Z';

const PLAN_SETTINGS: CaratSettings = {
  ...defaultCaratSettings,
  server: 'global',
  startingFreeCarats: 26_295,
  startingPaidCarats: 1_388,
  umaTickets: 7,
  supportTickets: 26,
  monthlyCarats: 15_000, // legacy field, ignored by the model
  monthlyTickets: 27, // legacy field, ignored by the model
  teamTrialsClass: 'class-6',
  clubRank: 'b',
  cmPlacement: 'none',
  lohRank: 'none',
  dailyCaratPack: true,
  trainingPass: 'free',
  trackPaidCarats: false
};

const PLANNED_BANNERS: PlannedBanner[] = [
  {
    id: 'example-banner',
    plannedPulls: 200,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 0
  },
  {
    id: 'support-banner-2022_30111',
    plannedPulls: 400,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 1
  },
  {
    id: 'support-banner-2022_30117',
    plannedPulls: 100,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 2
  },
  {
    id: 'support-banner-2022_30127',
    plannedPulls: 200,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 3
  },
  {
    id: 'banner-2022_30126',
    plannedPulls: 200,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 4
  },
  {
    id: 'banner-2022_30134',
    plannedPulls: 200,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 5
  },
  {
    id: 'banner-2023_30158',
    plannedPulls: 200,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 6
  },
  {
    id: 'banner-2023_30160',
    plannedPulls: 200,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 7
  }
];

function banner(
  id: string,
  globalReleaseDate: string,
  cardType: 'character' | 'support'
): TimelineEvent {
  return {
    id,
    type: cardType === 'character' ? 'character_banner' : 'support_card_banner',
    card_type: cardType,
    global_release_date: globalReleaseDate
  };
}

// Real release dates for the planned banners. "example-banner" is intentionally
// absent — the model must drop planned banners with no matching timeline event.
const TIMELINE: TimelinePayload = {
  anniversaries: [],
  calculation: {},
  version: 'test',
  events: [
    banner('support-banner-2022_30111', '2026-07-22T22:00:00Z', 'support'),
    banner('support-banner-2022_30117', '2026-08-11T22:00:00Z', 'support'),
    banner('support-banner-2022_30127', '2026-09-18T22:00:00Z', 'support'),
    banner('banner-2022_30126', '2026-09-18T22:00:00Z', 'character'),
    banner('banner-2022_30134', '2026-10-13T22:00:00Z', 'character'),
    banner('banner-2023_30158', '2027-01-12T22:00:00Z', 'character'),
    banner('banner-2023_30160', '2027-01-19T22:00:00Z', 'character')
  ]
};

type ExpectedRow = {
  id: string;
  ticketType: 'uma' | 'support';
  ticketsAvailable: number;
  ticketsUsed: number;
  ticketsSaved: number;
  ticketsRemaining: number;
  cost: number;
  affordable: boolean;
  balanceAfter: number; // rounded to the nearest carat
};

// Sorted by banner date. Income before the Global pass release is 7,528/mo carats + 4 uma + 4 support tickets/mo (no CM/LoH since both are "none"). Uma and support pools accrue and deplete
// independently; every banner plans enough pulls to drain its pool, so
// ticketsUsed == ticketsAvailable and ticketsRemaining == 0 on each row.
const EXPECTED: ExpectedRow[] = [
  {
    id: 'support-banner-2022_30111',
    ticketType: 'support',
    ticketsAvailable: 29,
    ticketsUsed: 29,
    ticketsSaved: 4_350,
    ticketsRemaining: 0,
    cost: 55_650,
    affordable: false,
    balanceAfter: -23_667
  },
  {
    id: 'support-banner-2022_30117',
    ticketType: 'support',
    ticketsAvailable: 2,
    ticketsUsed: 2,
    ticketsSaved: 300,
    ticketsRemaining: 0,
    cost: 14_700,
    affordable: false,
    balanceAfter: -33_421
  },
  {
    id: 'support-banner-2022_30127',
    ticketType: 'support',
    ticketsAvailable: 5,
    ticketsUsed: 5,
    ticketsSaved: 750,
    ticketsRemaining: 0,
    cost: 29_250,
    affordable: false,
    balanceAfter: -53_273
  },
  {
    id: 'banner-2022_30126',
    ticketType: 'uma',
    ticketsAvailable: 17,
    ticketsUsed: 17,
    ticketsSaved: 2_550,
    ticketsRemaining: 0,
    cost: 27_450,
    affordable: false,
    balanceAfter: -80_723
  },
  {
    id: 'banner-2022_30134',
    ticketType: 'uma',
    ticketsAvailable: 3,
    ticketsUsed: 3,
    ticketsSaved: 450,
    ticketsRemaining: 0,
    cost: 29_550,
    affordable: false,
    balanceAfter: -104_090
  },
  {
    id: 'banner-2023_30158',
    ticketType: 'uma',
    ticketsAvailable: 12,
    ticketsUsed: 12,
    ticketsSaved: 1_800,
    ticketsRemaining: 0,
    cost: 28_200,
    affordable: false,
    balanceAfter: -109_784
  },
  {
    id: 'banner-2023_30160',
    ticketType: 'uma',
    ticketsAvailable: 1,
    ticketsUsed: 1,
    ticketsSaved: 150,
    ticketsRemaining: 0,
    cost: 29_850,
    affordable: false,
    balanceAfter: -137_903
  }
];

describe('carat plan scenario — Plan 2', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives monthly recurring income from the tables only', () => {
    const monthly = monthlyRecurringCarats(PLAN_SETTINGS, new Date(NOW));
    // The Global pass is not released yet: daily quest + club B + daily pack + class-6 Team Trials + 150 carats per 50 login days.
    expect(monthly.carats).toBeCloseTo(7_527.61, 2);
    expect(monthly.umaTickets).toBe(4);
    expect(monthly.supportTickets).toBe(4);
  });

  it('drops planned banners with no matching timeline event', () => {
    const rows = computePlan(PLAN_SETTINGS, TIMELINE, PLANNED_BANNERS);
    expect(rows).toHaveLength(7);
    expect(rows.some((row) => row.event.id === 'example-banner')).toBe(false);
  });

  it('orders rows by banner date', () => {
    const rows = computePlan(PLAN_SETTINGS, TIMELINE, PLANNED_BANNERS);
    expect(rows.map((row) => row.event.id)).toEqual(EXPECTED.map((row) => row.id));
  });

  it('evaluates tickets, cost, and balance per banner', () => {
    const rows = computePlan(PLAN_SETTINGS, TIMELINE, PLANNED_BANNERS);

    for (const [index, row] of rows.entries()) {
      const expected = EXPECTED[index];
      expect(row.event.id, `row ${index} id`).toBe(expected.id);
      expect(row.ticketType, `${expected.id} ticketType`).toBe(expected.ticketType);
      expect(row.ticketsAvailable, `${expected.id} ticketsAvailable`).toBe(
        expected.ticketsAvailable
      );
      expect(row.ticketsUsed, `${expected.id} ticketsUsed`).toBe(expected.ticketsUsed);
      expect(row.ticketsSaved, `${expected.id} ticketsSaved`).toBe(expected.ticketsSaved);
      expect(row.ticketsRemaining, `${expected.id} ticketsRemaining`).toBe(
        expected.ticketsRemaining
      );
      expect(row.cost, `${expected.id} cost`).toBe(expected.cost);
      expect(row.affordable, `${expected.id} affordable`).toBe(expected.affordable);
      expect(Math.round(row.balanceAfter), `${expected.id} balanceAfter`).toBe(
        expected.balanceAfter
      );
    }
  });

  it('keeps the support ticket pool independent from the uma pool', () => {
    const rows = computePlan(PLAN_SETTINGS, TIMELINE, PLANNED_BANNERS);
    // Support banners drain only the support pool (29 + 2 + 5 = 36 = 26 start + accrual); the first uma banner still has its full uma pool (17) available because no earlier banner touched it.
    const supportUsed = rows
      .filter((row) => row.ticketType === 'support')
      .reduce((total, row) => total + row.ticketsUsed, 0);
    const firstUma = rows.find((row) => row.event.id === 'banner-2022_30126');
    expect(supportUsed).toBe(36);
    expect(firstUma?.ticketType).toBe('uma');
    expect(firstUma?.ticketsAvailable).toBe(17);
  });
});
