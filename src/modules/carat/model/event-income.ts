export type EventIncomeType = 'story_event' | 'campaign' | 'legend_race';

export type EventIncome = {
  carats: number;
  umaTickets: number;
  supportTickets: number;
};

export const EVENT_INCOME_BY_TYPE = {
  story_event: {
    carats: 2_160,
    umaTickets: 2,
    supportTickets: 2
  },
  // This is the low-confidence campaign residual average documented in docs/carat-income-sources.md; prefer an ID override when its rewards are known.
  campaign: {
    carats: 3_500,
    umaTickets: 0,
    supportTickets: 0
  },
  legend_race: {
    carats: 500,
    umaTickets: 0,
    supportTickets: 0
  }
} as const satisfies Record<EventIncomeType, EventIncome>;

export const EVENT_INCOME_OVERRIDES_BY_ID: Partial<Record<string, EventIncome>> = {};

export function isEventIncomeType(type: string): type is EventIncomeType {
  return Object.hasOwn(EVENT_INCOME_BY_TYPE, type);
}
