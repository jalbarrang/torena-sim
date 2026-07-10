// vite/vitest inject import.meta.env; Node-run CLI scripts (tsx) fall back to process.env
const env = import.meta.env ?? process.env;

const appEnv: Record<string, string | undefined> = {
  VITE_BASE_PATH: env.VITE_BASE_PATH,

  VITE_REACT_SCAN: env.VITE_REACT_SCAN ?? 'false',
  VITE_ENABLE_GRAB: env.VITE_ENABLE_GRAB ?? 'false',
  VITE_PUBLIC_POSTHOG_KEY: env.VITE_PUBLIC_POSTHOG_KEY,
  VITE_PUBLIC_POSTHOG_HOST: env.VITE_PUBLIC_POSTHOG_HOST,
  VITE_SUGGESTION_WORKER_URL: env.VITE_SUGGESTION_WORKER_URL,
  VITE_TURNSTILE_SITE_KEY: env.VITE_TURNSTILE_SITE_KEY,
  VITE_TURNSTILE_SITE_KEY_OCR: env.VITE_TURNSTILE_SITE_KEY_OCR,
  VITE_TIMELINE_WORKER_URL: env.VITE_TIMELINE_WORKER_URL,
  VITE_OCR_WORKER_URL: env.VITE_OCR_WORKER_URL
};

function isNotBlank(str: string = ''): boolean {
  return !/^\s*$/.test(str);
}

export function envString(name: string, defaultValue = ''): string {
  let val = null;
  if (typeof localStorage !== 'undefined') {
    val = localStorage.getItem(name);
  }
  val = val ?? appEnv[name];

  return isNotBlank(val) ? String(val) : defaultValue;
}

export function envBoolean(name: string, defaultValue: boolean = false): boolean {
  const val = envString(name, '');

  if (['true', '1'].includes(val)) return true;
  if (['false', '0'].includes(val)) return false;

  return defaultValue;
}

function envNumber(name: string, defaultValue: number = 0): number {
  const val = envString(name, '');

  if (val == '') return defaultValue;
  const n = Number(val);

  return !Number.isNaN(n) ? n : defaultValue;
}

function setEnv(key: string, value: string | number | boolean) {
  localStorage.setItem(key, String(value));
}

function deleteEnv(key: string) {
  localStorage.removeItem(key);
}
