/**
 * Build the `uma-sim-wasm` crate and emit the wasm-pack `--target web` bundle
 * into the app at `src/lib/uma-sim-wasm/pkg`.
 *
 * Cross-platform (PowerShell, cmd, bash, macOS/Linux) — run via `pnpm run wasm:build`.
 *
 * IMPORTANT: the default `cargo` on some machines is a standalone (non-rustup)
 * install that lacks the wasm32 std. We force the rustup `stable` toolchain
 * (which has `wasm32-unknown-unknown` installed) onto PATH so `wasm-pack` /
 * `cargo` resolve to it.
 *
 * Prereqs:
 *   rustup target add wasm32-unknown-unknown
 *   cargo install wasm-pack      # or: cargo binstall wasm-pack
 */
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const crateDir = join(repoRoot, 'packages', 'uma-sim-wasm');
const outDir = join(repoRoot, 'src', 'lib', 'uma-sim-wasm', 'pkg');

/** Resolve a command on PATH (using the given env), or `null` if missing. */
function which(cmd: string, env: NodeJS.ProcessEnv): string | null {
  const finder = isWin ? 'where' : 'which';
  const res = spawnSync(finder, [cmd], { encoding: 'utf8', env, shell: isWin });
  if (res.status !== 0 || !res.stdout) {
    return null;
  }
  return res.stdout.split(/\r?\n/, 1)[0]?.trim() || null;
}

const env: NodeJS.ProcessEnv = { ...process.env };

// The spread above loses Node's case-insensitive env magic: on Windows the
// real key is often `Path`, so writing `env.PATH` would create a SECOND key
// holding only the sysroot bin — and the child's effective PATH loses
// System32 entirely. Mutate the existing key, whatever its casing.
const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';

// Prefer the rustup `stable` toolchain (has wasm32 std) by prepending its bin
// dir to PATH. `rustc --print sysroot` returns a native path on every platform,
// so no Windows/git-bash `cygpath` dance is needed (this runs as a native
// Node process, not inside a POSIX shell).
if (which('rustup', env)) {
  const res = spawnSync('rustup', ['run', 'stable', 'rustc', '--print', 'sysroot'], {
    encoding: 'utf8',
    shell: isWin
  });
  const sysroot = res.status === 0 ? res.stdout.trim() : '';
  if (sysroot) {
    env[pathKey] = `${join(sysroot, 'bin')}${delimiter}${env[pathKey] ?? ''}`;
  }
}

if (!which('wasm-pack', env)) {
  console.error('error: wasm-pack not found. Install it with:  cargo install wasm-pack');
  process.exit(1);
}

console.log(`Building uma-sim-wasm -> ${outDir}`);
const build = spawnSync(
  'wasm-pack',
  ['build', crateDir, '--target', 'web', '--out-dir', outDir, '--out-name', 'uma_sim_wasm'],
  { stdio: 'inherit', env, shell: isWin }
);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

console.log('Done. Import from src/lib/uma-sim-wasm/loader.ts');
