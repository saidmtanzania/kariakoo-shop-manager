import { defineConfig, devices } from '@playwright/test';

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ksm:ksm_local_password@localhost:5432/ksm?schema=public';

/**
 * End-to-end tests run against built apps. Start PostgreSQL and Mailpit first
 * (docker compose up -d postgres mailpit) and run `pnpm build`; Playwright then starts
 * the API and the web server, or reuses ones already running.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
        },
      },
    },
    {
      // Affordable Android phones are a primary target (AGENTS.md section 4).
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
        },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter backend start:prod',
      url: `${API_URL}/api/v1/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        PORT: new URL(API_URL).port || '4000',
        DATABASE_URL,
        WEB_ORIGIN: WEB_URL,
        LOG_LEVEL: 'warn',
        // Requests arrive through the web app's /api proxy (one hop).
        TRUST_PROXY: '1',
        // Real SMTP into Mailpit (docker compose up -d mailpit).
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: process.env.SMTP_HOST ?? 'localhost',
        SMTP_PORT: process.env.SMTP_PORT ?? '1025',
      },
    },
    {
      command: 'pnpm --filter web start',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { API_INTERNAL_URL: API_URL },
    },
  ],
});
