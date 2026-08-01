import posthog from 'posthog-js';
import { sanitizePostHogEvent } from './posthog-event-sanitizer';

type PostHogSetup = {
  key: string;
  host?: string;
  uiHost?: string;
};

type DeploymentContext = {
  appName: string;
  appVersion: string;
  environment: string;
};

export function initializePostHog(setup: PostHogSetup) {
  posthog.init(setup.key, {
    api_host: setup.host,
    ui_host: setup.uiHost,
    defaults: '2026-01-30',
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false
    },
    error_tracking: {
      exception_steps: { enabled: true }
    },
    before_send: sanitizePostHogEvent,
    // OCR review surfaces can contain filenames and recognized text. Keep analytics
    // event-only: no DOM autocapture and no session replay, even after consent.
    autocapture: false,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_capture_url_hashes: true,
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: true,
    respect_dnt: true
  });
}

export function grantPostHogConsent(context: DeploymentContext) {
  posthog.opt_in_capturing();
  posthog.register({
    app_name: context.appName,
    app_version: context.appVersion,
    app_environment: context.environment
  });
}

export function denyPostHogConsent() {
  posthog.opt_out_capturing();
}

export function recordPostHogRoute(route: string) {
  posthog.register_for_session({ app_route: route });
  posthog.addExceptionStep('route_changed', { route });
}

export const posthogClient = posthog;
