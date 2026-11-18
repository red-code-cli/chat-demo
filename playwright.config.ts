import { defineConfig } from '@playwright/test'

const PORT = 4173

/**
 * Phase 0 safety net: smoke + visual tests for the existing UI.
 * The web server builds the production bundle and serves `dist/` with a tiny
 * static server, so every run exercises exactly what ships.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  snapshotPathTemplate: '{testDir}/visual/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    colorScheme: 'light',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `pnpm build && node tests/support/static-server.mjs`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
