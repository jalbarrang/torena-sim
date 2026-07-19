import { describe, expect, it, vi } from 'vitest';
import type { TimelinePayload } from '@/modules/carat/data/timeline-types';
import { type CaratSettings, defaultCaratSettings } from '@/store/carat.store';
import { caratsAvailableAt, monthlyRecurringCarats, projectIncome } from './income';
import {
  DAILY_CARAT_PACK_AVERAGE_MONTHLY_CARATS,
  DAILY_CARAT_PACK_FREE_CARATS_PER_DAY,
  DAYS_PER_MONTH
} from './income-tables';

const emptyTimeline: TimelinePayload = {
  anniversaries: [],
  calculation: {},
  events: [],
  version: 'test'
};

describe('income model', () => {
  it('calculates monthly recurring carats for a known settings combo', () => {
    const income = monthlyRecurringCarats(
      {
        ...defaultCaratSettings,
        // monthlyCarats/monthlyTickets are legacy fields and intentionally ignored.
        monthlyCarats: 15_000,
        monthlyTickets: 27,
        teamTrialsClass: 'class-4',
        clubRank: 'a',
        dailyCaratPack: false,
        trainingPass: 'paid'
      },
      new Date('2028-01-01T22:00:00.000Z')
    );

    // Daily-quest base + club A + paid pass + class-4 Team Trials + 150 carats per 50 login days.
    expect(income.carats).toBeCloseTo(7_778.1, 1);
    // baseline 4/type + paid pass 4/type = 8 per type.
    expect(income.umaTickets).toBe(8);
    expect(income.supportTickets).toBe(8);
  });

  it('adds about 91 monthly carats from the recurring 50-day login bonus', () => {
    const income = monthlyRecurringCarats(
      {
        ...defaultCaratSettings,
        teamTrialsClass: 'class-4',
        clubRank: 'a',
        dailyCaratPack: false,
        trainingPass: 'paid'
      },
      new Date('2028-01-01T22:00:00.000Z')
    );
    const withoutLoginBonus = (75 + 150 / 7) * (365.25 / 12) + 2_250 + 1_850 + 150 * 4.345;

    expect(income.carats - withoutLoginBonus).toBeCloseTo(91.31, 1);
  });

  it.each([
    ['pre-release free', '2027-08-11T22:00:00.000Z', 'free', 0, 0],
    ['pre-release paid', '2027-08-11T22:00:00.000Z', 'paid', 0, 0],
    ['intro free', '2027-08-12T22:00:00.000Z', 'free', 400, 2],
    ['intro paid', '2027-08-12T22:00:00.000Z', 'paid', 1_300, 4],
    ['mature free', '2027-12-17T22:00:00.000Z', 'free', 500, 2],
    ['mature paid', '2027-12-17T22:00:00.000Z', 'paid', 1_850, 4]
  ] as const)(
    'uses the %s Global training-pass tier',
    (_name, asOf, trainingPass, expectedCarats, expectedTickets) => {
      const settings: CaratSettings = {
        ...defaultCaratSettings,
        trainingPass
      };
      const withoutPass = monthlyRecurringCarats(
        { ...settings, trainingPass: 'none' },
        new Date(asOf)
      );
      const withPass = monthlyRecurringCarats(settings, new Date(asOf));

      expect(withPass.carats - withoutPass.carats).toBe(expectedCarats);
      expect(withPass.umaTickets - withoutPass.umaTickets).toBe(expectedTickets);
      expect(withPass.supportTickets - withoutPass.supportTickets).toBe(expectedTickets);
    }
  );

  it('retains mature training-pass income for JP before the Global release', () => {
    const asOf = new Date('2026-07-18T22:00:00.000Z');
    const settings: CaratSettings = {
      ...defaultCaratSettings,
      server: 'jp',
      trainingPass: 'paid'
    };
    const withoutPass = monthlyRecurringCarats({ ...settings, trainingPass: 'none' }, asOf);
    const withPass = monthlyRecurringCarats(settings, asOf);

    expect(withPass.carats - withoutPass.carats).toBeCloseTo(1_850);
    expect(withPass.umaTickets - withoutPass.umaTickets).toBe(4);
    expect(withPass.supportTickets - withoutPass.supportTickets).toBe(4);
  });

  it('integrates Global pass carats and tickets across intro and mature tiers', () => {
    const from = new Date('2027-08-01T22:00:00.000Z');
    const to = new Date('2028-01-01T22:00:00.000Z');
    const settings: CaratSettings = {
      ...defaultCaratSettings,
      trainingPass: 'paid'
    };
    const withoutPass = projectIncome(
      { ...settings, trainingPass: 'none' },
      emptyTimeline,
      from,
      to
    );
    const withPass = projectIncome(settings, emptyTimeline, from, to);
    const activeDays = 127 + 15;

    expect(withPass.carats - withoutPass.carats).toBeCloseTo(
      (1_300 * 127 + 1_850 * 15) / DAYS_PER_MONTH
    );
    expect(withPass.umaTickets - withoutPass.umaTickets).toBeCloseTo(
      (4 * activeDays) / DAYS_PER_MONTH
    );
    expect(withPass.supportTickets - withoutPass.supportTickets).toBeCloseTo(
      (4 * activeDays) / DAYS_PER_MONTH
    );
  });

  it('models the daily pack as 50 free carats per day, without its paid carats', () => {
    const asOf = new Date('2026-07-18T22:00:00.000Z');
    const withoutPack = monthlyRecurringCarats(
      {
        ...defaultCaratSettings,
        dailyCaratPack: false
      },
      asOf
    );
    const withPack = monthlyRecurringCarats(
      {
        ...defaultCaratSettings,
        dailyCaratPack: true
      },
      asOf
    );

    expect(DAILY_CARAT_PACK_FREE_CARATS_PER_DAY).toBe(50);
    expect(DAILY_CARAT_PACK_AVERAGE_MONTHLY_CARATS).toBe(50 * (365.25 / 12));
    expect(withPack.carats - withoutPack.carats).toBe(DAILY_CARAT_PACK_AVERAGE_MONTHLY_CARATS);
  });

  it('scales Platinum 4 LoH rewards to five expected events per year', () => {
    const withoutLoh: CaratSettings = {
      ...defaultCaratSettings,
      lohRank: 'none'
    };
    const withLoh: CaratSettings = {
      ...withoutLoh,
      lohRank: 'platinum-4'
    };
    const from = new Date('2027-07-18T22:00:00.000Z');
    const to = new Date('2028-07-19T22:00:00.000Z');
    const withoutIncome = projectIncome(withoutLoh, emptyTimeline, from, to);
    const withIncome = projectIncome(withLoh, emptyTimeline, from, to);
    const expectedEvents = ((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000) / 365.25) * 5;

    expect(withIncome.carats - withoutIncome.carats).toBeCloseTo(3_300 * expectedEvents);
    expect(withIncome.umaTickets - withoutIncome.umaTickets).toBeCloseTo(2 * expectedEvents);
    expect(withIncome.supportTickets - withoutIncome.supportTickets).toBeCloseTo(
      2 * expectedEvents
    );
  });

  it('accrues only recognized in-window event income and splits story tickets by pool', () => {
    const timeline: TimelinePayload = {
      ...emptyTimeline,
      events: [
        {
          id: 'story-in-window',
          card_type: null,
          type: 'story_event',
          global_release_date: '2026-02-15T22:00:00.000Z'
        },
        {
          id: 'campaign-in-window',
          card_type: null,
          type: 'campaign',
          global_release_date: '2026-02-16T22:00:00.000Z'
        },
        {
          id: 'legend-outside-window',
          card_type: null,
          type: 'legend_race',
          global_release_date: '2026-04-15T22:00:00.000Z'
        },
        {
          id: 'unknown-in-window',
          card_type: null,
          type: 'toString',
          global_release_date: '2026-02-17T22:00:00.000Z'
        }
      ]
    };

    const withEvents = projectIncome(
      defaultCaratSettings,
      timeline,
      new Date('2026-02-01T22:00:00.000Z'),
      new Date('2026-03-01T22:00:00.000Z')
    );
    const withoutEvents = projectIncome(
      defaultCaratSettings,
      emptyTimeline,
      new Date('2026-02-01T22:00:00.000Z'),
      new Date('2026-03-01T22:00:00.000Z')
    );

    expect(withEvents.carats - withoutEvents.carats).toBeCloseTo(5_660);
    expect(withEvents.umaTickets - withoutEvents.umaTickets).toBeCloseTo(2);
    expect(withEvents.supportTickets - withoutEvents.supportTickets).toBeCloseTo(2);
  });

  it('adds Valentine and White Day calendar login one-offs only in their dates', () => {
    const settings: CaratSettings = {
      ...defaultCaratSettings,
      teamTrialsClass: 'class-1',
      clubRank: 'none',
      cmPlacement: 'none',
      lohRank: 'none',
      dailyCaratPack: false,
      trainingPass: 'none'
    };
    const from = new Date('2026-02-13T22:00:00.000Z');
    const to = new Date('2026-03-15T22:00:00.000Z');
    const income = projectIncome(settings, emptyTimeline, from, to);
    const recurringCarats = monthlyRecurringCarats(settings, from).carats * (30 / (365.25 / 12));

    expect(income.carats - recurringCarats).toBeCloseTo(1_000);
  });

  it.each([
    ['Valentine', '2026-02-14T22:00:00.000Z'],
    ['White Day', '2026-03-14T22:00:00.000Z']
  ])('does not double-count %s or events across adjacent windows', (_name, boundaryDate) => {
    const timeline: TimelinePayload = {
      ...emptyTimeline,
      events: [
        {
          id: `cm-${boundaryDate}`,
          card_type: null,
          type: 'champions_meeting',
          global_release_date: boundaryDate
        },
        {
          id: `story-${boundaryDate}`,
          card_type: null,
          type: 'story_event',
          global_release_date: boundaryDate
        }
      ]
    };
    const settings: CaratSettings = {
      ...defaultCaratSettings,
      teamTrialsClass: 'class-1',
      clubRank: 'none',
      cmPlacement: 'champion',
      lohRank: 'none',
      dailyCaratPack: false,
      trainingPass: 'none'
    };
    const boundary = new Date(boundaryDate);
    const from = new Date(boundary);
    from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(boundary);
    to.setUTCDate(to.getUTCDate() + 1);
    const first = projectIncome(settings, timeline, from, boundary);
    const second = projectIncome(settings, timeline, boundary, to);
    const whole = projectIncome(settings, timeline, from, to);
    const withoutDiscreteIncome = projectIncome(settings, emptyTimeline, from, to);
    const recurringCarats = monthlyRecurringCarats(settings, from).carats * (2 / (365.25 / 12));

    expect(first.carats + second.carats).toBeCloseTo(whole.carats, 8);
    expect(first.umaTickets + second.umaTickets).toBeCloseTo(whole.umaTickets, 8);
    expect(first.supportTickets + second.supportTickets).toBeCloseTo(whole.supportTickets, 8);
    expect(whole.carats - withoutDiscreteIncome.carats).toBeCloseTo(5_460);
    expect(withoutDiscreteIncome.carats - recurringCarats).toBeCloseTo(500);
    expect(whole.umaTickets - withoutDiscreteIncome.umaTickets).toBeCloseTo(7);
    expect(whole.supportTickets - withoutDiscreteIncome.supportTickets).toBeCloseTo(7);
  });

  it('does not add Global Valentine or White Day one-offs to JP projections', () => {
    const settings: CaratSettings = {
      ...defaultCaratSettings,
      server: 'jp',
      teamTrialsClass: 'class-1',
      clubRank: 'none',
      cmPlacement: 'none',
      lohRank: 'none',
      dailyCaratPack: false,
      trainingPass: 'none'
    };
    const from = new Date('2026-02-13T22:00:00.000Z');
    const to = new Date('2026-03-15T22:00:00.000Z');
    const income = projectIncome(settings, emptyTimeline, from, to);
    const recurringCarats = monthlyRecurringCarats(settings, from).carats * (30 / (365.25 / 12));

    expect(income.carats - recurringCarats).toBeCloseTo(0);
  });

  it('adds Champion Meeting rewards for CM events inside the window only', () => {
    const timeline: TimelinePayload = {
      ...emptyTimeline,
      events: [
        {
          id: 'cm-in-window',
          card_type: null,
          type: 'champions_meeting',
          global_release_date: '2026-02-15T22:00:00.000Z'
        },
        {
          id: 'cm-outside-window',
          card_type: null,
          type: 'champions_meeting',
          global_release_date: '2026-04-15T22:00:00.000Z'
        }
      ]
    };
    const settings: CaratSettings = {
      ...defaultCaratSettings,
      monthlyCarats: 0,
      monthlyTickets: 0,
      teamTrialsClass: 'class-1',
      clubRank: 'd+',
      dailyCaratPack: false,
      trainingPass: 'free',
      lohRank: 'silver-4',
      cmPlacement: 'champion'
    };

    const withEvent = projectIncome(
      settings,
      timeline,
      new Date('2026-02-01T23:00:00.000Z'),
      new Date('2026-03-01T23:00:00.000Z')
    );
    const withoutEvent = projectIncome(
      settings,
      emptyTimeline,
      new Date('2026-02-01T23:00:00.000Z'),
      new Date('2026-03-01T23:00:00.000Z')
    );

    expect(withEvent.carats - withoutEvent.carats).toBeCloseTo(3300);
    // CM champion 10 tickets split evenly -> 5 per pool.
    expect(withEvent.umaTickets - withoutEvent.umaTickets).toBeCloseTo(5);
    expect(withEvent.supportTickets - withoutEvent.supportTickets).toBeCloseTo(5);
  });

  it('keeps caratsAvailableAt monotonic as dates move forward', () => {
    vi.setSystemTime(new Date('2026-01-01T23:00:00.000Z'));

    const earlier = caratsAvailableAt(
      defaultCaratSettings,
      emptyTimeline,
      new Date('2026-02-01T23:00:00.000Z')
    );
    const later = caratsAvailableAt(
      defaultCaratSettings,
      emptyTimeline,
      new Date('2026-03-01T23:00:00.000Z')
    );

    expect(later).toBeGreaterThan(earlier);

    vi.useRealTimers();
  });
});
