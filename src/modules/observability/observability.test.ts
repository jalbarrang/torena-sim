// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  denyPostHogConsent,
  grantPostHogConsent,
  initializePostHog,
  recordPostHogRoute
} from './posthog-adapter';
import {
  denyObservabilityConsent,
  grantObservabilityConsent,
  initializeObservability,
  recordObservabilityRoute
} from './observability';
import { useObservabilityConsentStore } from './observability-consent.store';

const testConfig = vi.hoisted(() => ({
  posthog: { key: 'phc_test', host: 'https://us.i.posthog.com' }
}));

vi.mock('@/config', () => ({ config: testConfig }));

vi.mock('./posthog-adapter', () => ({
  denyPostHogConsent: vi.fn(),
  grantPostHogConsent: vi.fn(),
  initializePostHog: vi.fn(),
  recordPostHogRoute: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
  useObservabilityConsentStore.setState({ consent: null });
  testConfig.posthog.key = 'phc_test';
  localStorage.clear();
});

describe('observability', () => {
  it('initializes PostHog and restores granted consent', () => {
    useObservabilityConsentStore.setState({ consent: 'granted' });

    initializeObservability();

    expect(initializePostHog).toHaveBeenCalledWith({
      key: 'phc_test',
      host: 'https://us.i.posthog.com'
    });
    expect(grantPostHogConsent).toHaveBeenCalledWith(
      expect.objectContaining({ appName: 'torena-sim' })
    );
  });

  it('owns consent transitions and their telemetry effects', () => {
    grantObservabilityConsent();
    expect(useObservabilityConsentStore.getState().consent).toBe('granted');
    expect(grantPostHogConsent).toHaveBeenCalledOnce();
    expect(recordPostHogRoute).toHaveBeenCalledWith('/');

    denyObservabilityConsent();
    expect(useObservabilityConsentStore.getState().consent).toBe('denied');
    expect(denyPostHogConsent).toHaveBeenCalledOnce();
  });

  it('records routes only for configured, consenting visitors', () => {
    recordObservabilityRoute('/skills');
    expect(recordPostHogRoute).not.toHaveBeenCalled();

    useObservabilityConsentStore.setState({ consent: 'granted' });
    recordObservabilityRoute('/skills');
    expect(recordPostHogRoute).toHaveBeenCalledWith('/skills');
  });

  it('stays inert when observability is not configured', () => {
    testConfig.posthog.key = '';

    initializeObservability();
    grantObservabilityConsent();

    expect(initializePostHog).not.toHaveBeenCalled();
    expect(grantPostHogConsent).not.toHaveBeenCalled();
    expect(useObservabilityConsentStore.getState().consent).toBe('granted');
  });
});
