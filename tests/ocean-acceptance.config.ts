import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
const output = resolve(process.env.SCENEWEAVE_OCEAN_OUTPUT ?? 'work/ocean-finalization-20261117/production')
const suite = process.env.SCENEWEAVE_OCEAN_SUITE ?? 'production'
const matches: Record<string, string[]> = {
  production: ['ocean-finalization.spec.ts', 'ocean-scene.spec.ts', 'ocean-refinement.spec.ts', 'ocean-continuation.spec.ts'],
  raster: ['ocean-scene.spec.ts', 'ocean-continuation-raster.spec.ts', 'ocean-acceptance-raster.spec.ts'],
  generation: ['ocean-generation-matrix.spec.ts'],
  recovery: ['complete-project-cas.spec.ts', 'complete-project-import-safety.spec.ts', 'complete-project-save-abort.spec.ts'],
}
if (!matches[suite] || !process.env.SCENEWEAVE_TEST_BASE_URL) throw new Error('Ocean acceptance needs an explicit suite and actual server address')
export default defineConfig({
  testDir: '.', testMatch: matches[suite], workers: 1, fullyParallel: false, timeout: 300000, expect: { timeout: 12000 },
  grepInvert: suite === 'production' ? /ocean raster/ : undefined,
  grep: suite === 'raster' ? /raster|shared inward|ocean privacy/ : undefined,
  reporter: [['list'], ['json', { outputFile: `${output}/report.json` }]], outputDir: `${output}/results`,
  use: { baseURL: process.env.SCENEWEAVE_TEST_BASE_URL, viewport: { width: 1512, height: 982 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'firefox', timeout: 900000, use: { browserName: 'firefox' } },
    { name: 'webkit', timeout: 900000, use: { browserName: 'webkit' } },
  ],
})
