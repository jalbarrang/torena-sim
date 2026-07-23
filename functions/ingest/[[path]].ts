import { proxyPostHogRequest } from '../../src/modules/observability/posthog-proxy';

declare const caches: { default: Cache };

type PagesContext = {
  request: Request;
  waitUntil(promise: Promise<unknown>): void;
};

export function onRequest(context: PagesContext) {
  return proxyPostHogRequest(
    context.request,
    { api: 'https://us.i.posthog.com', assets: 'https://us-assets.i.posthog.com' },
    { fetch, cache: caches.default, waitUntil: context.waitUntil.bind(context) }
  );
}
