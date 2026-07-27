import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPlannedBanner,
  createPlan,
  deletePlan,
  duplicatePlan,
  getActivePlan,
  markBannerPulled,
  migratePersisted,
  renamePlan,
  reopenBanner,
  setActivePlan,
  setCaratSetting,
  setPlannedPulls,
  setPullResultPickupCopies,
  setPullResultPulls,
  setPullResultTicketsUsed,
  useCaratStore
} from '@/store/carat.store';
import type { PlannedBanner } from '@/store/carat.store';

function resetStore() {
  // Re-seed a single fresh plan so each test starts from a known baseline.
  const id = createPlan('Plan 1');
  useCaratStore.setState((state) => ({
    plans: state.plans.filter((plan) => plan.id === id),
    activePlanId: id
  }));
}

function replaceActiveBanners(plannedBanners: PlannedBanner[]) {
  useCaratStore.setState((state) => ({
    plans: state.plans.map((plan) =>
      plan.id === state.activePlanId ? { ...plan, plannedBanners } : plan
    )
  }));
}

describe('carat.store migration', () => {
  it('wraps a legacy flat state into a single "Plan 1"', () => {
    const legacy = {
      settings: { startingFreeCarats: 999, server: 'jp' },
      plannedBanners: [
        { id: 'b1', plannedPulls: 50, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 }
      ],
      paidPurchases: { anniv: { foo: 1 } },
      selectorChoices: { anniv: { uma: 'x' } }
    };

    const state = migratePersisted(legacy);

    expect(state.plans).toHaveLength(1);
    expect(state.activePlanId).toBe(state.plans[0].id);
    const plan = state.plans[0];
    expect(plan.name).toBe('Plan 1');
    expect(plan.settings.startingFreeCarats).toBe(999);
    expect(plan.settings.server).toBe('jp');
    // Defaults backfilled for missing settings keys.
    expect(plan.settings.monthlyCarats).toBe(15000);
    expect(plan.plannedBanners).toHaveLength(1);
    expect(plan.plannedBanners[0].id).toBe('b1');
    expect(plan.paidPurchases).toEqual({ anniv: { foo: 1 } });
    expect(plan.selectorChoices).toEqual({ anniv: { uma: 'x' } });
  });

  it('normalizes legacy planning fields without inventing a pull result', () => {
    const legacyBanner = {
      id: 'legacy-banner',
      plannedPulls: 200,
      startingDupes: 2,
      copyGoals: { '101': 4 },
      ownedCopies: { '101': 1 },
      ticketsUsed: 7,
      order: 3
    };

    const state = migratePersisted({
      settings: { startingFreeCarats: 999 },
      plannedBanners: [legacyBanner],
      paidPurchases: { anniv: { foo: 1 } },
      selectorChoices: { anniv: { uma: 'x' } }
    });

    const banner = state.plans[0].plannedBanners[0];
    expect(banner.pullResult).toBeUndefined();
    expect(banner).toMatchObject(legacyBanner);
    expect(state.plans[0].paidPurchases).toEqual({ anniv: { foo: 1 } });
    expect(state.plans[0].selectorChoices).toEqual({ anniv: { uma: 'x' } });
  });

  it('normalizes result counts without capping pickup copies', () => {
    const state = migratePersisted({
      plannedBanners: [
        {
          id: 'result-banner',
          plannedPulls: 10,
          startingDupes: 0,
          copyGoals: {},
          ownedCopies: {},
          order: 0,
          pullResult: {
            pulls: 12.9,
            ticketsUsed: 99.9,
            pickupCopies: {
              '101': 8.9,
              '102': -2.5,
              '103': Number.NaN,
              '104': '3'
            }
          }
        }
      ]
    });

    expect(state.plans[0].plannedBanners[0].pullResult).toEqual({
      pulls: 12,
      ticketsUsed: 12,
      pickupCopies: { '101': 8, '102': 0, '103': 0, '104': 0 }
    });
  });

  it('passes through the new multi-plan shape and repairs a stale activePlanId', () => {
    const now = Date.now();
    const planA = {
      id: 'a',
      name: 'A',
      createdAt: now,
      updatedAt: now,
      settings: {},
      plannedBanners: [],
      paidPurchases: {},
      selectorChoices: {}
    };
    const state = migratePersisted({ plans: [planA], activePlanId: 'missing' });
    expect(state.plans).toHaveLength(1);
    expect(state.activePlanId).toBe('a');
  });

  it('produces a default single plan for empty/garbage input', () => {
    const state = migratePersisted(undefined);
    expect(state.plans).toHaveLength(1);
    expect(state.activePlanId).toBe(state.plans[0].id);
    expect(state.plans[0].plannedBanners.length).toBeGreaterThan(0);
  });
});

describe('carat.store active-plan mutations', () => {
  beforeEach(() => {
    resetStore();
  });

  it('mutators only affect the active plan', () => {
    const first = useCaratStore.getState().activePlanId;
    const second = createPlan('Plan 2');

    setCaratSetting('startingFreeCarats', 12345);
    addPlannedBanner('new-banner');

    const secondPlan = useCaratStore.getState().plans.find((p) => p.id === second)!;
    const firstPlan = useCaratStore.getState().plans.find((p) => p.id === first)!;

    expect(secondPlan.settings.startingFreeCarats).toBe(12345);
    expect(secondPlan.plannedBanners.some((b) => b.id === 'new-banner')).toBe(true);
    // First plan untouched.
    expect(firstPlan.settings.startingFreeCarats).not.toBe(12345);
    expect(firstPlan.plannedBanners.some((b) => b.id === 'new-banner')).toBe(false);
  });

  it('switching plans changes the active target', () => {
    const first = useCaratStore.getState().activePlanId;
    const second = createPlan('Plan 2');

    setActivePlan(first);
    setPlannedPulls('example-banner', 77);

    const firstPlan = useCaratStore.getState().plans.find((p) => p.id === first)!;
    const secondPlan = useCaratStore.getState().plans.find((p) => p.id === second)!;
    expect(firstPlan.plannedBanners.find((b) => b.id === 'example-banner')?.plannedPulls).toBe(77);
    expect(secondPlan.plannedBanners.find((b) => b.id === 'example-banner')?.plannedPulls).not.toBe(
      77
    );
  });

  it('bumps updatedAt on mutation', () => {
    const before = getActivePlan(useCaratStore.getState()).updatedAt;
    setCaratSetting('umaTickets', 5);
    const after = getActivePlan(useCaratStore.getState()).updatedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('tracks banner results only on the active plan and preserves planning fields when reopened', () => {
    const activePlanId = useCaratStore.getState().activePlanId;
    const plannedBanner: PlannedBanner = {
      id: 'shared-banner',
      plannedPulls: 12.9,
      startingDupes: 2,
      copyGoals: { '101': 3 },
      ownedCopies: { '101': 1 },
      ticketsUsed: 4,
      order: 7
    };

    replaceActiveBanners([plannedBanner]);
    const inactivePlanId = createPlan('Plan 2');
    replaceActiveBanners([plannedBanner]);
    const inactiveBefore = useCaratStore
      .getState()
      .plans.find((plan) => plan.id === inactivePlanId)!;
    setActivePlan(activePlanId);

    let previousUpdatedAt = getActivePlan(useCaratStore.getState()).updatedAt;
    const expectUpdatedAtBump = (mutator: () => void) => {
      mutator();
      const nextUpdatedAt = getActivePlan(useCaratStore.getState()).updatedAt;
      expect(nextUpdatedAt).toBeGreaterThan(previousUpdatedAt);
      previousUpdatedAt = nextUpdatedAt;
    };

    expectUpdatedAtBump(() => markBannerPulled('shared-banner', 15.9));
    expect(getActivePlan(useCaratStore.getState()).plannedBanners[0].pullResult).toEqual({
      pulls: 12,
      ticketsUsed: 12,
      pickupCopies: {}
    });

    expectUpdatedAtBump(() => setPullResultPulls('shared-banner', 8.9));
    expect(getActivePlan(useCaratStore.getState()).plannedBanners[0].pullResult).toMatchObject({
      pulls: 8,
      ticketsUsed: 8
    });

    expectUpdatedAtBump(() => setPullResultTicketsUsed('shared-banner', 99.9));
    expect(getActivePlan(useCaratStore.getState()).plannedBanners[0].pullResult?.ticketsUsed).toBe(
      8
    );

    expectUpdatedAtBump(() => setPullResultPickupCopies('shared-banner', '101', 8.9));
    expect(
      getActivePlan(useCaratStore.getState()).plannedBanners[0].pullResult?.pickupCopies
    ).toEqual({ '101': 8 });

    expectUpdatedAtBump(() => reopenBanner('shared-banner'));
    const reopenedBanner = getActivePlan(useCaratStore.getState()).plannedBanners[0];
    expect(reopenedBanner.pullResult).toBeUndefined();
    expect(reopenedBanner).toEqual(plannedBanner);

    const inactiveAfter = useCaratStore
      .getState()
      .plans.find((plan) => plan.id === inactivePlanId)!;
    expect(inactiveAfter).toEqual(inactiveBefore);
    expect(inactiveAfter.plannedBanners[0]).toEqual(plannedBanner);
  });
});

describe('carat.store CRUD', () => {
  beforeEach(() => {
    resetStore();
  });

  it('createPlan appends and activates', () => {
    const countBefore = useCaratStore.getState().plans.length;
    const id = createPlan('Fresh');
    const state = useCaratStore.getState();
    expect(state.plans).toHaveLength(countBefore + 1);
    expect(state.activePlanId).toBe(id);
    expect(state.plans.at(-1)?.name).toBe('Fresh');
  });

  it('duplicatePlan deep-clones into a "… copy" and activates it', () => {
    const sourceId = useCaratStore.getState().activePlanId;
    setCaratSetting('startingFreeCarats', 4242);
    const copyId = duplicatePlan(sourceId)!;

    const copy = useCaratStore.getState().plans.find((p) => p.id === copyId)!;
    expect(useCaratStore.getState().activePlanId).toBe(copyId);
    expect(copy.name).toBe('Plan 1 copy');
    expect(copy.settings.startingFreeCarats).toBe(4242);

    // Mutating the copy must not touch the source (deep clone).
    setCaratSetting('startingFreeCarats', 1);
    const source = useCaratStore.getState().plans.find((p) => p.id === sourceId)!;
    expect(source.settings.startingFreeCarats).toBe(4242);
  });

  it('renamePlan ignores blank names', () => {
    const id = useCaratStore.getState().activePlanId;
    renamePlan(id, '  Renamed  ');
    expect(useCaratStore.getState().plans.find((p) => p.id === id)?.name).toBe('Renamed');
    renamePlan(id, ' '.repeat(3));
    expect(useCaratStore.getState().plans.find((p) => p.id === id)?.name).toBe('Renamed');
  });

  it('deletePlan recreates a default when the last plan is removed', () => {
    const id = useCaratStore.getState().activePlanId;
    deletePlan(id);
    const state = useCaratStore.getState();
    expect(state.plans).toHaveLength(1);
    expect(state.plans[0].id).not.toBe(id);
    expect(state.activePlanId).toBe(state.plans[0].id);
  });

  it('deletePlan moves active to the first remaining plan', () => {
    const first = useCaratStore.getState().activePlanId;
    const second = createPlan('Plan 2');
    expect(useCaratStore.getState().activePlanId).toBe(second);
    deletePlan(second);
    expect(useCaratStore.getState().activePlanId).toBe(first);
  });
});
