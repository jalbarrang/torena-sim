/**
 * Run `hiker check` over every intent spec in .hiker/tents/.
 * (hiker v0.1.1 checks single files only; this provides the glob.)
 *
 * Usage: bun run intent
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const tentsDir = '.hiker/tents';
const tents: Array<string> = [];

for (const entry of readdirSync(tentsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  for (const file of readdirSync(join(tentsDir, entry.name))) {
    if (file.endsWith('.tent')) tents.push(join(tentsDir, entry.name, file));
  }
}

if (tents.length === 0) {
  console.error(`No .tent files found under ${tentsDir}`);
  process.exit(1);
}

let failed = false;
for (const tent of tents) {
  const result = spawnSync('hiker', ['check', tent], { stdio: 'pipe', shell: true });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  console.log(`${tent}: ${out}`);
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
