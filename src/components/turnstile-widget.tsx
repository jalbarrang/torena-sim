import { memo, useEffect, useRef, type RefObject } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      size?: 'normal' | 'flexible' | 'compact';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      'timeout-callback'?: () => void;
    }
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  // A script with our ID but no API and no active promise is left over from a
  // failed or incomplete load. Remove it so this attempt receives fresh events.
  document.getElementById(SCRIPT_ID)?.remove();

  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const rejectLoad = () => {
      script.remove();
      reject(new Error('Turnstile failed to load'));
    };

    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      if (!window.turnstile) {
        rejectLoad();
        return;
      }
      resolve();
    });
    script.addEventListener('error', rejectLoad);
    document.head.append(script);
  });

  const retryable = pending.catch((error: unknown) => {
    scriptPromise = null;
    throw error;
  });
  scriptPromise = retryable;
  return retryable;
}

/** Imperative handle callers can use to mint a fresh token (tokens are single-use). */
export type TurnstileApiHandle = {
  reset: () => void;
};

type TurnstileWidgetSize = 'normal' | 'flexible' | 'compact';

type TurnstileWidgetProps = {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  onTimeout?: () => void;
  theme?: 'auto' | 'light' | 'dark';
  size?: TurnstileWidgetSize;
  className?: string;
  apiRef?: RefObject<TurnstileApiHandle | null>;
};

function TurnstileWidgetImpl(props: TurnstileWidgetProps) {
  const {
    siteKey,
    onVerify,
    onExpire,
    onError,
    onTimeout,
    theme = 'auto',
    size = 'normal',
    className,
    apiRef
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);

  // Mirror the latest callbacks/apiRef into refs so the render effect below can
  // stay keyed to widget configuration only — the widget is created once and never
  // torn down when these change. Updated in an effect (not during render).
  const apiRefHolder = useRef(apiRef);
  const callbacks = useRef({ onVerify, onExpire, onError, onTimeout });
  useEffect(() => {
    apiRefHolder.current = apiRef;
    callbacks.current = { onVerify, onExpire, onError, onTimeout };
  });

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          size,
          callback: (token) => callbacks.current.onVerify(token),
          'expired-callback': () => callbacks.current.onExpire?.(),
          'error-callback': () => callbacks.current.onError?.(),
          'timeout-callback': () => callbacks.current.onTimeout?.()
        });

        if (apiRefHolder.current) {
          apiRefHolder.current.current = {
            reset: () => window.turnstile?.reset(widgetId)
          };
        }
      })
      .catch(() => callbacks.current.onError?.());

    return () => {
      cancelled = true;
      if (apiRefHolder.current) {
        apiRefHolder.current.current = null;
      }
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [siteKey, size, theme]);

  return <div ref={containerRef} className={className} />;
}

/**
 * Memoized so the widget is rendered exactly once (Cloudflare's explicit-render
 * model). Callers MUST pass stable props — wrap callbacks in `useCallback` — so
 * frequent parent re-renders (e.g. upload progress) never reach the iframe.
 */
export const TurnstileWidget = memo(TurnstileWidgetImpl);
