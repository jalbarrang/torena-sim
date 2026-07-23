// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordObservabilityRoute } from './observability';
import { ObservabilityRouteTracker } from './observability-route-tracker';

vi.mock('./observability', () => ({
  recordObservabilityRoute: vi.fn()
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function NavigationControl() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/skills?filter=secret')}>Navigate</button>;
}

describe('ObservabilityRouteTracker', () => {
  it('records privacy-safe pathnames after initial render and navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/race-sim/results?share=secret']}>
        <ObservabilityRouteTracker />
        <NavigationControl />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(recordObservabilityRoute).toHaveBeenCalledWith('/race-sim/results');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));

    await waitFor(() => {
      expect(recordObservabilityRoute).toHaveBeenLastCalledWith('/skills');
    });
  });
});
