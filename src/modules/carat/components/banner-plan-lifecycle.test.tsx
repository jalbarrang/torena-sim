// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TutorialProvider } from '@/components/tutorial';
import { AddBannerDialog } from '@/modules/carat/components/add-banner-dialog';
import { BannerPlanTable } from '@/modules/carat/components/banner-plan-table';
import { CaratCalculatorPage } from '@/modules/carat/components/carat-calculator-page';
import type { TimelineEvent, TimelinePayload } from '@/modules/carat/data/timeline-types';
import type { CaratPlan, PlannedBanner } from '@/store/carat.store';
import { defaultCaratSettings, getActivePlan, useCaratStore } from '@/store/carat.store';
import { markVisited } from '@/store/tutorial.store';

const { fetchTimelineMock } = vi.hoisted(() => ({ fetchTimelineMock: vi.fn() }));

vi.mock('@/modules/carat/data/timeline-client', () => ({ fetchTimeline: fetchTimelineMock }));

const TEST_PLAN_ID = 'carat-component-test-plan';

const pastBanner: TimelineEvent = {
  id: 'past-banner',
  type: 'character_banner',
  card_type: 'character',
  title: 'Past banner',
  global_release_date: '2020-01-01T00:00:00Z',
  estimated_end_date: '2020-01-10T00:00:00Z',
  pickup_card_ids: [100101]
};

const laterPastBanner: TimelineEvent = {
  id: 'later-past-banner',
  type: 'character_banner',
  card_type: 'character',
  title: 'Later past banner',
  global_release_date: '2020-02-01T00:00:00Z',
  estimated_end_date: '2020-02-10T00:00:00Z',
  pickup_card_ids: [100102]
};

const liveBanner: TimelineEvent = {
  id: 'live-banner',
  type: 'character_banner',
  card_type: 'character',
  title: 'Live banner',
  global_release_date: '2020-01-01T00:00:00Z',
  estimated_end_date: '2100-01-10T00:00:00Z'
};

const futureBanner: TimelineEvent = {
  id: 'future-banner',
  type: 'support_card_banner',
  card_type: 'support',
  title: 'Future banner',
  global_release_date: '2100-01-01T00:00:00Z',
  estimated_end_date: '2100-01-10T00:00:00Z'
};

function timeline(events: TimelineEvent[] = [pastBanner]): TimelinePayload {
  return { anniversaries: [], calculation: {}, events, version: 'test' };
}

function plannedBanner(id = pastBanner.id): PlannedBanner {
  return {
    id,
    plannedPulls: 200,
    startingDupes: 0,
    copyGoals: {},
    ownedCopies: {},
    order: 0
  };
}

function resetStore(plannedBanners: PlannedBanner[] = []) {
  const plan: CaratPlan = {
    id: TEST_PLAN_ID,
    name: 'Component test plan',
    createdAt: 0,
    updatedAt: 0,
    settings: { ...defaultCaratSettings, startingFreeCarats: 12345, trackPaidCarats: false },
    plannedBanners,
    paidPurchases: {},
    selectorChoices: {}
  };

  localStorage.clear();
  useCaratStore.setState({ plans: [plan], activePlanId: plan.id });
  localStorage.clear();
}

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

function renderCaratCalculatorPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TutorialProvider>
        <CaratCalculatorPage />
      </TutorialProvider>
    </QueryClientProvider>
  );
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('banner plan lifecycle UI', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock
    });
    setViewport(800);
    fetchTimelineMock.mockReset();
    fetchTimelineMock.mockResolvedValue(timeline([liveBanner]));
    resetStore();
  });

  afterEach(() => {
    cleanup();
    resetStore();
    localStorage.clear();
    setViewport(1024);
  });

  it('keeps starting resources out of the plan at both breakpoints', () => {
    setViewport(1200);
    const wide = render(<BannerPlanTable timeline={timeline()} />);

    expect(screen.queryByRole('spinbutton', { name: 'Free carats' })).not.toBeInTheDocument();
    expect(screen.queryByText('Starting Carats / Tickets')).not.toBeInTheDocument();
    expect(screen.getByText(/Plan assumptions → Balance/)).toBeInTheDocument();

    wide.unmount();
    setViewport(800);
    render(<BannerPlanTable timeline={timeline()} />);

    expect(screen.queryByRole('spinbutton', { name: 'Free carats' })).not.toBeInTheDocument();
    expect(screen.queryByText('Starting Carats / Tickets')).not.toBeInTheDocument();
  });

  it('records and reopens a past banner through card lifecycle state', () => {
    resetStore([plannedBanner()]);

    const { container } = render(<BannerPlanTable timeline={timeline()} />);

    expect(screen.getByText('Action needed')).toBeInTheDocument();
    const provisionalStatus = screen
      .getAllByRole('status')
      .find((status) =>
        status.textContent?.includes(
          '1 past banner needs attention. Its planned spend is provisional, so later totals may change.'
        )
      );
    expect(provisionalStatus).toBeDefined();
    expect(provisionalStatus).toHaveTextContent(
      '1 past banner needs attention. Its planned spend is provisional, so later totals may change.'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark Past banner as pulled' }));

    expect(screen.getByRole('spinbutton', { name: 'Actual total pulls' })).toHaveValue(200);
    expect(screen.getByRole('spinbutton', { name: 'Actual ticket pulls' })).toHaveValue(0);
    expect(screen.getByText('Pickup copies · sparks included')).toBeInTheDocument();
    expect(
      screen.queryByRole('spinbutton', { name: 'Planned pulls for Past banner' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+200' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-tutorial="carat-odds"]')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Actual total pulls' }), {
      target: { value: '73' }
    });
    expect(getActivePlan(useCaratStore.getState()).plannedBanners[0]?.pullResult?.pulls).toBe(73);

    fireEvent.click(screen.getByRole('button', { name: 'Reopen Past banner' }));

    expect(screen.getByText('Action needed')).toBeInTheDocument();
    expect(getActivePlan(useCaratStore.getState()).plannedBanners[0]?.pullResult).toBeUndefined();
  });

  it('demotes every past-banner action while the first-visit nudge shows Start', () => {
    resetStore([plannedBanner(), plannedBanner(laterPastBanner.id)]);

    render(
      <BannerPlanTable timeline={timeline([pastBanner, laterPastBanner])} showFirstVisitNudge />
    );

    expect(screen.getByRole('button', { name: 'Mark Past banner as pulled' })).toHaveClass(
      'bg-secondary'
    );
    expect(screen.getByRole('button', { name: 'Mark Later past banner as pulled' })).toHaveClass(
      'bg-secondary'
    );
  });

  it('promotes only the oldest past-banner action without the first-visit nudge', () => {
    resetStore([plannedBanner(), plannedBanner(laterPastBanner.id)]);

    render(<BannerPlanTable timeline={timeline([pastBanner, laterPastBanner])} />);

    expect(screen.getByRole('button', { name: 'Mark Past banner as pulled' })).toHaveClass(
      'bg-primary'
    );
    expect(screen.getByRole('button', { name: 'Mark Later past banner as pulled' })).toHaveClass(
      'bg-secondary'
    );
  });

  it('demotes the loaded add-banner trigger while the first-visit nudge shows Start', () => {
    render(<AddBannerDialog timeline={timeline([liveBanner])} showFirstVisitNudge />);

    expect(screen.getByRole('button', { name: '+ Add banner from timeline' })).toHaveClass(
      'bg-secondary'
    );
  });

  it('offers live and future banners while excluding ended banners with available copy', () => {
    resetStore([plannedBanner()]);
    HTMLElement.prototype.scrollIntoView = () => {};

    render(<AddBannerDialog timeline={timeline([pastBanner, liveBanner, futureBanner])} />);

    const trigger = screen.getByRole('button', { name: '+ Add banner from timeline' });
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveClass('bg-secondary');

    fireEvent.click(trigger);

    expect(screen.getByText('Live banner')).toBeInTheDocument();
    expect(screen.getByText('Future banner')).toBeInTheDocument();
    expect(screen.queryByText('Past banner')).not.toBeInTheDocument();
    expect(screen.getByText('2 available banners')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Tap to add or remove available banners. The list stays open so you can build your whole plan in one go.'
      )
    ).toBeInTheDocument();
  });

  it('keeps Start as the only primary action on a first visit', async () => {
    renderCaratCalculatorPage();

    expect(screen.getByRole('button', { name: 'Start' })).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'New plan' })).toHaveClass('bg-secondary');
    expect(await screen.findByRole('button', { name: '+ Add banner from timeline' })).toHaveClass(
      'bg-secondary'
    );
  });

  it('keeps the oldest unresolved past-banner action as the only primary action', async () => {
    markVisited('carat-calculator');
    resetStore([plannedBanner(), plannedBanner(laterPastBanner.id)]);
    fetchTimelineMock.mockResolvedValue(timeline([pastBanner, laterPastBanner, liveBanner]));

    renderCaratCalculatorPage();

    expect(await screen.findByRole('button', { name: 'Mark Past banner as pulled' })).toHaveClass(
      'bg-primary'
    );
    expect(screen.getByRole('button', { name: 'Mark Later past banner as pulled' })).toHaveClass(
      'bg-secondary'
    );
    expect(screen.getByRole('button', { name: '+ Add banner from timeline' })).toHaveClass(
      'bg-secondary'
    );
    expect(screen.getByRole('button', { name: 'New plan' })).toHaveClass('bg-secondary');
  });

  it('makes Add banner primary when no first-visit or unresolved-banner action takes precedence', async () => {
    markVisited('carat-calculator');

    renderCaratCalculatorPage();

    expect(await screen.findByRole('button', { name: '+ Add banner from timeline' })).toHaveClass(
      'bg-primary'
    );
    expect(screen.getByRole('button', { name: 'New plan' })).toHaveClass('bg-secondary');
  });
});
