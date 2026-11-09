import { defineConfig } from '@playwright/test'
import { isAbsolute, resolve } from 'node:path'

function required(name: string, absolute = false): string {
  const value = process.env[name]
  if (!value || absolute && !isAbsolute(value)) throw new Error(`Set ${name}${absolute ? ' to an absolute path' : ''}.`)
  return value
}
const baseURL = required('SCENEWEAVE_TEST_BASE_URL')
if (!/^https?:\/\//.test(baseURL)) throw new Error('SCENEWEAVE_TEST_BASE_URL must point at the externally served normal production dist.')
required('SCENEWEAVE_SVG_DETERMINISM_FIXTURES', true)
required('SCENEWEAVE_SVG_DETERMINISM_RECOVERY', true)
const output = resolve(required('SCENEWEAVE_SVG_DETERMINISM_OUTPUT', true))

export default defineConfig({
  testDir: '.', testMatch: 'svg-determinism.spec.ts', fullyParallel: false, workers: 1,
  timeout: 300_000, expect: { timeout: 30_000 }, retries: 0,
  outputDir: `${output}/results`, reporter: [['line'], ['json', { outputFile: `${output}/results.json` }]],
  use: { baseURL, viewport: { width: 1512, height: 982 }, actionTimeout: 30_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', ...(process.env.SCENEWEAVE_CHROME_CHANNEL ? { channel: process.env.SCENEWEAVE_CHROME_CHANNEL } : {}) } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  // Each test receives a fresh Playwright context. No automatic server, DEV
  // imports, application hooks, retries, or shared browser storage.
})
