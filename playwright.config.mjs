import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://localhost:7089', headless: true, trace: 'off' },
  reporter: 'list',
  webServer: {
    command: 'func start --port 7089',
    url: 'http://localhost:7089/api/config',
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      FUNCTIONS_WORKER_RUNTIME: 'node',
      ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
      ENTRA_CLIENT_ID: '00000000-0000-0000-0000-000000000002',
      ENTRA_API_AUDIENCE: 'test-api',
      ENTRA_API_SCOPE: 'api://test-api/Act3.Access',
      ACT3_REDIRECT_URI: 'http://localhost:7089/api/app',
      CALDOVA_ALLOW_CLOUD_WRITES: 'false',
    },
  },
});