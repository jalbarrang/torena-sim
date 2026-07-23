import { config } from '@/config';
import {
  denyPostHogConsent,
  grantPostHogConsent,
  initializePostHog,
  recordPostHogRoute
} from './posthog-adapter';
import {
  setObservabilityConsent,
  useObservabilityConsentStore
} from './observability-consent.store';

const deploymentContext = {
  appName: 'torena-sim',
  appVersion: __APP__VERSION__,
  environment: import.meta.env.MODE
};

function isConfigured() {
  return Boolean(config.posthog.key);
}

export function initializeObservability() {
  if (!config.posthog.key) {
    return;
  }

  initializePostHog({ key: config.posthog.key, host: config.posthog.host });

  if (useObservabilityConsentStore.getState().consent === 'granted') {
    grantPostHogConsent(deploymentContext);
  }
}

export function grantObservabilityConsent() {
  setObservabilityConsent('granted');
  if (isConfigured()) {
    grantPostHogConsent(deploymentContext);
    recordPostHogRoute(globalThis.location.pathname);
  }
}

export function denyObservabilityConsent() {
  setObservabilityConsent('denied');
  if (isConfigured()) {
    denyPostHogConsent();
  }
}

export function recordObservabilityRoute(route: string) {
  if (isConfigured() && useObservabilityConsentStore.getState().consent === 'granted') {
    recordPostHogRoute(route);
  }
}

export function useObservabilityConsent() {
  const consent = useObservabilityConsentStore((state) => state.consent);

  return {
    configured: isConfigured(),
    consent,
    grantConsent: grantObservabilityConsent,
    denyConsent: denyObservabilityConsent
  };
}
