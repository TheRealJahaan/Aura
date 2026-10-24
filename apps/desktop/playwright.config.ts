import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/ui',
  timeout: 20_000,
  use: { baseURL: 'http://127.0.0.1:4789', colorScheme: 'dark' },
  webServer: { command: 'node test/ui/serve.mjs', url: 'http://127.0.0.1:4789/orb.html', reuseExistingServer: true },
});
