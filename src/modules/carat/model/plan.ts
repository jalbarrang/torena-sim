import type { TimelineEvent, TimelinePayload } from '@/modules/carat/data/timeline-types';
import { caratsAvailableAt, projectIncome } from '@/modules/carat/model/income';
import { CARAT_PER_PULL } from '@/modules/carat/model/income-tables';
import { totalPaidCaratsFromPurchases, type PaidPackPurchases } from '@/modules/carat/model/paid';
import type { CaratSettings, PlannedBanner } from '@/store/carat.store';

type TicketType = 'uma' | 'support';

export type BannerPlanRow = {
  event: TimelineEvent;
  plannedBanner: PlannedBanner;
  caratsAvailable: number;
  paidCaratsAvailable: number;
  freeCaratsAvailable: number;
  ticketType: TicketType;
  ticketsAvailable: number;
  ticketsUsed: number;
  ticketsSaved: number;
  ticketsRemaining: number;
  cost: number;
  paidCost: number;
  freeCost: number;
  balanceAfter: number;
  paidBalanceAfter: number;
  freeBalanceAfter: number;
  affordable: boolean;
};

function eventStartDate(event: TimelineEvent) {
  return new Date(event.global_release_date ?? event.jp_release_date ?? 0);
}

function eventStartTime(event: TimelineEvent) {
  const time = eventStartDate(event).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function ticketTypeForEvent(event: TimelineEvent): TicketType {
  return event.card_type === 'character' ? 'uma' : 'support';
}

function plannedPullsOf(plannedBanner: PlannedBanner) {
  return Math.max(0, Math.floor(plannedBanner.plannedPulls || 0));
}

function ticketAllocation(
  plannedBanner: PlannedBanner,
  ticketsAvailable: number,
  plannedPulls: number
) {
  // ticketsAvailable is clamped defensively; the running pools are already >= 0.
  const maxTicketsUsed = Math.min(Math.max(0, ticketsAvailable), plannedPulls);

  if (plannedBanner.ticketsUsed === undefined) {
    return maxTicketsUsed;
  }

  return Math.min(maxTicketsUsed, Math.max(0, Math.floor(plannedBanner.ticketsUsed || 0)));
}

export function computePlan(
  settings: CaratSettings,
  timeline: TimelinePayload,
  plannedBanners: PlannedBanner[],
  paidPurchases: Record<string, Partial<PaidPackPurchases>> = {}
): BannerPlanRow[] {
  const eventsById = new Map(timeline.events.map((event) => [event.id, event]));
  const rows = plannedBanners
    .map((plannedBanner) => {
      const event = eventsById.get(plannedBanner.id);
      return event ? { event, plannedBanner } : null;
    })
    .filter((row): row is { event: TimelineEvent; plannedBanner: PlannedBanner } => row !== null)
    .sort((a, b) => eventStartTime(a.event) - eventStartTime(b.event));

  let previousDate = new Date();
  let runningFreeBalance = settings.startingFreeCarats;
  let runningPaidBalance = settings.trackPaidCarats
    ? settings.startingPaidCarats +
      totalPaidCaratsFromPurchases(paidPurchases, settings.server).paidCarats
    : 0;
  let runningUmaTickets = Math.max(0, Math.floor(settings.umaTickets || 0));
  let runningSupportTickets = Math.max(0, Math.floor(settings.supportTickets || 0));

  return rows.map(({ event, plannedBanner }) => {
    const startDate = eventStartDate(event);
    const income = projectIncome(settings, timeline, previousDate, startDate);
    runningFreeBalance += income.carats;
    // Income tickets are tracked per type. Pools may be fractional here (LoH and
    // baseline tickets are amortized monthly); we floor when exposing/allocating
    // below and carry the remainder forward.
    runningUmaTickets += income.umaTickets;
    runningSupportTickets += income.supportTickets;

    const ticketType = ticketTypeForEvent(event);
    const ticketsAvailable = Math.floor(
      Math.max(0, ticketType === 'uma' ? runningUmaTickets : runningSupportTickets)
    );
    const plannedPulls = plannedPullsOf(plannedBanner);
    const ticketsUsed = ticketAllocation(plannedBanner, ticketsAvailable, plannedPulls);
    const ticketsSaved = ticketsUsed * CARAT_PER_PULL;

    if (ticketType === 'uma') {
      runningUmaTickets -= ticketsUsed;
    } else {
      runningSupportTickets -= ticketsUsed;
    }

    const ticketedPulls = Math.max(0, plannedPulls - ticketsUsed);
    const cost = ticketedPulls * CARAT_PER_PULL;
    const paidCost = settings.trackPaidCarats ? Math.min(runningPaidBalance, cost) : 0;
    const freeCost = cost - paidCost;
    runningPaidBalance -= paidCost;
    runningFreeBalance -= freeCost;
    previousDate = startDate;

    const freeCaratsAvailable = caratsAvailableAt(settings, timeline, startDate);
    const balanceAfter = runningFreeBalance + runningPaidBalance;

    return {
      event,
      plannedBanner,
      caratsAvailable: freeCaratsAvailable + runningPaidBalance,
      paidCaratsAvailable: runningPaidBalance + paidCost,
      freeCaratsAvailable,
      ticketType,
      ticketsAvailable,
      ticketsUsed,
      ticketsSaved,
      ticketsRemaining: Math.floor(
        Math.max(0, ticketType === 'uma' ? runningUmaTickets : runningSupportTickets)
      ),
      cost,
      paidCost,
      freeCost,
      balanceAfter,
      paidBalanceAfter: runningPaidBalance,
      freeBalanceAfter: runningFreeBalance,
      affordable: balanceAfter >= 0
    };
  });
}
