/**
 * Guard against the inlined-dataset regression.
 *
 * The WASM web workers must stay data-free: all skill/uma/support data is
 * resolved on the main thread and passed in via `postMessage` (see the
 * `*-plan` / `*-context` builders). If a worker module ever transitively imports
 * `@/modules/data/**` again, the bundler re-inlines the ~4.7MB of JSON into
 * every worker chunk — which is exactly what blew the bundles up to ~3.6MB each
 * and slowed the deploy.
 *
 * This check runs after `vite build` and fails if any `dist/assets/*worker*.js`
 * (a) contains a known dataset string, or (b) exceeds the size budget. Probe
 * strings are read from the JSON at runtime so they never go stale.
 *
 * Run:  pnpm run check:worker-bundles   (after `pnpm run build`)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(repoRoot, 'dist', 'assets');

// Workers carry only the WASM glue + reducer math; anything close to this means
// a dataset (or another heavy module) leaked back into the graph.
const MAX_WORKER_BYTES = 600 * 1024;

/** Pull a couple of stable names from the datasets to probe for inlined JSON. */
function loadProbes(): Array<string> {
  const probes = new Set<string>();
  const pick = (relPath: string, count: number) => {
    try {
      const json = JSON.parse(readFileSync(join(repoRoot, relPath), 'utf8')) as Record<
        string,
        { name?: string }
      >;
      for (const entry of Object.values(json)) {
        if (entry?.name && entry.name.length > 4) {
          probes.add(entry.name);
          if ([...probes].length >= count) break;
        }
      }
    } catch {
      // dataset missing/renamed — skip; size budget still applies
    }
  };
  pick('src/modules/data/json/skills.json', 3);
  pick('src/modules/data/json/support-cards.json', 3);
  return [...probes];
}

function main(): void {
  let workers: Array<string>;
  try {
    workers = readdirSync(assetsDir).filter((f) => f.includes('worker') && f.endsWith('.js'));
  } catch {
    console.error(`[check-worker-bundles] ${assetsDir} not found — run \`pnpm run build\` first.`);
    process.exit(1);
  }

  if (workers.length === 0) {
    console.error('[check-worker-bundles] no worker bundles found in dist/assets.');
    process.exit(1);
  }

  const probes = loadProbes();
  const violations: Array<string> = [];

  for (const file of workers) {
    const fullPath = join(assetsDir, file);
    const bytes = statSync(fullPath).size;
    const content = readFileSync(fullPath, 'utf8');

    if (bytes > MAX_WORKER_BYTES) {
      violations.push(
        `${file}: ${(bytes / 1024).toFixed(0)}KB exceeds ${(MAX_WORKER_BYTES / 1024).toFixed(0)}KB budget (dataset leak?)`
      );
    }

    const hit = probes.find((probe) => content.includes(probe));
    if (hit) {
      violations.push(
        `${file}: contains dataset string "${hit}" — a worker re-imported the data layer`
      );
    }
  }

  if (violations.length > 0) {
    console.error('[check-worker-bundles] FAILED:');
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      '\nWorkers must stay data-free. Resolve data on the main thread (see the *-plan / *-context builders) and pass it via postMessage.'
    );
    process.exit(1);
  }

  console.log(
    `[check-worker-bundles] OK — ${workers.length} worker bundles data-free, all under ${(MAX_WORKER_BYTES / 1024).toFixed(0)}KB (probes: ${probes.length}).`
  );
}

main();
