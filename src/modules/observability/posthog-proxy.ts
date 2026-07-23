type PostHogHosts = {
  api: string;
  assets: string;
};

type ProxyDependencies = {
  fetch: (request: Request) => Promise<Response>;
  cache?: Pick<Cache, 'match' | 'put'>;
  waitUntil?: (promise: Promise<unknown>) => void;
};

function proxyPath(pathname: string) {
  return pathname.replace(/^\/ingest(?:\/|$)/, '/') || '/';
}

export async function proxyPostHogRequest(
  request: Request,
  hosts: PostHogHosts,
  dependencies: ProxyDependencies
) {
  const input = new URL(request.url);
  const path = proxyPath(input.pathname);
  const isAsset = path.startsWith('/static/') || path.startsWith('/array/');
  const target = new URL(path, isAsset ? hosts.assets : hosts.api);
  target.search = input.search;

  if (isAsset && request.method === 'GET' && dependencies.cache) {
    const cached = await dependencies.cache.match(request);
    if (cached) return cached;
  }

  const proxied = new Request(target, request);
  proxied.headers.delete('cookie');
  proxied.headers.delete('host');
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) proxied.headers.set('X-Forwarded-For', clientIp);

  const response = await dependencies.fetch(proxied);
  if (isAsset && request.method === 'GET' && dependencies.cache) {
    const cacheWrite = dependencies.cache.put(request, response.clone());
    if (dependencies.waitUntil) dependencies.waitUntil(cacheWrite);
    else await cacheWrite;
  }

  return response;
}
