/**
 * Turnstile tokens are single-use, but a single screenshot import makes N sequential
 * worker calls (one per uploaded image). This broker bridges the widget (which delivers
 * tokens) and the OCR engine (which consumes one per request):
 *
 * - The widget calls `deliver` on verify and `invalidate` on expire/error.
 * - The engine calls `consume` per request. It takes the stashed token and immediately
 *   triggers the widget's `reset` so a fresh token is minted while the current Gemini
 *   call is in flight. If no token is stashed yet, it awaits the next `deliver`.
 */

const CONSUME_TIMEOUT_MS = 30_000;

export type TurnstileBroker = {
  /** Widget onVerify — stash a token or hand it to a waiting consumer. */
  deliver: (token: string) => void;
  /** Widget onExpire/onError — drop the stashed token. */
  invalidate: () => void;
  /** Wire the widget's imperative reset so the broker can mint fresh tokens. */
  attachReset: (reset: (() => void) | null) => void;
  /** Take a token for one worker request; awaits the next verify if none is ready. */
  consume: () => Promise<string>;
};

export function createTurnstileBroker(): TurnstileBroker {
  let stashed: string | null = null;
  let resetWidget: (() => void) | null = null;
  const waiters: Array<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  return {
    deliver(token) {
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(token);
        // A consumer took this token; mint the next one for the following request.
        resetWidget?.();
        return;
      }
      stashed = token;
    },

    invalidate() {
      stashed = null;
    },

    attachReset(reset) {
      resetWidget = reset;
    },

    consume() {
      if (stashed) {
        const token = stashed;
        stashed = null;
        // Mint the next token now so it's ready by the time the next request runs.
        resetWidget?.();
        return Promise.resolve(token);
      }

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((w) => w.timer === timer);
          if (index !== -1) waiters.splice(index, 1);
          reject(new Error('Verification timed out. Complete the check and try again.'));
        }, CONSUME_TIMEOUT_MS);

        waiters.push({ resolve, reject, timer });
      });
    }
  };
}
