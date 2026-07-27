import type { TimelineEvent } from '@/modules/carat/data/timeline-types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type BannerLifecycle = 'past' | 'live' | 'future' | 'unknown';

function hasValidIsoCalendarDate(value: string): boolean {
  const match = ISO_CALENDAR_DATE.exec(value);
  if (!match) return true;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 && isLeapYear ? 29 : DAYS_PER_MONTH[month - 1];
  return day <= daysInMonth;
}

function validTime(value: string | null | undefined): number | undefined {
  if (!value || !hasValidIsoCalendarDate(value)) return undefined;

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

/** Resolve the first valid release time in server-preference order. */
export function bannerStartTime(event: TimelineEvent): number | undefined {
  return validTime(event.global_release_date) ?? validTime(event.jp_release_date);
}

/**
 * Resolve a banner's end instant from an explicit estimate, then a valid start
 * plus a positive duration. An unknown end is deliberately not inferred.
 */
export function bannerEndTime(event: TimelineEvent): number | undefined {
  const estimatedEndTime = validTime(event.estimated_end_date);
  if (estimatedEndTime !== undefined) return estimatedEndTime;

  const startTime = bannerStartTime(event);
  const durationDays = event.banner_duration_days;
  if (
    startTime === undefined ||
    typeof durationDays !== 'number' ||
    !Number.isFinite(durationDays) ||
    durationDays <= 0
  ) {
    return undefined;
  }

  return startTime + durationDays * MS_PER_DAY;
}

/** Classify a banner against an explicit clock without reading ambient time. */
export function bannerLifecycle(event: TimelineEvent, now: Date): BannerLifecycle {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return 'unknown';

  const endTime = bannerEndTime(event);
  if (endTime !== undefined && nowTime >= endTime) return 'past';

  const startTime = bannerStartTime(event);
  if (startTime === undefined) return 'unknown';
  return nowTime >= startTime ? 'live' : 'future';
}
