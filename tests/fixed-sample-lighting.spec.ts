import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSamples } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const environment = (scene: any) => scene.visual.base.base.environment
const content = (scene: any) => { const { sceneId, revision, createdAt, updatedAt, ...rest } = scene; return rest }
const samples = [{ key: 'study', label: '书房与露台' }, { key: 'island', label: '双层岩岛' }, { key: 'outpost', label: '海岸哨所' }]
function image(bytes: Buffer) {
  const decoded = PNG.sync.read(bytes)
  return { width: decoded.width, height: decoded.height, rgbaSha256: sha(decoded.data) }
}
async function picture(page: Page, target: string, audience: 'gm' | 'player') {
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(target); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const result = image(await readFile(target)); expect(result.width).toBe(4096)
  return result
}
async function coldOpen(page: Page, sceneId: string) {
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.locator(`[data-project-key="native:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function findPrevious(root: string, name: string): Promise<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) { try { return await findPrevious(target, name) } catch {} }
    else if (entry.name === name) return target
  }
  throw new Error('Missing previous normal-UI sample ' + name)
}

for (const sample of samples) test(`${sample.key} fixed sample saves its declared theme light and honors already saved environments`, async ({ page, browser }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '固定主题投影方向')
  await openSamples(page)
  await page.getByRole('region', { name: '场景样板', exact: true }).getByRole('button', { name: sample.label, exact: true }).click()
  await page.getByRole('dialog', { name: '确认打开工程', exact: true }).getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const initial = await keyboardProjectBackup(page, info.outputPath(sample.key + '-created.sceneweave'))
  expect(environment(initial.document).lightDirectionDeg).toBe(Number(process.env.SCENEWEAVE_EXPECT_SAMPLE_LIGHT ?? 45))
  const theme = initial.document.styleThemes[initial.document.activeStyleThemeRef!.id]
  expect(theme.shadowPresets.furniture.directionDeg).toBe(45)
  const pictures: Record<string, ReturnType<typeof image>> = {}
  for (const phase of ['created', 'cold']) {
    if (phase === 'cold') {
      await coldOpen(page, initial.document.sceneId)
      expect((await keyboardProjectBackup(page, info.outputPath(sample.key + '-cold.sceneweave'))).hashes).toEqual(initial.hashes)
    }
    for (const audience of ['gm', 'player'] as const) pictures[`${phase}-${audience}`] = await picture(page, info.outputPath(`${sample.key}-${phase}-${audience}.png`), audience)
  }
  expect(pictures['cold-gm']).toEqual(pictures['created-gm']); expect(pictures['cold-player']).toEqual(pictures['created-player'])
  const previousRoot = process.env.SCENEWEAVE_PREVIOUS_SAMPLE_RESULTS
  let savedImport: object | undefined
  if (previousRoot) {
    const priorPath = await findPrevious(previousRoot, sample.key + '-created.sceneweave')
    const { unzipSync } = await import('fflate'), files = unzipSync(new Uint8Array(await readFile(priorPath)))
    const priorScene = JSON.parse(new TextDecoder().decode(files['scene.json']))
    expect(environment(priorScene).lightDirectionDeg).toBe(135)
    const normalized = structuredClone(initial.document); environment(normalized).lightDirectionDeg = 135
    expect(content(normalized)).toEqual(content(priorScene))
    const context = await browser.newContext(), importedPage = await context.newPage(), importedErrors: string[] = []
    importedPage.on('pageerror', error => importedErrors.push(error.message))
    try {
      await importedPage.goto('./#home'); await importedPage.getByTestId('native-project-file').setInputFiles(priorPath); await keyboardWorkspaceSaved(importedPage)
      const imported = await keyboardProjectBackup(importedPage, info.outputPath(sample.key + '-existing-import.sceneweave'))
      expect(content(imported.document)).toEqual(content(priorScene)); expect(environment(imported.document).lightDirectionDeg).toBe(135)
      expect(imported.identity).toEqual(JSON.parse(new TextDecoder().decode(files['identity.json'])))
      expect(imported.appearance).toEqual(JSON.parse(new TextDecoder().decode(files['appearance.json'])))
      expect(imported.appearance).toEqual(initial.appearance)
      expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
      await coldOpen(importedPage, imported.document.sceneId)
      expect((await keyboardProjectBackup(importedPage, info.outputPath(sample.key + '-existing-cold.sceneweave'))).hashes).toEqual(imported.hashes)
      for (const audience of ['gm', 'player'] as const) {
        const oldImage = image(await readFile(await findPrevious(previousRoot, `${sample.key}-created-${audience}.png`)))
        expect(await picture(importedPage, info.outputPath(`${sample.key}-existing-${audience}.png`), audience)).toEqual(oldImage)
      }
      expect(importedErrors).toEqual([]); savedImport = { priorPath, priorLight: 135, afterColdLight: 135, oldPixelsPreserved: true }
    } finally { await context.close() }
  }
  expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'), JSON.stringify({ sample, light: environment(initial.document).lightDirectionDeg, pictures, savedImport, pageErrors: errors, normalProduction: !!process.env.SCENEWEAVE_TEST_BASE_URL }, null, 2) + '\n')
})
