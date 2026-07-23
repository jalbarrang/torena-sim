/// <reference types="vitest/config" />

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import babel from '@rolldown/plugin-babel';
import sitemap from 'vite-sitemap-plugin';
import { generateDataManifest } from './scripts/generate-data-manifest';

const root = dirname(fileURLToPath(import.meta.url));

function getSemver(): string {
  try {
    const tag = execSync('git describe --tags --abbrev=0 --match "v*"', {
      cwd: root,
      encoding: 'utf8'
    }).trim();
    return tag.replace(/^v/, '');
  } catch {
    return '0.0.0-dev';
  }
}

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const __APP__VERSION__ = `${getSemver()}+${getCommitHash()}`;

// Emit the runtime data datasets as content-hashed files under `public/${DATA_DIR}/`
// plus a stable `manifest.json` mapping logical key -> hashed filename. This is
// what lets the app fetch data at runtime (instead of inlining ~3.6MB of JSON in
// the JS bundle) AND keeps the JS bundle byte-identical across data-only updates
// (the bundle references the stable manifest URL, not the hashed files). Runs in
// dev (server start) + build via `buildStart`; outputs are gitignored.
function dataManifest(): Plugin {
  return {
    name: 'data-manifest',
    buildStart() {
      generateDataManifest(root);
    }
  };
}

// The wasm-pack (`--target web`) bundle is imported by the loader through a
// runtime, Vite-ignored specifier (`./pkg/uma_sim_wasm.js`), so Vite never
// emits it. The workers/main chunk live in `assets/`, so the colocated `./pkg`
// must resolve to `assets/pkg/`. Copy the generated artifacts there at build.
function copyUmaSimWasmPkg(): Plugin {
  const srcDir = resolve(root, 'src/lib/uma-sim-wasm/pkg');
  const files = ['uma_sim_wasm.js', 'uma_sim_wasm_bg.wasm'];
  let outDir = 'dist';
  return {
    name: 'copy-uma-sim-wasm-pkg',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const destDir = resolve(root, outDir, 'assets/pkg');
      mkdirSync(destDir, { recursive: true });
      for (const file of files) {
        const from = join(srcDir, file);
        if (!existsSync(from)) {
          throw new Error(
            `[copy-uma-sim-wasm-pkg] missing ${from}. Run \`pnpm run wasm:build\` before \`vite build\`.`
          );
        }
        copyFileSync(from, join(destDir, file));
      }
    }
  };
}

// Feature Flags:
// Vite automatically loads environment variables from .env files
// Feature flags should be prefixed with VITE_FEATURE_ to be accessible via import.meta.env
// See docs/feature-flags.md for usage and best practices

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  define: {
    __APP__VERSION__: JSON.stringify(__APP__VERSION__)
  },
  resolve: {
    tsconfigPaths: true
  },
  plugins: [
    dataManifest(),
    copyUmaSimWasmPkg(),
    react(),
    babel({
      presets: [reactCompilerPreset()]
    }),
    tailwindcss(),
    sitemap({
      base: process.env.VITE_SITE_URL ?? 'https://jalbarrang.github.io/umalator-global',
      urls: [
        '/',
        '/skill-bassin',
        '/uma-bassin',
        '/runners',
        '/race-sim',
        '/skill-planner',
        '/spark-odds',
        '/skills',
        '/support-cards'
      ]
    })
  ],
  assetsInclude: ['**/*.wasm'],
  build: {
    // PostHog injects a chunk ID and uploads these maps in the deploy workflow; `hidden` keeps sourceMappingURL comments out of the public JavaScript.
    sourcemap: 'hidden'
  },
  worker: {
    format: 'es'
  },
  test: {
    globals: true,
    setupFiles: ['./src/test-setup.ts']
  }
});
