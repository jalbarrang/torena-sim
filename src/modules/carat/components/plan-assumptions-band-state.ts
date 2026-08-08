import { create } from 'zustand';

export type PlanAssumptionsTab = 'balance' | 'income' | 'rewards';

type PlanAssumptionsBandState = {
  isOpen: boolean;
  tab: PlanAssumptionsTab;
};

/**
 * Disclosure state for the plan assumptions band. Deliberately not persisted:
 * the band opens collapsed on every page load, and the collapsed summary is
 * what makes that acceptable. It lives outside the component only so the
 * guided tour can reveal a group before it resolves a step's target.
 */
export const usePlanAssumptionsBand = create<PlanAssumptionsBandState>(() => ({
  isOpen: false,
  tab: 'balance'
}));

export function setPlanAssumptionsBandOpen(isOpen: boolean) {
  usePlanAssumptionsBand.setState({ isOpen });
}

export function setPlanAssumptionsTab(tab: PlanAssumptionsTab) {
  usePlanAssumptionsBand.setState({ tab });
}

/** Expand the band to a specific group. Used by tour steps targeting band content. */
export function revealPlanAssumptions(tab: PlanAssumptionsTab) {
  usePlanAssumptionsBand.setState({ isOpen: true, tab });
}

/** Restore the collapsed default. */
export function resetPlanAssumptionsBand() {
  usePlanAssumptionsBand.setState({ isOpen: false, tab: 'balance' });
}
