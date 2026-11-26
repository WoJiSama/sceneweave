import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import development, { productionOnlySpecs } from '../playwright.config'

const externalUrl = process.env.SCENEWEAVE_TEST_BASE_URL
const baseURL = externalUrl ?? 'http://127.0.0.1:4173/sceneweave/'

export default defineConfig({
  ...development,
  testDir: '.',
  testIgnore: [],
  grepInvert: undefined,
  projects: process.env.SCENEWEAVE_CROSS_BROWSER ? [
    ...(development.projects ?? []), { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ] : development.projects,
  testMatch: [
    ...productionOnlySpecs,
    '**/backup-delivery-ux.spec.ts', '**/export-privacy-ux.spec.ts', '**/room-privacy-ux.spec.ts', '**/natural-detail-queue.spec.ts',
    ...(process.env.SCENEWEAVE_DETAIL_ARTIFACT ? ['**/detail-floor-privacy-acceptance.spec.ts'] : []),
    ...(process.env.SCENEWEAVE_NOTE_PRIVACY_INPUTS ? ['**/note-privacy-notice.spec.ts'] : []),
  ],
  outputDir: '../work/production-test-results',
  use: { ...development.use, baseURL },
  webServer: externalUrl ? undefined : {
    command: 'npm run preview -- --port 4173 --strictPort',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: baseURL,
    timeout: 30_000,
  },
})
