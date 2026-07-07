import { envString, envBoolean } from './env';

export type AppConfig = {
  basePath: string;
  reactScan: boolean;
  enableGrab: boolean;
  posthog: {
    key?: string;
    host?: string;
  };
  suggestions: {
    workerUrl?: string;
    turnstileSiteKey?: string;
  };
  timeline: {
    workerUrl?: string;
  };
  ocr: {
    workerUrl?: string;
    turnstileSiteKey?: string;
  };
};

export const config: AppConfig = {
  basePath: envString('VITE_BASE_PATH', '/'),
  reactScan: envBoolean('VITE_REACT_SCAN', false),
  enableGrab: envBoolean('VITE_ENABLE_GRAB', false),
  posthog: {
    key: envString('VITE_PUBLIC_POSTHOG_KEY'),
    host: envString('VITE_PUBLIC_POSTHOG_HOST')
  },
  suggestions: {
    workerUrl: envString('VITE_SUGGESTION_WORKER_URL'),
    turnstileSiteKey: envString('VITE_TURNSTILE_SITE_KEY')
  },
  timeline: {
    workerUrl: envString('VITE_TIMELINE_WORKER_URL')
  },
  ocr: {
    workerUrl: envString('VITE_OCR_WORKER_URL'),
    turnstileSiteKey: envString('VITE_TURNSTILE_SITE_KEY')
  }
};
