// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TutorialProvider } from '@/components/tutorial';
import { CaratCalculatorPage } from '@/modules/carat/components/carat-calculator-page';
import { resetPlanAssumptionsBand } from '@/modules/carat/components/plan-assumptions-band-state';
import type { TimelineEvent, TimelinePayload } from '@/modules/carat/data/timeline-types';
import type { CaratPlan, PlannedBanner } from '@/store/carat.store';
import { defaultCaratSettings, useCaratStore } from '@/store/carat.store';
import { markVisited } from '@/store/tutorial.store';

const { fetchTimelineMock } = vi.hoisted(() => ({ fetchTimelineMock: vi.fn() }));

vi.mock('@/modules/carat/data/timeline-client', () => ({ fetchTimeline: fetchTimelineMock }));

const liveBanner: TimelineEvent = {
  id: 'live-banner',
  type: 'character_banner',
  card_type: 'character',
  title: 'Live banner',
  global_release_date: '2020-01-01T00:00:00Z',
  estimated_end_date: '2100-01-10T00:00:00Z'
};

function timeline(events: TimelineEvent[] = [liveBanner]): TimelinePayload {
  return { anniversaries: [], calculation: {}, events, version: 'test' };
}

function plannedBanner(id = liveBanner.id): PlannedBanner {
  return { id, plannedPulls: 200, startingDupes: 0, copyGoals: {}, ownedCopies: {}, order: 0 };
}

function resetStore(plannedBanners: PlannedBanner[] = []) {
  const plan: CaratPlan = {
    id: 'carat-layout-test-plan',
    name: 'Layout test plan',
    createdAt: 0,
    updatedAt: 0,
    settings: { ...defaultCaratSettings, startingFreeCarats: 24500, trackPaidCarats: false },
    plannedBanners,
    paidPurchases: {},
    selectorChoices: {}
  };

  localStorage.clear();
  useCaratStore.setState({ plans: [plan], activePlanId: plan.id });
  localStorage.clear();
}

// jsdom's matchMedia never matches, which would pin every test to the narrow
// card branch. Answer min-width queries from the faked viewport instead.
function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const minWidth = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
      return {
        matches: width >= minWidth,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {}
      };
    }
  });
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <TutorialProvider>
        <CaratCalculatorPage />
      </TutorialProvider>
    </QueryClientProvider>
  );
}

function bandTrigger() {
  return screen.getByRole('button', { name: /Plan assumptions/ });
}

describe('carat planner layout', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock
    });
    setViewport(1200);
    fetchTimelineMock.mockReset();
    fetchTimelineMock.mockResolvedValue(timeline());
    resetPlanAssumptionsBand();
    resetStore();
    markVisited('carat-calculator');
  });

  afterEach(() => {
    cleanup();
    resetPlanAssumptionsBand();
    resetStore();
    localStorage.clear();
    setViewport(1024);
  });

  // The structural contract that makes page-level horizontal overflow impossible:
  // a flexible container that can shrink below its content, wrapping a container
  // that scrolls instead. See design.md Decision 7.
  it('lets the plan shrink below its content so the plan scrolls instead of the page', async () => {
    const { container } = renderPage();
    await screen.findByRole('table');

    const planner = container.querySelector('[data-tutorial="carat-planner"]');
    expect(planner).not.toBeNull();
    expect(planner).toHaveClass('min-w-0');
    expect(planner?.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  it('renders the assumptions band, the statistics strip, and the plan in that order', async () => {
    const { container } = renderPage();
    await screen.findByRole('button', { name: '+ Add banner from timeline' });

    const parts = Array.from(
      container.querySelectorAll(
        '[data-tutorial="carat-assumptions"],[data-tutorial="carat-summary"],[data-tutorial="carat-planner"]'
      )
    ).map((element) => (element as HTMLElement).dataset.tutorial);

    expect(parts).toEqual(['carat-assumptions', 'carat-summary', 'carat-planner']);
  });

  it('opens the assumptions band collapsed and summarizes what it hides', async () => {
    renderPage();
    await screen.findByRole('button', { name: '+ Add banner from timeline' });

    const trigger = bandTrigger();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('24,500 starting carats');
    expect(trigger).toHaveTextContent(/\d+ income sources?/);
    expect(trigger).toHaveTextContent(/\d+ reward sources?/);
    expect(screen.queryByRole('tab', { name: 'Balance' })).not.toBeInTheDocument();
  });

  it('shows one group at a time once expanded', async () => {
    renderPage();
    await screen.findByRole('button', { name: '+ Add banner from timeline' });

    fireEvent.click(bandTrigger());

    expect(screen.getByRole('tab', { name: 'Balance' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('spinbutton', { name: 'Free carats' })).toBeInTheDocument();
    expect(screen.queryByText('Income & Settings')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Income' }));

    expect(screen.getByText('Income & Settings')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Free carats' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }));

    expect(screen.getByText(/counted automatically/)).toBeInTheDocument();
    expect(screen.queryByText('Income & Settings')).not.toBeInTheDocument();
  });

  it('reports the new starting total in the collapsed summary after an edit', async () => {
    renderPage();
    await screen.findByRole('button', { name: '+ Add banner from timeline' });

    fireEvent.click(bandTrigger());
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Free carats' }), {
      target: { value: '31000' }
    });
    fireEvent.click(bandTrigger());

    const trigger = bandTrigger();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('31,000 starting carats');
  });

  it('updates the projection when starting resources change in the Balance group', async () => {
    resetStore([plannedBanner()]);
    renderPage();
    await screen.findByRole('button', { name: '+ Add banner from timeline' });

    // 24,500 carats against a 200-pull (30,000 carat) banner that has already started.
    expect(await screen.findByText('Short')).toBeInTheDocument();

    fireEvent.click(bandTrigger());
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Free carats' }), {
      target: { value: '90000' }
    });

    expect(screen.queryByText('Short')).not.toBeInTheDocument();
    expect(screen.getByText('Affordable ✓')).toBeInTheDocument();
  });
});
