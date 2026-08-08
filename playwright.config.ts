import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);
// 127.0.0.1 rather than localhost: Vite binds IPv4 only, while `localhost`
// resolves to ::1 first on some CI images, which fails the webServer wait.
const HOST = process.env.E2E_HOST ?? '127.0.0.1';
const BASE_URL = process.env.E2E_BASE_URL ?? `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /.*\.mobile\.spec\.ts/
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /.*\.mobile\.spec\.ts/
    }
  ],
  // Locally this reuses the dev server the developer already has running and
  // never starts a second one; CI has no server, so it starts its own.
  webServer: {
    command: `pnpm run dev --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      // The suite stubs `**/timeline`, so this only has to be non-empty — the
      // app throws before fetching when it is unset. CI needs no real Worker.
      VITE_TIMELINE_WORKER_URL: process.env.VITE_TIMELINE_WORKER_URL ?? 'http://127.0.0.1:8787'
    }
  }
});
