import { useEffect, useRef, type RefObject } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const SCRIPT_ID = 'cf-turnstile-script';

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
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

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Turnstile failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Turnstile failed to load')));
    document.head.append(script);
  });

  return scriptPromise;
}

/** Imperative handle callers can use to mint a fresh token (tokens are single-use). */
export type TurnstileApiHandle = {
  reset: () => void;
};

type TurnstileWidgetProps = {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
  apiRef?: RefObject<TurnstileApiHandle | null>;
};

export function TurnstileWidget(props: TurnstileWidgetProps) {
  const { siteKey, onVerify, onExpire, onError, theme = 'auto', className, apiRef } = props;

  // Keep the latest apiRef without re-rendering the widget.
  const apiRefHolder = useRef(apiRef);
  apiRefHolder.current = apiRef;

  const containerRef = useRef<HTMLDivElement>(null);

  // Keep latest callbacks without re-rendering the widget.
  const callbacks = useRef({ onVerify, onExpire, onError });
  callbacks.current = { onVerify, onExpire, onError };

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          callback: (token) => callbacks.current.onVerify(token),
          'expired-callback': () => callbacks.current.onExpire?.(),
          'error-callback': () => callbacks.current.onError?.()
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
  }, [siteKey, theme]);

  return <div ref={containerRef} className={className} />;
}
