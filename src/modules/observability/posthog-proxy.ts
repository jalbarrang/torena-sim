type PostHogHosts = {
  api: string;
  assets: string;
};

type ProxyDependencies = {
  fetch: (request: Request) => Promise<Response>;
  cache?: Pick<Cache, 'match' | 'put'>;
  waitUntil?: (promise: Promise<unknown>) => void;
};

const BASE_PATH = '/ingest';

// PostHog serves its SDK assets and remote config from a separate host; only
// `/static/*` and `/array/*` go there. Everything else (events, flags, decide)
// goes to the ingestion API host.
function isAssetPath(path: string): boolean {
  return path.startsWith('/static/') || path.startsWith('/array/');
}

function targetPath(pathname: string): string {
  const rest = pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname;
  return rest || '/';
}

/**
 * Forward a same-origin `/ingest/*` request to PostHog, mirroring PostHog's
 * official Cloudflare Worker: build a string target, copy headers into a fresh
 * mutable `Headers`, materialize the body, and preserve the client IP. Written
 * against standard web APIs only (no Cloudflare globals) so it is unit-testable
 * and free of runtime-specific footguns.
 */
export async function proxyPostHogRequest(
  request: Request,
  hosts: PostHogHosts,
  dependencies: ProxyDependencies
): Promise<Response> {
  const url = new URL(request.url);
  const path = targetPath(url.pathname);
  const asset = isAssetPath(path);
  const target = `${asset ? hosts.assets : hosts.api}${path}${url.search}`;
  const cacheable = asset && request.method === 'GET' && Boolean(dependencies.cache);

  if (cacheable) {
    const cached = await dependencies.cache!.match(request);
    if (cached) return cached;
  }

  const headers = new Headers(request.headers);
  headers.delete('cookie');
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) headers.set('X-Forwarded-For', clientIp);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const forwarded = new Request(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual'
  });

  const response = await dependencies.fetch(forwarded);

  if (cacheable) {
    const write = dependencies.cache!.put(request, response.clone());
    if (dependencies.waitUntil) dependencies.waitUntil(write);
    else await write;
  }

  return response;
}
