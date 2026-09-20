import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

// Some sandboxed environments (this one included) ship a pre-installed
// Chromium instead of letting Playwright download its own — point at it
// when it's there, otherwise fall back to Playwright's normal managed
// browser so the suite still runs anywhere else (a plain `npm install`
// followed by `npx playwright install chromium` first).
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = fs.existsSync(SANDBOX_CHROMIUM)
  ? { executablePath: SANDBOX_CHROMIUM }
  : {};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // A plain desktop-shaped viewport, not a `devices['Pixel N']`
      // preset: those set isMobile/hasTouch, which changes how Chromium
      // dispatches page.mouse.* — Phaser's input plugin (and this whole
      // suite) expects plain mouse/pointer events.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 420, height: 900 }, launchOptions },
    },
  ],
  // Reuses a server you already have running (`npm run dev`) instead of
  // fighting over the port; starts one otherwise.
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
