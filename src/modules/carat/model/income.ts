import type { TimelinePayload } from '@/modules/carat/data/timeline-types';
import type { CaratSettings } from '@/store/carat.store';
import {
  EVENT_INCOME_BY_TYPE,
  EVENT_INCOME_OVERRIDES_BY_ID,
  isEventIncomeType
} from './event-income';
import {
  CHAMPIONS_MEETING_REWARDS,
  CLUB_RANK_MONTHLY_CARATS,
  DAILY_CARAT_PACK_AVERAGE_MONTHLY_CARATS,
  DAYS_PER_MONTH,
  GLOBAL_TRAINING_PASS_INTRO_MONTHLY_CARATS,
  GLOBAL_TRAINING_PASS_INTRO_START,
  GLOBAL_TRAINING_PASS_MATURE_START,
  LEAGUE_OF_HEROES_EXPECTED_EVENTS_PER_MONTH,
  LEAGUE_OF_HEROES_REWARDS,
  LOGIN_BONUS_CARATS_PER_50_DAYS,
  TEAM_TRIALS_WEEKLY_CARATS,
  TRAINING_PASS_MATURE_MONTHLY_CARATS,
  TRAINING_PASS_MONTHLY_TICKETS_PER_TYPE,
  WEEKS_PER_MONTH
} from './income-tables';

export type ProjectedIncome = {
  carats: number;
  umaTickets: number;
  supportTickets: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RESET_HOUR_UTC = 22;
const CALENDAR_LOGIN_BONUS_CARATS = 500;

// Daily-quest carat baseline (daily + weekly mission carats), per server, per
// day. Source: reference spreadsheet "Carat Calculator" column AN.
const DAILY_QUEST_CARATS_PER_DAY = {
  global: 75 + 150 / 7,
  jp: 50 + 100 / 7
} as const;

// Flat recurring pull tickets per month, per ticket type (spreadsheet AU21).
const MONTHLY_BASELINE_TICKETS_PER_TYPE = 4;

function safeRecordValue<T>(record: Record<string, T>, key: string, fallback: T) {
  return record[key] ?? fallback;
}

function normalizeToResetDate(date: Date) {
  const normalized = new Date(date);
  normalized.setUTCHours(RESET_HOUR_UTC, 0, 0, 0);

  if (date.getTime() < normalized.getTime()) {
    normalized.setUTCDate(normalized.getUTCDate() - 1);
  }

  return normalized;
}

function trainingPassMonthlyIncome(settings: CaratSettings, asOfDate: Date) {
  const matureCarats = safeRecordValue(
    TRAINING_PASS_MATURE_MONTHLY_CARATS,
    settings.trainingPass,
    0
  );
  const matureTickets = safeRecordValue(
    TRAINING_PASS_MONTHLY_TICKETS_PER_TYPE,
    settings.trainingPass,
    0
  );

  if (settings.server !== 'global') {
    return { carats: matureCarats, ticketsPerType: matureTickets };
  }

  const asOfTime = asOfDate.getTime();
  const introStart = Date.parse(GLOBAL_TRAINING_PASS_INTRO_START);
  const matureStart = Date.parse(GLOBAL_TRAINING_PASS_MATURE_START);
  if (asOfTime < introStart) {
    return { carats: 0, ticketsPerType: 0 };
  }
  if (asOfTime < matureStart) {
    return {
      carats: safeRecordValue(GLOBAL_TRAINING_PASS_INTRO_MONTHLY_CARATS, settings.trainingPass, 0),
      ticketsPerType: matureTickets
    };
  }

  return { carats: matureCarats, ticketsPerType: matureTickets };
}

export function monthlyRecurringCarats(
  settings: CaratSettings,
  asOfDate: Date = new Date()
): ProjectedIncome {
  const teamTrialsWeekly = safeRecordValue(TEAM_TRIALS_WEEKLY_CARATS, settings.teamTrialsClass, 0);
  const clubRank = safeRecordValue(CLUB_RANK_MONTHLY_CARATS, settings.clubRank, 0);
  const trainingPass = trainingPassMonthlyIncome(settings, asOfDate);
  const dailyPack = settings.dailyCaratPack ? DAILY_CARAT_PACK_AVERAGE_MONTHLY_CARATS : 0;
  const dailyQuestPerDay =
    settings.server === 'jp' ? DAILY_QUEST_CARATS_PER_DAY.jp : DAILY_QUEST_CARATS_PER_DAY.global;
  const dailyQuest = dailyQuestPerDay * DAYS_PER_MONTH;
  const fiftyDayLogin = (LOGIN_BONUS_CARATS_PER_50_DAYS / 50) * DAYS_PER_MONTH;

  // Recurring tickets accrue equally to both pools; timeline event tickets are added per event in projectIncome.
  const monthlyTicketsPerType = MONTHLY_BASELINE_TICKETS_PER_TYPE + trainingPass.ticketsPerType;

  return {
    carats:
      dailyQuest +
      clubRank +
      dailyPack +
      trainingPass.carats +
      teamTrialsWeekly * WEEKS_PER_MONTH +
      fiftyDayLogin,
    umaTickets: monthlyTicketsPerType,
    supportTickets: monthlyTicketsPerType
  };
}

function monthsBetween(fromDate: Date, toDate: Date) {
  return Math.max(0, (toDate.getTime() - fromDate.getTime()) / MS_PER_DAY / DAYS_PER_MONTH);
}

function projectRecurringIncome(
  settings: CaratSettings,
  fromDate: Date,
  toDate: Date
): ProjectedIncome {
  const from = normalizeToResetDate(fromDate);
  const to = normalizeToResetDate(toDate);
  if (to.getTime() <= from.getTime()) {
    return { carats: 0, umaTickets: 0, supportTickets: 0 };
  }

  const segmentTimes = [from.getTime()];
  if (settings.server === 'global') {
    for (const boundary of [
      Date.parse(GLOBAL_TRAINING_PASS_INTRO_START),
      Date.parse(GLOBAL_TRAINING_PASS_MATURE_START)
    ]) {
      if (boundary > from.getTime() && boundary < to.getTime()) {
        segmentTimes.push(boundary);
      }
    }
  }
  segmentTimes.push(to.getTime());

  const projected = { carats: 0, umaTickets: 0, supportTickets: 0 };
  for (let index = 0; index < segmentTimes.length - 1; index += 1) {
    const segmentFrom = new Date(segmentTimes[index]);
    const segmentTo = new Date(segmentTimes[index + 1]);
    const monthly = monthlyRecurringCarats(settings, segmentFrom);
    const monthCount = monthsBetween(segmentFrom, segmentTo);
    projected.carats += monthly.carats * monthCount;
    projected.umaTickets += monthly.umaTickets * monthCount;
    projected.supportTickets += monthly.supportTickets * monthCount;
  }

  return projected;
}

function eventDateValue(date: string | null | undefined) {
  if (!date) {
    return null;
  }

  const value = new Date(date).getTime();
  return Number.isFinite(value) ? value : null;
}

function isInAccrualWindow(time: number, fromTime: number, toTime: number) {
  return time > fromTime && time <= toTime;
}

function calendarLoginBonusCarats(fromTime: number, toTime: number) {
  let carats = 0;
  const fromYear = new Date(fromTime).getUTCFullYear();
  const toYear = new Date(toTime).getUTCFullYear();

  for (let year = fromYear; year <= toYear; year += 1) {
    for (const [month, day] of [
      [1, 14],
      [2, 14]
    ]) {
      const time = Date.UTC(year, month, day, RESET_HOUR_UTC);
      if (isInAccrualWindow(time, fromTime, toTime)) {
        carats += CALENDAR_LOGIN_BONUS_CARATS;
      }
    }
  }

  return carats;
}

export function projectIncome(
  settings: CaratSettings,
  timeline: TimelinePayload,
  fromDate: Date,
  toDate: Date
): ProjectedIncome {
  const from = normalizeToResetDate(fromDate);
  const to = normalizeToResetDate(toDate);

  if (to.getTime() <= from.getTime()) {
    return { carats: 0, umaTickets: 0, supportTickets: 0 };
  }

  const recurring = projectRecurringIncome(settings, from, to);
  const monthCount = monthsBetween(from, to);
  let carats = recurring.carats;
  let umaTickets = recurring.umaTickets;
  let supportTickets = recurring.supportTickets;

  const fromTime = from.getTime();
  const toTime = to.getTime();
  const cmReward = safeRecordValue(CHAMPIONS_MEETING_REWARDS, settings.cmPlacement, {
    carats: 0,
    tickets: 0
  });

  for (const event of timeline.events) {
    const time = eventDateValue(event.global_release_date ?? event.jp_release_date);
    if (time === null || !isInAccrualWindow(time, fromTime, toTime)) {
      continue;
    }

    if (event.type === 'champions_meeting') {
      carats += cmReward.carats;
      // CM ticket totals are split evenly between the two pools (sheet AS37 =
      // value / 2). Champion 10 -> 5 uma + 5 support.
      umaTickets += cmReward.tickets / 2;
      supportTickets += cmReward.tickets / 2;
      continue;
    }

    if (isEventIncomeType(event.type)) {
      const eventIncome =
        EVENT_INCOME_OVERRIDES_BY_ID[event.id] ?? EVENT_INCOME_BY_TYPE[event.type];
      carats += eventIncome.carats;
      umaTickets += eventIncome.umaTickets;
      supportTickets += eventIncome.supportTickets;
    }
  }

  if (settings.server === 'global') {
    carats += calendarLoginBonusCarats(fromTime, toTime);
  }

  // The timeline payload has no distinct LoH event type, so use the five-events-per-year expectation derived from the reference workbook's AT ledger instead of inventing event dates. LoH ticket totals are split evenly between the two pools (sheet AT37 = value / 2).
  const lohReward = safeRecordValue(LEAGUE_OF_HEROES_REWARDS, settings.lohRank, {
    carats: 0,
    tickets: 0
  });
  const expectedLohEvents = LEAGUE_OF_HEROES_EXPECTED_EVENTS_PER_MONTH * monthCount;
  carats += lohReward.carats * expectedLohEvents;
  umaTickets += (lohReward.tickets / 2) * expectedLohEvents;
  supportTickets += (lohReward.tickets / 2) * expectedLohEvents;

  return { carats, umaTickets, supportTickets };
}

// All-in monthly income averages a full year of projected income (so sparse sources like CM, LoH, and event handouts are represented fairly) and reports it per 30 days, matching the reference calculator's weighted-average semantics.
export const ALL_IN_PROJECTION_DAYS = 365;
export const ALL_IN_NORMALIZED_DAYS = 30;

export type MonthlyIncomeBreakdown = {
  total: ProjectedIncome;
  recurring: ProjectedIncome;
  championsMeeting: ProjectedIncome;
  leagueOfHeroes: ProjectedIncome;
  eventsAndCalendar: ProjectedIncome;
};

function scaleIncome(income: ProjectedIncome, factor: number): ProjectedIncome {
  return {
    carats: income.carats * factor,
    umaTickets: income.umaTickets * factor,
    supportTickets: income.supportTickets * factor
  };
}

function subtractIncome(left: ProjectedIncome, right: ProjectedIncome): ProjectedIncome {
  return {
    carats: left.carats - right.carats,
    umaTickets: left.umaTickets - right.umaTickets,
    supportTickets: left.supportTickets - right.supportTickets
  };
}

export function projectMonthlyIncomeBreakdown(
  settings: CaratSettings,
  timeline: TimelinePayload,
  now: Date
): MonthlyIncomeBreakdown {
  const from = new Date(now);
  const to = new Date(now.getTime() + ALL_IN_PROJECTION_DAYS * MS_PER_DAY);
  const total = projectIncome(settings, timeline, from, to);

  // Counterfactual deltas keep the breakdown deterministic and double-count-free: each bucket is "total minus the same projection with only that source turned off", and the residual bucket absorbs exactly the timeline events plus calendar one-offs.
  const championsMeeting = subtractIncome(
    total,
    projectIncome({ ...settings, cmPlacement: 'none' }, timeline, from, to)
  );
  const leagueOfHeroes = subtractIncome(
    total,
    projectIncome({ ...settings, lohRank: 'none' }, timeline, from, to)
  );

  const recurring = projectRecurringIncome(settings, from, to);
  const eventsAndCalendar = subtractIncome(
    subtractIncome(subtractIncome(total, recurring), championsMeeting),
    leagueOfHeroes
  );

  const normalize = ALL_IN_NORMALIZED_DAYS / ALL_IN_PROJECTION_DAYS;
  return {
    total: scaleIncome(total, normalize),
    recurring: scaleIncome(recurring, normalize),
    championsMeeting: scaleIncome(championsMeeting, normalize),
    leagueOfHeroes: scaleIncome(leagueOfHeroes, normalize),
    eventsAndCalendar: scaleIncome(eventsAndCalendar, normalize)
  };
}

export function caratsAvailableAt(settings: CaratSettings, timeline: TimelinePayload, date: Date) {
  const income = projectIncome(settings, timeline, new Date(), date);

  // Tickets are no longer folded into carats; they accrue into typed pools in
  // computePlan instead.
  return settings.startingFreeCarats + income.carats;
}
