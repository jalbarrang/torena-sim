import { describe, expect, it } from 'vitest';
import {
  bannerEndTime,
  bannerLifecycle,
  bannerStartTime
} from '@/modules/carat/data/banner-lifecycle';
import type { TimelineEvent } from '@/modules/carat/data/timeline-types';

function banner(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'banner',
    card_type: 'character',
    type: 'character_banner',
    global_release_date: '2026-03-01T00:00:00.000Z',
    ...overrides
  };
}

describe('banner end time', () => {
  it('prefers a valid estimated end date over start plus duration', () => {
    const event = banner({
      estimated_end_date: '2026-03-04T12:00:00.000Z',
      banner_duration_days: 10
    });

    expect(bannerEndTime(event)).toBe(Date.parse('2026-03-04T12:00:00.000Z'));
  });

  it('falls back from an invalid estimate to a valid start plus a positive duration', () => {
    const event = banner({
      estimated_end_date: 'not a date',
      banner_duration_days: 2
    });

    expect(bannerEndTime(event)).toBe(Date.parse('2026-03-03T00:00:00.000Z'));
  });

  it('falls back when an estimated end has an impossible ISO calendar date', () => {
    const event = banner({
      estimated_end_date: '2026-02-30T00:00:00.000Z',
      banner_duration_days: 2
    });

    expect(bannerEndTime(event)).toBe(Date.parse('2026-03-03T00:00:00.000Z'));
  });

  it.each(['2026-02-30Z', '2026-02-30 00:00:00.000Z'])(
    'rejects an impossible calendar date with a non-T separator: %s',
    (globalReleaseDate) => {
      expect(bannerStartTime(banner({ global_release_date: globalReleaseDate }))).toBeUndefined();
    }
  );

  it('uses the valid JP start when the preferred global start has an impossible ISO calendar date', () => {
    const event = banner({
      global_release_date: '2026-02-30T00:00:00.000Z',
      jp_release_date: '2026-03-02T00:00:00.000Z',
      banner_duration_days: 3
    });

    expect(bannerStartTime(event)).toBe(Date.parse('2026-03-02T00:00:00.000Z'));
    expect(bannerEndTime(event)).toBe(Date.parse('2026-03-05T00:00:00.000Z'));
  });

  it('returns unknown when it cannot resolve an end time', () => {
    expect(bannerEndTime(banner({ banner_duration_days: 0 }))).toBeUndefined();
    expect(bannerEndTime(banner({ banner_duration_days: -1 }))).toBeUndefined();
    expect(
      bannerEndTime(
        banner({
          global_release_date: '2026-02-30T00:00:00.000Z',
          banner_duration_days: 7
        })
      )
    ).toBeUndefined();
  });
});

describe('banner lifecycle', () => {
  it('is past at the exact resolved end instant', () => {
    const event = banner({ banner_duration_days: 2 });
    const now = new Date('2026-03-03T00:00:00.000Z');

    expect(bannerLifecycle(event, now)).toBe('past');
  });

  it('keeps started banners with unknown ends live instead of forcing them past', () => {
    const event = banner({ estimated_end_date: 'not a date', banner_duration_days: null });
    const now = new Date('2030-01-01T00:00:00.000Z');

    expect(bannerLifecycle(event, now)).toBe('live');
  });

  it('distinguishes live, future, and fully unknown banners with an explicit clock', () => {
    const now = new Date('2026-03-02T00:00:00.000Z');

    expect(bannerLifecycle(banner({ banner_duration_days: 3 }), now)).toBe('live');
    expect(bannerLifecycle(banner({ global_release_date: '2026-03-03T00:00:00.000Z' }), now)).toBe(
      'future'
    );
    expect(bannerLifecycle(banner({ global_release_date: '2026-02-30T00:00:00.000Z' }), now)).toBe(
      'unknown'
    );
  });
});
