// Playwright config for Docker sandbox (Alpine Chromium)
const config = {
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    browserName: 'chromium',
    headless: true,
    channel: 'chromium',
    screenshot: 'off',
    video: 'off',
    launchOptions: {
      executablePath: '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
};

module.exports = config;
