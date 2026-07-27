import { describe, expect, it } from 'vitest';
import type { TimelineEvent, TimelinePayload } from '@/modules/carat/data/timeline-types';
import { projectIncome } from '@/modules/carat/model/income';
import { CARAT_PER_PULL } from '@/modules/carat/model/income-tables';
import { computePlan } from '@/modules/carat/model/plan';
import type { CaratSettings, PlannedBanner } from '@/store/carat.store';

function daysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(23, 0, 0, 0);
  return date.toISOString();
}

function banner(
  id: string,
  days: number,
  cardType: 'character' | 'support' | null = 'character'
): TimelineEvent {
  return {
    id,
    type: 'banner',
    card_type: cardType,
    global_release_date: daysFromNow(days),
    estimated_end_date: daysFromNow(days + 10),
    prediction: { kind: 'confirmed' }
  };
}

function datedBanner(
  id: string,
  globalReleaseDate: string,
  estimatedEndDate?: string,
  cardType: 'character' | 'support' | null = 'character'
): TimelineEvent {
  return {
    id,
    type: 'banner',
    card_type: cardType,
    global_release_date: globalReleaseDate,
    ...(estimatedEndDate ? { estimated_end_date: estimatedEndDate } : {}),
    prediction: { kind: 'confirmed' }
  };
}

const settings: CaratSettings = {
  server: 'global',
  startingFreeCarats: 0,
  startingPaidCarats: 0,
  umaTickets: 0,
  supportTickets: 0,
  monthlyCarats: 30000,
  monthlyTickets: 0,
  teamTrialsClass: 'none',
  clubRank: 'none',
  cmPlacement: 'none',
  lohRank: 'none',
  dailyCaratPack: false,
  trainingPass: 'free',
  trackPaidCarats: false
};

function timeline(events: TimelineEvent[]): TimelinePayload {
  return { events, anniversaries: [], calculation: {}, version: 'test' };
}

describe('computePlan', () => {
  it('sorts by banner date, calculates pull cost, and chains running balance', () => {
    const early = banner('early', 1);
    const late = banner('late', 40);
    const plan: PlannedBanner[] = [
      { id: 'late', plannedPulls: 0, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 },
      { id: 'early', plannedPulls: 100, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 1 }
    ];

    // Monthly income is table-driven; pick tables that accrue enough between the
    // two banners for the running balance to recover from the early spend.
    const incomeSettings: CaratSettings = {
      ...settings,
      teamTrialsClass: 'class-6',
      clubRank: 'ss',
      lohRank: 'platinum-4',
      dailyCaratPack: true,
      trainingPass: 'paid'
    };

    const rows = computePlan(incomeSettings, timeline([late, early]), plan);

    expect(rows.map((row) => row.event.id)).toEqual(['early', 'late']);
    expect(rows[0].cost).toBe(15000);
    expect(rows[0].balanceAfter).toBeLessThan(0);
    expect(rows[0].affordable).toBe(false);
    expect(rows[1].cost).toBe(0);
    expect(rows[1].balanceAfter).toBeGreaterThan(0);
    expect(rows[1].affordable).toBe(true);
  });

  it('ignores planned banners that are not present in the timeline', () => {
    // Banner at day 1 so recurring ticket accrual floors to 0 and the single
    // pull is paid in carats (this test is about ignoring missing banners).
    const rows = computePlan(settings, timeline([banner('real', 1)]), [
      {
        id: 'example-banner',
        plannedPulls: 200,
        startingDupes: 0,
        copyGoals: {},
        ownedCopies: {},
        order: 0
      },
      { id: 'real', plannedPulls: 1, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 1 }
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].event.id).toBe('real');
    expect(rows[0].cost).toBe(150);
  });

  it('tracks a paid pool and spends paid carats first when enabled', () => {
    const rows = computePlan(
      { ...settings, trackPaidCarats: true, startingPaidCarats: 1500 },
      timeline([banner('paid', 1)]),
      [
        { id: 'paid', plannedPulls: 20, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 }
      ],
      { '1st-anniversary': { p1500: 1 } }
    );

    expect(rows[0].cost).toBe(3000);
    expect(rows[0].paidCaratsAvailable).toBe(3000);
    expect(rows[0].paidCost).toBe(3000);
    expect(rows[0].freeCost).toBe(0);
    expect(rows[0].paidBalanceAfter).toBe(0);
    expect(rows[0].freeBalanceAfter).toBeGreaterThanOrEqual(0);
    expect(rows[0].affordable).toBe(true);
  });

  it('auto-fills uma tickets for the earliest character banner and reduces cost', () => {
    const rows = computePlan({ ...settings, umaTickets: 3 }, timeline([banner('uma', 1)]), [
      { id: 'uma', plannedPulls: 10, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 }
    ]);

    expect(rows[0].ticketType).toBe('uma');
    expect(rows[0].ticketsAvailable).toBe(3);
    expect(rows[0].ticketsUsed).toBe(3);
    expect(rows[0].ticketsSaved).toBe(3 * CARAT_PER_PULL);
    expect(rows[0].ticketsRemaining).toBe(0);
    expect(rows[0].cost).toBe(7 * CARAT_PER_PULL);
  });

  it('routes support banners to support tickets without consuming uma tickets', () => {
    const rows = computePlan(
      { ...settings, umaTickets: 10, supportTickets: 2 },
      timeline([banner('support', 1, 'support')]),
      [
        {
          id: 'support',
          plannedPulls: 5,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          order: 0
        }
      ]
    );

    expect(rows[0].ticketType).toBe('support');
    expect(rows[0].ticketsAvailable).toBe(2);
    expect(rows[0].ticketsUsed).toBe(2);
    expect(rows[0].cost).toBe(3 * CARAT_PER_PULL);
  });

  it('depletes typed ticket pools across matching banners by date', () => {
    const first = banner('first', 1);
    const second = banner('second', 2);
    const rows = computePlan({ ...settings, umaTickets: 5 }, timeline([second, first]), [
      { id: 'second', plannedPulls: 3, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 },
      { id: 'first', plannedPulls: 3, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 1 }
    ]);

    expect(rows.map((row) => row.event.id)).toEqual(['first', 'second']);
    expect(rows[0].ticketsAvailable).toBe(5);
    expect(rows[0].ticketsUsed).toBe(3);
    expect(rows[0].ticketsRemaining).toBe(2);
    expect(rows[1].ticketsAvailable).toBe(2);
    expect(rows[1].ticketsUsed).toBe(2);
    expect(rows[1].ticketsRemaining).toBe(0);
  });

  it('honors explicit ticket allocation and leaves unused tickets for later banners', () => {
    const rows = computePlan(
      { ...settings, umaTickets: 5 },
      timeline([banner('manual', 1), banner('auto', 2)]),
      [
        {
          id: 'manual',
          plannedPulls: 3,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          ticketsUsed: 1,
          order: 0
        },
        { id: 'auto', plannedPulls: 10, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 1 }
      ]
    );

    expect(rows[0].ticketsUsed).toBe(1);
    expect(rows[0].ticketsRemaining).toBe(4);
    expect(rows[1].ticketsAvailable).toBe(4);
    expect(rows[1].ticketsUsed).toBe(4);
    expect(rows[1].cost).toBe(6 * CARAT_PER_PULL);
  });

  it('clamps explicit ticket allocation to planned pulls and available pool', () => {
    const rows = computePlan(
      { ...settings, supportTickets: 20 },
      timeline([banner('support', 1, 'support')]),
      [
        {
          id: 'support',
          plannedPulls: 10,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          ticketsUsed: 99,
          order: 0
        }
      ]
    );

    expect(rows[0].ticketsUsed).toBe(10);
    expect(rows[0].ticketsSaved).toBe(10 * CARAT_PER_PULL);
    expect(rows[0].cost).toBe(0);
    expect(rows[0].ticketsRemaining).toBe(10);
  });

  it('treats negative starting ticket settings as zero', () => {
    const rows = computePlan(
      { ...settings, umaTickets: -5, supportTickets: -3 },
      timeline([banner('uma', 1)]),
      [{ id: 'uma', plannedPulls: 10, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 }]
    );

    expect(rows[0].ticketsAvailable).toBe(0);
    expect(rows[0].ticketsUsed).toBe(0);
    expect(rows[0].cost).toBe(10 * CARAT_PER_PULL);
  });

  it('does not let one ticket type pay for the other banner type', () => {
    // Only uma tickets, but the planned banner is a support banner.
    const rows = computePlan(
      { ...settings, umaTickets: 20, supportTickets: 0 },
      timeline([banner('support', 1, 'support')]),
      [
        {
          id: 'support',
          plannedPulls: 8,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          order: 0
        }
      ]
    );

    expect(rows[0].ticketType).toBe('support');
    expect(rows[0].ticketsAvailable).toBe(0);
    expect(rows[0].ticketsUsed).toBe(0);
    expect(rows[0].cost).toBe(8 * CARAT_PER_PULL);
  });

  it('lets an explicit 0 save tickets for a later banner of the same type', () => {
    const rows = computePlan(
      { ...settings, umaTickets: 4 },
      timeline([banner('first', 1), banner('second', 2)]),
      [
        {
          id: 'first',
          plannedPulls: 10,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          ticketsUsed: 0,
          order: 0
        },
        {
          id: 'second',
          plannedPulls: 10,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          order: 1
        }
      ]
    );

    expect(rows[0].ticketsUsed).toBe(0);
    expect(rows[0].ticketsRemaining).toBe(4);
    expect(rows[1].ticketsAvailable).toBe(4);
    expect(rows[1].ticketsUsed).toBe(4);
  });

  it('floors fractional planned pulls consistently for cost and allocation', () => {
    const rows = computePlan({ ...settings, umaTickets: 2 }, timeline([banner('uma', 1)]), [
      {
        id: 'uma',
        plannedPulls: 10.9,
        startingDupes: 0,
        copyGoals: {},
        ownedCopies: {},
        order: 0
      }
    ]);

    // 10 pulls after flooring, 2 covered by tickets -> 8 carat-pulls.
    expect(rows[0].ticketsUsed).toBe(2);
    expect(rows[0].cost).toBe(8 * CARAT_PER_PULL);
  });

  it('settles past banners chronologically without projecting historical income', () => {
    const now = new Date('2026-06-15T22:00:00.000Z');
    const first = datedBanner('first', '2020-01-01T22:00:00.000Z', '2020-01-10T22:00:00.000Z');
    const second = datedBanner('second', '2025-01-01T22:00:00.000Z', '2025-01-10T22:00:00.000Z');
    const rows = computePlan(
      { ...settings, startingFreeCarats: 1000, umaTickets: 3 },
      timeline([second, first]),
      [
        {
          id: 'second',
          plannedPulls: 0,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          pullResult: { pulls: 4, ticketsUsed: 3, pickupCopies: {} },
          order: 0
        },
        {
          id: 'first',
          plannedPulls: 0,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          pullResult: { pulls: 2, ticketsUsed: 0, pickupCopies: {} },
          order: 1
        }
      ],
      {},
      { now }
    );

    expect(rows.map((row) => row.event.id)).toEqual(['first', 'second']);
    expect(rows.map((row) => row.caratsAvailable)).toEqual([1000, 700]);
    expect(rows.map((row) => row.balanceAfter)).toEqual([700, 550]);
  });

  it('keeps an explicit recorded ticket deficit out of the carat cost', () => {
    const now = new Date('2026-06-15T22:00:00.000Z');
    const recorded = datedBanner(
      'recorded',
      '2026-06-01T22:00:00.000Z',
      '2026-06-10T22:00:00.000Z'
    );
    const rows = computePlan(
      { ...settings, umaTickets: 1 },
      timeline([recorded]),
      [
        {
          id: 'recorded',
          plannedPulls: 0,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          pullResult: { pulls: 10, ticketsUsed: 5, pickupCopies: {} },
          order: 0
        }
      ],
      {},
      { now }
    );

    expect(rows[0]).toMatchObject({
      status: 'recorded',
      effectivePulls: 10,
      ticketsAvailable: 1,
      ticketsUsed: 5,
      ticketDeficit: 4,
      cost: 5 * CARAT_PER_PULL
    });
  });

  it('marks an unresolved past banner as provisional', () => {
    const now = new Date('2026-06-15T22:00:00.000Z');
    const past = datedBanner('past', '2026-06-01T22:00:00.000Z', '2026-06-10T22:00:00.000Z');
    const rows = computePlan(
      { ...settings, umaTickets: 1 },
      timeline([past]),
      [{ id: 'past', plannedPulls: 3, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 }],
      {},
      { now }
    );

    expect(rows[0]).toMatchObject({
      status: 'provisional',
      effectivePulls: 3,
      ticketsUsed: 1,
      cost: 2 * CARAT_PER_PULL
    });
  });

  it('spends on live banners at now and earns only from now through future banners', () => {
    const now = new Date('2026-06-15T22:00:00.000Z');
    const live = datedBanner('live', '2020-01-01T22:00:00.000Z');
    const future = datedBanner('future', '2026-07-15T22:00:00.000Z', '2026-07-25T22:00:00.000Z');
    const rows = computePlan(
      { ...settings, startingFreeCarats: 1000 },
      timeline([live, future]),
      [
        { id: 'live', plannedPulls: 2, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 },
        {
          id: 'future',
          plannedPulls: 0,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          order: 1
        }
      ],
      {},
      { now }
    );
    const futureStart = new Date(future.global_release_date!);

    expect(rows[0]).toMatchObject({ status: 'live', caratsAvailable: 1000, balanceAfter: 700 });
    expect(rows[1].status).toBe('future');
    expect(rows[1].caratsAvailable).toBeCloseTo(
      rows[0].balanceAfter +
        projectIncome(settings, timeline([live, future]), now, futureStart).carats
    );
  });

  it('never exposes a negative ticket availability on future rows', () => {
    const now = new Date('2026-06-15T22:00:00.000Z');
    const recorded = datedBanner(
      'recorded',
      '2026-06-01T22:00:00.000Z',
      '2026-06-10T22:00:00.000Z'
    );
    const future = datedBanner('future', '2026-06-16T22:00:00.000Z', '2026-06-26T22:00:00.000Z');
    const rows = computePlan(
      { ...settings, umaTickets: 1 },
      timeline([recorded, future]),
      [
        {
          id: 'recorded',
          plannedPulls: 0,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          pullResult: { pulls: 10, ticketsUsed: 5, pickupCopies: {} },
          order: 0
        },
        {
          id: 'future',
          plannedPulls: 2,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          order: 1
        }
      ],
      {},
      { now }
    );

    expect(rows[1]).toMatchObject({ status: 'future', ticketsAvailable: 0, ticketsRemaining: 0 });
    expect(rows[1].ticketsAvailable).toBeGreaterThanOrEqual(0);
  });
});
