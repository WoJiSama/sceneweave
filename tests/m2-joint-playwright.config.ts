import { defineConfig } from '@playwright/test'
const output = process.env.SCENEWEAVE_JOINT_OUTPUT ?? 'test-results/m2-joint'
export default defineConfig({
  testDir: '.', testMatch: 'm2-joint-acceptance.spec.ts', fullyParallel: false, workers: 1, timeout: 180_000,
  expect: { timeout: 15_000 }, reporter: [['line'], ['json', { outputFile: `${output}/results.json` }]],
  outputDir: `${output}/results`,
  use: { actionTimeout: 20_000, baseURL: process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173', viewport: { width: 1512, height: 982 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.SCENEWEAVE_TEST_BASE_URL ? undefined : { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30_000 },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
