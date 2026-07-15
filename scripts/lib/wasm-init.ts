import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initUmaSimWasmFromModule } from '@/lib/uma-sim-wasm/loader';
import type {
  WasmCompareData,
  WasmCompareParams,
  WasmContestedCompareParams,
  WasmRaceSimParams,
  WasmRaceSimResult
} from '@/lib/uma-sim-wasm/types';

type UmaSimWasmCliModule = {
  initSync: (options: { module: BufferSource }) => unknown;
  runRaceSim: (params: WasmRaceSimParams) => WasmRaceSimResult;
  runCompare: (params: WasmCompareParams) => WasmCompareData;
  runContestedCompare: (params: WasmContestedCompareParams) => WasmCompareData;
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wasmPkgDir = join(repoRoot, 'src', 'lib', 'uma-sim-wasm', 'pkg');
const wasmJsPath = join(wasmPkgDir, 'uma_sim_wasm.js');
const wasmBgPath = join(wasmPkgDir, 'uma_sim_wasm_bg.wasm');

let wasmModulePromise: Promise<UmaSimWasmCliModule> | null = null;

export async function ensureCliWasm(): Promise<UmaSimWasmCliModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      if (!existsSync(wasmJsPath) || !existsSync(wasmBgPath)) {
        throw new Error(
          `WASM bundle not found at ${wasmPkgDir}. Run \`pnpm run wasm:build\` before using CLI simulation scripts.`
        );
      }

      const mod = (await import(wasmJsPath)) as UmaSimWasmCliModule;
      mod.initSync({ module: readFileSync(wasmBgPath) });
      return mod;
    })();
  }

  return wasmModulePromise;
}

let loaderPrimed: Promise<void> | null = null;

/**
 * Prime the shared browser-style loader (`@/lib/uma-sim-wasm/loader`) for Node.
 *
 * Scripts that go through `runCompare`/`runSamplingFromPlan` reach the WASM via
 * that loader, whose default init path `fetch`es the colocated `.wasm` — which
 * Node's undici cannot resolve for `file:` URLs. Compile the module from disk
 * and hand it to the loader so its subsequent calls skip the fetch entirely.
 */
export async function ensureLoaderWasm(): Promise<void> {
  if (!loaderPrimed) {
    loaderPrimed = (async () => {
      if (!existsSync(wasmBgPath)) {
        throw new Error(
          `WASM bundle not found at ${wasmPkgDir}. Run \`pnpm run wasm:build\` before using CLI simulation scripts.`
        );
      }
      const module = await WebAssembly.compile(readFileSync(wasmBgPath));
      await initUmaSimWasmFromModule(module);
    })();
  }

  return loaderPrimed;
}
