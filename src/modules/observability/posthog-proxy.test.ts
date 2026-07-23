import { describe, expect, it, vi } from 'vitest';
import { proxyPostHogRequest } from './posthog-proxy';

const hosts = { api: 'https://us.i.posthog.com', assets: 'https://us-assets.i.posthog.com' };

function dependencies(cached?: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(
    async () => new Response('upstream')
  );
  const cache = {
    match: vi.fn(async () => cached),
    put: vi.fn(async () => undefined)
  };
  const waitUntil = vi.fn();

  return { fetch, cache, waitUntil };
}

describe('proxyPostHogRequest', () => {
  it('forwards events to the API host without cookies', async () => {
    const deps = dependencies();
    const request = new Request('https://app.example/ingest/e/', {
      method: 'POST',
      body: 'event',
      headers: { cookie: 'session=secret', 'CF-Connecting-IP': '203.0.113.7' }
    });

    await proxyPostHogRequest(request, hosts, deps);

    const forwarded = deps.fetch.mock.calls[0][0];
    expect(forwarded.url).toBe('https://us.i.posthog.com/e/');
    expect(forwarded.method).toBe('POST');
    expect(await forwarded.text()).toBe('event');
    expect(forwarded.headers.get('cookie')).toBeNull();
    expect(forwarded.headers.get('X-Forwarded-For')).toBe('203.0.113.7');
    expect(forwarded.headers.get('host')).toBeNull();
  });

  it('proxies and caches static assets', async () => {
    const deps = dependencies();

    await proxyPostHogRequest(
      new Request('https://app.example/ingest/static/array.js'),
      hosts,
      deps
    );

    expect(deps.fetch.mock.calls[0][0].url).toBe('https://us-assets.i.posthog.com/static/array.js');
    expect(deps.cache.put).toHaveBeenCalledOnce();
    expect(deps.waitUntil).toHaveBeenCalledOnce();
  });

  it('serves a cached asset without fetching upstream', async () => {
    const deps = dependencies(new Response('cached'));
    const response = await proxyPostHogRequest(
      new Request('https://app.example/ingest/array/config.js'),
      hosts,
      deps
    );

    expect(await response.text()).toBe('cached');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('preserves query strings', async () => {
    const deps = dependencies();

    await proxyPostHogRequest(
      new Request('https://app.example/ingest/decide/?v=2&token=a'),
      hosts,
      deps
    );

    expect(deps.fetch.mock.calls[0][0].url).toBe('https://us.i.posthog.com/decide/?v=2&token=a');
  });
});
