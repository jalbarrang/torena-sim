import { describe, expect, it } from 'vitest';
import type { TimelinePayload } from '@/modules/carat/data/timeline-types';
import { type CaratSettings, defaultCaratSettings } from '@/store/carat.store';
import {
  ALL_IN_NORMALIZED_DAYS,
  ALL_IN_PROJECTION_DAYS,
  monthlyRecurringCarats,
  projectIncome,
  projectMonthlyIncomeBreakdown
} from './income';
import { DAYS_PER_MONTH } from './income-tables';

const emptyTimeline: TimelinePayload = {
  anniversaries: [],
  calculation: {},
  events: [],
  version: 'test'
};

describe('projectMonthlyIncomeBreakdown', () => {
  it('normalizes the all-in monthly breakdown to 30 days of a 365-day projection', () => {
    const settings: CaratSettings = {
      ...defaultCaratSettings,
      cmPlacement: 'none',
      lohRank: 'none'
    };
    const now = new Date('2026-07-18T22:00:00.000Z');
    const breakdown = projectMonthlyIncomeBreakdown(settings, emptyTimeline, now);
    const projected = projectIncome(
      settings,
      emptyTimeline,
      now,
      new Date(now.getTime() + ALL_IN_PROJECTION_DAYS * 24 * 60 * 60 * 1000)
    );

    expect(breakdown.total.carats).toBeCloseTo(
      (projected.carats * ALL_IN_NORMALIZED_DAYS) / ALL_IN_PROJECTION_DAYS,
      8
    );
    expect(breakdown.recurring.carats).toBeCloseTo(
      monthlyRecurringCarats(settings, now).carats * (ALL_IN_NORMALIZED_DAYS / DAYS_PER_MONTH),
      8
    );
    expect(breakdown.championsMeeting.carats).toBe(0);
    expect(breakdown.leagueOfHeroes.carats).toBe(0);
    // Valentine + White Day are the only non-recurring income on an empty Global timeline.
    expect(breakdown.eventsAndCalendar.carats).toBeCloseTo(
      (1_000 * ALL_IN_NORMALIZED_DAYS) / ALL_IN_PROJECTION_DAYS,
      8
    );
  });

  it('attributes breakdown buckets by counterfactual deltas without double counting', () => {
    const settings: CaratSettings = {
      ...defaultCaratSettings,
      cmPlacement: 'champion',
      lohRank: 'platinum-4',
      trainingPass: 'paid'
    };
    const now = new Date('2027-08-01T22:00:00.000Z');
    const timeline: TimelinePayload = {
      ...emptyTimeline,
      events: [
        {
          id: 'cm-in-window',
          card_type: null,
          type: 'champions_meeting',
          global_release_date: '2027-09-15T22:00:00.000Z'
        },
        {
          id: 'story-in-window',
          card_type: null,
          type: 'story_event',
          global_release_date: '2027-10-15T22:00:00.000Z'
        }
      ]
    };
    const breakdown = projectMonthlyIncomeBreakdown(settings, timeline, now);
    const scale = ALL_IN_NORMALIZED_DAYS / ALL_IN_PROJECTION_DAYS;
    const componentSum =
      breakdown.recurring.carats +
      breakdown.championsMeeting.carats +
      breakdown.leagueOfHeroes.carats +
      breakdown.eventsAndCalendar.carats;

    expect(componentSum).toBeCloseTo(breakdown.total.carats, 8);
    expect(breakdown.championsMeeting.carats).toBeCloseTo(3_300 * scale, 8);
    expect(breakdown.championsMeeting.umaTickets).toBeCloseTo(5 * scale, 8);
    expect(breakdown.leagueOfHeroes.carats).toBeCloseTo(
      3_300 * (5 / 12) * (ALL_IN_PROJECTION_DAYS / DAYS_PER_MONTH) * scale,
      8
    );
    // Story event + Valentine + White Day; pass tier changes stay in recurring.
    expect(breakdown.eventsAndCalendar.carats).toBeCloseTo((2_160 + 1_000) * scale, 8);
    expect(breakdown.eventsAndCalendar.umaTickets).toBeCloseTo(2 * scale, 8);
  });
});
