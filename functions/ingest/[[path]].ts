import { proxyPostHogRequest } from '../../src/modules/observability/posthog-proxy';

declare const caches: { default: Cache };

type PagesContext = {
  request: Request;
  waitUntil(promise: Promise<unknown>): void;
};

export async function onRequest(context: PagesContext) {
  try {
    return await proxyPostHogRequest(
      context.request,
      { api: 'https://us.i.posthog.com', assets: 'https://us-assets.i.posthog.com' },
      {
        fetch: (request) => fetch(request),
        cache: caches.default,
        waitUntil: (promise) => context.waitUntil(promise)
      }
    );
  } catch (error) {
    console.error('posthog-proxy failed', error);
    return new Response('posthog proxy error', { status: 502 });
  }
}
