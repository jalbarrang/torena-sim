/**
 * Turnstile tokens are single-use, but a single screenshot import makes N sequential
 * worker calls (one per uploaded image). This broker bridges the widget (which delivers
 * tokens) and the OCR engine (which consumes one per request):
 *
 * - The widget calls `deliver` on verify and `invalidate` on expire/error.
 * - A dialog calls `cancel` on close so abandoned token waiters cannot leak into a new session.
 * - The engine calls `consume` per request. It takes the stashed token and immediately
 *   triggers the widget's `reset` so a fresh token is minted while the current Gemini
 *   call is in flight. If no token is stashed yet, it awaits the next `deliver`.
 */

const CONSUME_TIMEOUT_MS = 30_000;

type TurnstileBrokerErrorCode = 'cancelled' | 'timeout';

class TurnstileBrokerError extends Error {
  readonly code: TurnstileBrokerErrorCode;

  constructor(code: TurnstileBrokerErrorCode, message: string) {
    super(message);
    this.name = 'TurnstileBrokerError';
    this.code = code;
  }
}

export type TurnstileBroker = {
  /** Widget onVerify — stash a token or hand it to a waiting consumer. */
  deliver: (token: string) => void;
  /** Widget onExpire/onError — drop the stashed token. */
  invalidate: () => void;
  /** Cancel pending consumers when an import session closes. */
  cancel: () => void;
  /** Wire the widget's imperative reset so the broker can mint fresh tokens. */
  attachReset: (reset: (() => void) | null) => void;
  /** Observe whether an unconsumed token is currently available. */
  subscribe: (listener: (available: boolean) => void) => () => void;
  /** Take a token for one worker request; awaits the next verify if none is ready. */
  consume: () => Promise<string>;
};

export function createTurnstileBroker(): TurnstileBroker {
  let stashed: string | null = null;
  let resetWidget: (() => void) | null = null;
  const listeners = new Set<(available: boolean) => void>();
  const waiters: Array<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  const setStashed = (token: string | null) => {
    const wasAvailable = stashed !== null;
    stashed = token;
    const isAvailable = stashed !== null;
    if (isAvailable !== wasAvailable) {
      for (const listener of listeners) listener(isAvailable);
    }
  };

  return {
    deliver(token) {
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(token);
        // The delivered token was consumed immediately. Keep availability false
        // while the widget mints the following request's token.
        resetWidget?.();
        return;
      }
      setStashed(token);
    },

    invalidate() {
      setStashed(null);
    },

    cancel() {
      setStashed(null);
      const error = new TurnstileBrokerError('cancelled', 'Screenshot import was cancelled.');
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    },

    attachReset(reset) {
      resetWidget = reset;
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(stashed !== null);
      return () => listeners.delete(listener);
    },

    consume() {
      if (stashed) {
        const token = stashed;
        setStashed(null);
        // Mint the next token now so it's ready by the time the next request runs.
        resetWidget?.();
        return Promise.resolve(token);
      }

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index !== -1) waiters.splice(index, 1);
          reject(
            new TurnstileBrokerError(
              'timeout',
              'Verification timed out. Complete the check and try again.'
            )
          );
        }, CONSUME_TIMEOUT_MS);

        waiters.push({ resolve, reject, timer });
      });
    }
  };
}
