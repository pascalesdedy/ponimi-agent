import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './output',
  timeout: 60000,
  retries: 0,
  use: {
    headless: true,
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        },
      },
    },
  ],
});
