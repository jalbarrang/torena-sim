import type { TimelineEvent, TimelinePayload } from '@/modules/carat/data/timeline-types';
import {
  bannerLifecycle,
  bannerStartTime,
  type BannerLifecycle
} from '@/modules/carat/data/banner-lifecycle';
import { projectIncome } from '@/modules/carat/model/income';
import { CARAT_PER_PULL } from '@/modules/carat/model/income-tables';
import { totalPaidCaratsFromPurchases, type PaidPackPurchases } from '@/modules/carat/model/paid';
import type { CaratSettings, PlannedBanner } from '@/store/carat.store';

type TicketType = 'uma' | 'support';

type BannerPlanStatus = 'recorded' | 'provisional' | 'live' | 'future' | 'unknown';

export type ComputePlanOptions = { now?: Date };

export type BannerPlanRow = {
  event: TimelineEvent;
  plannedBanner: PlannedBanner;
  status: BannerPlanStatus;
  effectivePulls: number;
  caratsAvailable: number;
  paidCaratsAvailable: number;
  freeCaratsAvailable: number;
  ticketType: TicketType;
  ticketsAvailable: number;
  ticketsUsed: number;
  ticketsSaved: number;
  ticketsRemaining: number;
  ticketDeficit: number;
  cost: number;
  paidCost: number;
  freeCost: number;
  balanceAfter: number;
  paidBalanceAfter: number;
  freeBalanceAfter: number;
  affordable: boolean;
};

type PlannedEvent = { event: TimelineEvent; plannedBanner: PlannedBanner };

type RunningResources = {
  freeCarats: number;
  paidCarats: number;
  umaTickets: number;
  supportTickets: number;
};

function eventStartTime(event: TimelineEvent) {
  return bannerStartTime(event) ?? Number.POSITIVE_INFINITY;
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
  const maxTicketsUsed = Math.min(Math.max(0, ticketsAvailable), plannedPulls);

  if (plannedBanner.ticketsUsed === undefined) {
    return maxTicketsUsed;
  }

  return Math.min(maxTicketsUsed, Math.max(0, Math.floor(plannedBanner.ticketsUsed || 0)));
}

function recordedPullsOf(plannedBanner: PlannedBanner) {
  return Math.max(0, Math.floor(plannedBanner.pullResult?.pulls || 0));
}

function recordedTicketsOf(plannedBanner: PlannedBanner, pulls: number) {
  return Math.min(pulls, Math.max(0, Math.floor(plannedBanner.pullResult?.ticketsUsed || 0)));
}

function statusForBanner(
  lifecycle: BannerLifecycle,
  plannedBanner: PlannedBanner
): BannerPlanStatus {
  if (lifecycle === 'past') {
    return plannedBanner.pullResult ? 'recorded' : 'provisional';
  }

  return lifecycle;
}

function ticketPool(resources: RunningResources, ticketType: TicketType) {
  return ticketType === 'uma' ? resources.umaTickets : resources.supportTickets;
}

function setTicketPool(resources: RunningResources, ticketType: TicketType, value: number) {
  if (ticketType === 'uma') {
    resources.umaTickets = value;
  } else {
    resources.supportTickets = value;
  }
}

function settleBanner(
  event: TimelineEvent,
  plannedBanner: PlannedBanner,
  status: BannerPlanStatus,
  resources: RunningResources,
  settings: CaratSettings
): BannerPlanRow {
  const ticketType = ticketTypeForEvent(event);
  const effectivePulls =
    status === 'recorded' ? recordedPullsOf(plannedBanner) : plannedPullsOf(plannedBanner);
  const availableTicketPool = ticketPool(resources, ticketType);
  const ticketsAvailable = Math.floor(Math.max(0, availableTicketPool));
  const ticketsUsed =
    status === 'recorded'
      ? recordedTicketsOf(plannedBanner, effectivePulls)
      : ticketAllocation(plannedBanner, ticketsAvailable, effectivePulls);
  const nextTicketPool = availableTicketPool - ticketsUsed;
  setTicketPool(resources, ticketType, nextTicketPool);

  const caratsAvailable = resources.freeCarats + resources.paidCarats;
  const paidCaratsAvailable = resources.paidCarats;
  const freeCaratsAvailable = resources.freeCarats;
  const ticketsSaved = ticketsUsed * CARAT_PER_PULL;
  const cost = Math.max(0, effectivePulls - ticketsUsed) * CARAT_PER_PULL;
  const paidCost = settings.trackPaidCarats ? Math.min(resources.paidCarats, cost) : 0;
  const freeCost = cost - paidCost;
  resources.paidCarats -= paidCost;
  resources.freeCarats -= freeCost;
  const balanceAfter = resources.freeCarats + resources.paidCarats;

  return {
    event,
    plannedBanner,
    status,
    effectivePulls,
    caratsAvailable,
    paidCaratsAvailable,
    freeCaratsAvailable,
    ticketType,
    ticketsAvailable,
    ticketsUsed,
    ticketsSaved,
    ticketsRemaining: Math.floor(Math.max(0, nextTicketPool)),
    ticketDeficit: Math.max(0, -nextTicketPool),
    cost,
    paidCost,
    freeCost,
    balanceAfter,
    paidBalanceAfter: resources.paidCarats,
    freeBalanceAfter: resources.freeCarats,
    affordable: balanceAfter >= 0
  };
}

function addIncome(resources: RunningResources, income: ReturnType<typeof projectIncome>) {
  resources.freeCarats += income.carats;
  resources.umaTickets += income.umaTickets;
  resources.supportTickets += income.supportTickets;
}

export function computePlan(
  settings: CaratSettings,
  timeline: TimelinePayload,
  plannedBanners: PlannedBanner[],
  paidPurchases: Record<string, Partial<PaidPackPurchases>> = {},
  options: ComputePlanOptions = {}
): BannerPlanRow[] {
  const now = new Date(options.now ?? Date.now());
  const eventsById = new Map(timeline.events.map((event) => [event.id, event]));
  const rows = plannedBanners
    .map((plannedBanner) => {
      const event = eventsById.get(plannedBanner.id);
      return event ? { event, plannedBanner } : null;
    })
    .filter((row): row is PlannedEvent => row !== null)
    .sort((a, b) => eventStartTime(a.event) - eventStartTime(b.event));
  const lifecycles = new Map(
    rows.map((row) => [row.plannedBanner, bannerLifecycle(row.event, now)])
  );
  const historicalRows = rows.filter((row) => lifecycles.get(row.plannedBanner) === 'past');
  const projectedRows = rows.filter((row) => lifecycles.get(row.plannedBanner) !== 'past');
  const resources: RunningResources = {
    freeCarats: settings.startingFreeCarats,
    paidCarats: settings.trackPaidCarats
      ? settings.startingPaidCarats +
        totalPaidCaratsFromPurchases(paidPurchases, settings.server).paidCarats
      : 0,
    umaTickets: Math.max(0, Math.floor(settings.umaTickets || 0)),
    supportTickets: Math.max(0, Math.floor(settings.supportTickets || 0))
  };
  const computedRows = new Map<PlannedBanner, BannerPlanRow>();

  // Ended banners consume the configured starting pools in chronology, but do
  // not advance the income boundary into the past.
  for (const row of historicalRows) {
    const lifecycle = lifecycles.get(row.plannedBanner)!;
    computedRows.set(
      row.plannedBanner,
      settleBanner(
        row.event,
        row.plannedBanner,
        statusForBanner(lifecycle, row.plannedBanner),
        resources,
        settings
      )
    );
  }

  let incomeBoundary = now;
  for (const row of projectedRows) {
    const lifecycle = lifecycles.get(row.plannedBanner)!;
    const startTime = eventStartTime(row.event);
    const spendDate = lifecycle === 'future' ? new Date(startTime) : now;
    if (spendDate.getTime() > incomeBoundary.getTime()) {
      addIncome(resources, projectIncome(settings, timeline, incomeBoundary, spendDate));
      incomeBoundary = spendDate;
    }
    computedRows.set(
      row.plannedBanner,
      settleBanner(
        row.event,
        row.plannedBanner,
        statusForBanner(lifecycle, row.plannedBanner),
        resources,
        settings
      )
    );
  }

  return rows.map((row) => computedRows.get(row.plannedBanner)!);
}
