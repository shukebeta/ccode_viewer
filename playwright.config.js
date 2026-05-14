const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  outputDir: './test-results',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    actionTimeout: 15000,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' }
    }
  ],
  webServer: {
    command: 'node scripts/run-e2e-dev.mjs',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 60000
  }
})
