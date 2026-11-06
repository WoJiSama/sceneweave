import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const baseURL = process.env.SCENEWEAVE_TEST_BASE_URL
if (!baseURL) throw new Error('Formal visual acceptance requires SCENEWEAVE_TEST_BASE_URL pointing at the normal production dist server.')
if (!process.env.SCENEWEAVE_FORMAL_VISUAL_FIXTURES) throw new Error('Set SCENEWEAVE_FORMAL_VISUAL_FIXTURES to the frozen fixture directory.')
const output = resolve(process.env.SCENEWEAVE_FORMAL_VISUAL_OUTPUT ?? 'work/formal-visual')
export default defineConfig({
  testDir: '.', testMatch: ['formal-visual.spec.ts'], fullyParallel: false, workers: 1,
  timeout: 900_000, expect: { timeout: 30_000 }, retries: 0,
  outputDir: `${output}/results`, reporter: [['line'], ['json', { outputFile: `${output}/results.json` }]],
  use: { baseURL, viewport: { width: 1512, height: 982 }, actionTimeout: 30_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', ...(process.env.SCENEWEAVE_CHROME_CHANNEL ? { channel: process.env.SCENEWEAVE_CHROME_CHANNEL } : {}) } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  // Ordinary art/effect-neutral benchmarks and privacy QA deformations use separate contexts.
  // Start the already-built normal dist server externally. No development server or app test hooks.
})
