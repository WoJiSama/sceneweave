import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const output = resolve(process.env.SCENEWEAVE_TERRAIN_OUTPUT ?? 'test-results/terrain-cross-browser')
export default defineConfig({
  testDir: '.',
  testMatch: ['terrain-generation.spec.ts', 'terrain-editing.spec.ts', 'terrain-surroundings.spec.ts', 'terrain-topology.spec.ts', 'terrain-presentation.spec.ts', 'regional-authoring.spec.ts'],
  fullyParallel: false, workers: 1, timeout: 120_000, expect: { timeout: 12_000 },
  reporter: [['line'], ['json', { outputFile: `${output}/results.json` }]], outputDir: `${output}/results`,
  use: { baseURL: process.env.SCENEWEAVE_TEST_BASE_URL ?? 'http://127.0.0.1:5173', viewport: { width: 1512, height: 982 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.SCENEWEAVE_TEST_BASE_URL ? undefined : { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30_000 },
  projects: [{ name: 'firefox', use: { browserName: 'firefox' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
})
