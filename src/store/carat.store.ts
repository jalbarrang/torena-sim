import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { cloneDeep } from 'es-toolkit';
import type { PaidPackPurchases } from '@/modules/carat/model/paid';

const CARAT_STORE_NAME = 'umalator-carat';

export type CaratServer = 'global' | 'jp';
type TrainingPass = 'none' | 'free' | 'paid';

export type CaratSettings = {
  server: CaratServer;
  startingFreeCarats: number;
  startingPaidCarats: number;
  umaTickets: number;
  supportTickets: number;
  monthlyCarats: number;
  monthlyTickets: number;
  teamTrialsClass: string;
  clubRank: string;
  cmPlacement: string;
  lohRank: string;
  dailyCaratPack: boolean;
  trainingPass: TrainingPass;
  trackPaidCarats: boolean;
};

export type BannerPullResult = {
  pulls: number;
  ticketsUsed: number;
  pickupCopies: Record<string, number>;
};

export type PlannedBanner = {
  id: string;
  plannedPulls: number;
  startingDupes: number;
  // Desired total copies per rate-up card, keyed by pickup card id. Absent or 0
  // means "not targeted". Empty object falls back to the single-card odds view.
  copyGoals: Record<string, number>;
  // Copies the player already owns per rate-up card (reruns), keyed by pickup
  // card id. These reduce how many copies the banner needs to supply.
  ownedCopies: Record<string, number>;
  // Explicit per-banner ticket allocation. Undefined means auto-fill from the
  // matching typed ticket pool in chronological order.
  ticketsUsed?: number;
  // Actual outcome for a resolved banner. This remains distinct from planning
  // inputs so reopening a result preserves the original plan.
  pullResult?: BannerPullResult;
  order: number;
};

export type SelectorChoice = {
  uma?: string;
  ssr?: string;
  stepUps?: Record<string, number>;
};

export type CaratPlan = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: CaratSettings;
  plannedBanners: PlannedBanner[];
  paidPurchases: Record<string, PaidPackPurchases>;
  selectorChoices: Record<string, SelectorChoice>;
};

type CaratState = {
  plans: CaratPlan[];
  activePlanId: string;
};

type CaratStore = CaratState;

export const defaultCaratSettings: CaratSettings = {
  server: 'global',
  startingFreeCarats: 24500,
  startingPaidCarats: 0,
  umaTickets: 0,
  supportTickets: 0,
  monthlyCarats: 15000,
  monthlyTickets: 27,
  teamTrialsClass: 'class-6',
  clubRank: 'b',
  cmPlacement: 'none',
  lohRank: 'none',
  dailyCaratPack: true,
  trainingPass: 'free',
  trackPaidCarats: false
};

function defaultPlannedBanners(): PlannedBanner[] {
  return [
    {
      id: 'example-banner',
      plannedPulls: 200,
      startingDupes: 0,
      copyGoals: {},
      ownedCopies: {},
      order: 0
    }
  ];
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createDefaultPlan(name = 'Plan 1'): CaratPlan {
  const now = Date.now();
  return {
    id: generateId(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { ...defaultCaratSettings },
    plannedBanners: defaultPlannedBanners(),
    paidPurchases: {},
    selectorChoices: {}
  };
}

function makeInitialState(): CaratState {
  const plan = createDefaultPlan();
  return { plans: [plan], activePlanId: plan.id };
}

const initialCaratState: CaratState = makeInitialState();

/** Read the active plan, falling back to the first plan if the id is stale. */
export function getActivePlan(state: CaratState): CaratPlan {
  return state.plans.find((plan) => plan.id === state.activePlanId) ?? state.plans[0];
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizePickupCopies(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).map(([cardId, copies]) => [cardId, normalizeCount(copies)])
  );
}

function normalizePullResult(value: unknown): BannerPullResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const result = value as Partial<BannerPullResult>;
  const pulls = normalizeCount(result.pulls);
  return {
    pulls,
    ticketsUsed: Math.min(pulls, normalizeCount(result.ticketsUsed)),
    pickupCopies: normalizePickupCopies(result.pickupCopies)
  };
}

function normalizeBanner(banner: PlannedBanner): PlannedBanner {
  return {
    ...banner,
    copyGoals: banner.copyGoals ?? {},
    ownedCopies: banner.ownedCopies ?? {},
    ticketsUsed:
      typeof banner.ticketsUsed === 'number' ? normalizeCount(banner.ticketsUsed) : undefined,
    pullResult: normalizePullResult(banner.pullResult)
  };
}

function normalizePlan(
  plan: Partial<Omit<CaratPlan, 'settings'>> & { settings?: Partial<CaratSettings> },
  fallbackName: string
): CaratPlan {
  const now = Date.now();
  return {
    id: plan.id ?? generateId(),
    name: plan.name ?? fallbackName,
    createdAt: typeof plan.createdAt === 'number' ? plan.createdAt : now,
    updatedAt: typeof plan.updatedAt === 'number' ? plan.updatedAt : now,
    settings: { ...defaultCaratSettings, ...plan.settings },
    plannedBanners: (plan.plannedBanners ?? defaultPlannedBanners()).map(normalizeBanner),
    paidPurchases: plan.paidPurchases ?? {},
    selectorChoices: plan.selectorChoices ?? {}
  };
}

type LegacyCaratState = {
  settings?: Partial<CaratSettings>;
  plannedBanners?: PlannedBanner[];
  paidPurchases?: Record<string, PaidPackPurchases>;
  selectorChoices?: Record<string, SelectorChoice>;
};

/**
 * Migrate persisted state. The legacy shape stored a single flat plan
 * (`settings`/`plannedBanners`/...); wrap it into one `CaratPlan` named
 * "Plan 1". The current shape stores `{ plans, activePlanId }`.
 */
export function migratePersisted(persisted: unknown): CaratState {
  const state = (persisted ?? {}) as Partial<CaratState> & LegacyCaratState;

  if (Array.isArray(state.plans) && state.plans.length > 0) {
    const plans = state.plans.map((plan, index) => normalizePlan(plan, `Plan ${index + 1}`));
    const activePlanId = plans.some((plan) => plan.id === state.activePlanId)
      ? (state.activePlanId as string)
      : plans[0].id;
    return { plans, activePlanId };
  }

  // Legacy flat shape (or empty) -> wrap into a single plan.
  const legacyPlan = normalizePlan(
    {
      settings: state.settings,
      plannedBanners: state.plannedBanners,
      paidPurchases: state.paidPurchases,
      selectorChoices: state.selectorChoices
    },
    'Plan 1'
  );
  return { plans: [legacyPlan], activePlanId: legacyPlan.id };
}

export const useCaratStore = create<CaratStore>()(
  persist(() => initialCaratState, {
    name: CARAT_STORE_NAME,
    storage: createJSONStorage(() => localStorage),
    merge: (persisted, current) => ({ ...current, ...migratePersisted(persisted) })
  })
);

/** Apply an updater to the active plan and bump its `updatedAt`. */
function updateActivePlan(updater: (plan: CaratPlan) => CaratPlan) {
  useCaratStore.setState((state) => {
    const activeId = getActivePlan(state).id;
    return {
      plans: state.plans.map((plan) =>
        plan.id === activeId
          ? { ...updater(plan), updatedAt: Math.max(Date.now(), plan.updatedAt + 1) }
          : plan
      )
    };
  });
}

export function setCaratSetting<K extends keyof CaratSettings>(key: K, value: CaratSettings[K]) {
  updateActivePlan((plan) => ({
    ...plan,
    settings: { ...plan.settings, [key]: value }
  }));
}

export function addPlannedBanner(id: string) {
  updateActivePlan((plan) => {
    if (plan.plannedBanners.some((banner) => banner.id === id)) {
      return plan;
    }

    const nextOrder = Math.max(-1, ...plan.plannedBanners.map((banner) => banner.order)) + 1;

    return {
      ...plan,
      plannedBanners: [
        ...plan.plannedBanners,
        {
          id,
          plannedPulls: 0,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          order: nextOrder
        }
      ]
    };
  });
}

export function removePlannedBanner(id: string) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.filter((banner) => banner.id !== id)
  }));
}

export function restorePlannedBanner(banner: PlannedBanner) {
  updateActivePlan((plan) => {
    if (plan.plannedBanners.some((planned) => planned.id === banner.id)) {
      return plan;
    }

    return {
      ...plan,
      plannedBanners: [...plan.plannedBanners, banner].sort((a, b) => a.order - b.order)
    };
  });
}

export function setPlannedPulls(id: string, plannedPulls: number) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) =>
      banner.id === id ? { ...banner, plannedPulls } : banner
    )
  }));
}

export function setPlannedTicketsUsed(id: string, ticketsUsed: number | undefined) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => {
      if (banner.id !== id) return banner;
      if (ticketsUsed === undefined) {
        const { ticketsUsed: _ticketsUsed, ...rest } = banner;
        return rest;
      }
      return { ...banner, ticketsUsed: Math.max(0, Math.floor(ticketsUsed || 0)) };
    })
  }));
}

export function setCopyGoal(bannerId: string, cardId: number, copies: number) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => {
      if (banner.id !== bannerId) return banner;
      const nextGoals = { ...banner.copyGoals };
      const value = Math.max(0, Math.min(5, Math.floor(copies || 0)));
      if (value <= 0) {
        delete nextGoals[cardId];
      } else {
        nextGoals[cardId] = value;
      }
      return { ...banner, copyGoals: nextGoals };
    })
  }));
}

export function setOwnedCopies(bannerId: string, cardId: number, copies: number) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => {
      if (banner.id !== bannerId) return banner;
      const nextOwned = { ...banner.ownedCopies };
      const value = Math.max(0, Math.min(4, Math.floor(copies || 0)));
      if (value <= 0) {
        delete nextOwned[cardId];
      } else {
        nextOwned[cardId] = value;
      }
      return { ...banner, ownedCopies: nextOwned };
    })
  }));
}

/** Record a banner's actual result using the ticket allocation resolved by its caller. */
export function markBannerPulled(id: string, ticketsUsed: number) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => {
      if (banner.id !== id) return banner;
      const pulls = normalizeCount(banner.plannedPulls);
      return {
        ...banner,
        pullResult: {
          pulls,
          ticketsUsed: Math.min(pulls, normalizeCount(ticketsUsed)),
          pickupCopies: {}
        }
      };
    })
  }));
}

export function setPullResultPulls(id: string, pulls: number) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => {
      if (banner.id !== id || !banner.pullResult) return banner;
      const nextPulls = normalizeCount(pulls);
      return {
        ...banner,
        pullResult: {
          ...banner.pullResult,
          pulls: nextPulls,
          ticketsUsed: Math.min(nextPulls, normalizeCount(banner.pullResult.ticketsUsed))
        }
      };
    })
  }));
}

export function setPullResultTicketsUsed(id: string, ticketsUsed: number) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => {
      if (banner.id !== id || !banner.pullResult) return banner;
      return {
        ...banner,
        pullResult: {
          ...banner.pullResult,
          ticketsUsed: Math.min(banner.pullResult.pulls, normalizeCount(ticketsUsed))
        }
      };
    })
  }));
}

export function setPullResultPickupCopies(
  bannerId: string,
  cardId: string | number,
  copies: number
) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => {
      if (banner.id !== bannerId || !banner.pullResult) return banner;
      const pickupCopies = { ...banner.pullResult.pickupCopies };
      const value = normalizeCount(copies);
      if (value === 0) {
        delete pickupCopies[cardId];
      } else {
        pickupCopies[cardId] = value;
      }
      return { ...banner, pullResult: { ...banner.pullResult, pickupCopies } };
    })
  }));
}

/** Remove only the actual result, preserving every original planning field. */
export function reopenBanner(id: string) {
  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => {
      if (banner.id !== id || !banner.pullResult) return banner;
      const { pullResult: _pullResult, ...reopenedBanner } = banner;
      return reopenedBanner;
    })
  }));
}

export function reorderPlannedBanners(idsInOrder: string[]) {
  const orderById = new Map(idsInOrder.map((id, order) => [id, order]));

  updateActivePlan((plan) => ({
    ...plan,
    plannedBanners: plan.plannedBanners.map((banner) => ({
      ...banner,
      order: orderById.get(banner.id) ?? banner.order
    }))
  }));
}

// --- Plan management (CRUD) -------------------------------------------------

/** Create a new plan and make it active. Returns the new plan id. */
export function createPlan(name?: string): string {
  const state = useCaratStore.getState();
  const planName = name?.trim() || `Plan ${state.plans.length + 1}`;
  const plan = createDefaultPlan(planName);
  useCaratStore.setState((current) => ({
    plans: [...current.plans, plan],
    activePlanId: plan.id
  }));
  return plan.id;
}

/** Delete a plan. If it was the last plan, a fresh default plan is created. */
export function deletePlan(id: string) {
  useCaratStore.setState((state) => {
    const remaining = state.plans.filter((plan) => plan.id !== id);

    if (remaining.length === 0) {
      const fresh = createDefaultPlan();
      return { plans: [fresh], activePlanId: fresh.id };
    }

    const activePlanId = state.activePlanId === id ? remaining[0].id : state.activePlanId;
    return { plans: remaining, activePlanId };
  });
}

export function renamePlan(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  useCaratStore.setState((state) => ({
    plans: state.plans.map((plan) =>
      plan.id === id ? { ...plan, name: trimmed, updatedAt: Date.now() } : plan
    )
  }));
}

/** Deep-clone a plan into a new "… copy" plan and make it active. */
export function duplicatePlan(id: string): string | undefined {
  const source = useCaratStore.getState().plans.find((plan) => plan.id === id);
  if (!source) return undefined;

  const now = Date.now();
  const copy: CaratPlan = {
    ...cloneDeep(source),
    id: generateId(),
    name: `${source.name} copy`,
    createdAt: now,
    updatedAt: now
  };
  useCaratStore.setState((state) => ({
    plans: [...state.plans, copy],
    activePlanId: copy.id
  }));
  return copy.id;
}

export function setActivePlan(id: string) {
  useCaratStore.setState((state) =>
    state.plans.some((plan) => plan.id === id) ? { activePlanId: id } : state
  );
}
