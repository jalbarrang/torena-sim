import posthog from 'posthog-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  denyPostHogConsent,
  grantPostHogConsent,
  initializePostHog,
  recordPostHogRoute
} from './posthog-adapter';
import { sanitizePostHogEvent } from './posthog-event-sanitizer';

vi.mock('posthog-js', () => ({
  default: {
    addExceptionStep: vi.fn(),
    init: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    register: vi.fn(),
    register_for_session: vi.fn()
  }
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('PostHog observability adapter', () => {
  it('configures privacy-safe exception capture', () => {
    initializePostHog({
      key: 'phc_test',
      host: 'https://us.i.posthog.com',
      uiHost: 'https://us.posthog.com'
    });

    expect(posthog.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://us.i.posthog.com',
        ui_host: 'https://us.posthog.com',
        capture_exceptions: {
          capture_unhandled_errors: true,
          capture_unhandled_rejections: true,
          capture_console_errors: false
        },
        before_send: sanitizePostHogEvent,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true
      })
    );
  });

  it('translates consent and route operations to PostHog', () => {
    grantPostHogConsent({
      appName: 'torena-sim',
      appVersion: '1.2.3+abc123',
      environment: 'production'
    });
    recordPostHogRoute('/race-sim/results');
    denyPostHogConsent();

    expect(posthog.opt_in_capturing).toHaveBeenCalledOnce();
    expect(posthog.register).toHaveBeenCalledWith({
      app_name: 'torena-sim',
      app_version: '1.2.3+abc123',
      app_environment: 'production'
    });
    expect(posthog.register_for_session).toHaveBeenCalledWith({
      app_route: '/race-sim/results'
    });
    expect(posthog.addExceptionStep).toHaveBeenCalledWith('route_changed', {
      route: '/race-sim/results'
    });
    expect(posthog.opt_out_capturing).toHaveBeenCalledOnce();
  });
});
