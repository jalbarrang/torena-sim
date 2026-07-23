import type { CaptureResult, Properties } from 'posthog-js';

const URL_PROPERTY_NAMES = [
  '$current_url',
  '$initial_current_url',
  '$session_entry_url',
  '$referrer',
  '$initial_referrer',
  '$external_click_url'
] as const;

function stripUrlDetails(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    const separatorIndex = value.search(/[?#]/u);
    return separatorIndex === -1 ? value : value.slice(0, separatorIndex);
  }
}

function sanitizeUrlProperties(properties: Properties | undefined): Properties | undefined {
  if (!properties) {
    return properties;
  }

  const sanitized = { ...properties };
  for (const propertyName of URL_PROPERTY_NAMES) {
    if (propertyName in sanitized) {
      sanitized[propertyName] = stripUrlDetails(sanitized[propertyName]);
    }
  }
  return sanitized;
}

export function sanitizePostHogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) {
    return null;
  }

  return {
    ...event,
    properties: sanitizeUrlProperties(event.properties) ?? {},
    $set: sanitizeUrlProperties(event.$set),
    $set_once: sanitizeUrlProperties(event.$set_once)
  };
}
