// Explicit frozen-input configuration supplies preserved complete works.
// All browser interaction uses normal controls and downloads.
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import type { ProjectManifest } from '../src/shared/project/file'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSceneObjects, openSceneSettings, openVisualTask } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

type Input = { input: string; roomId: string; props: number }
type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
const inputs: Record<string, Input> = process.env.SCENEWEAVE_IMPORT_SAFETY_CASES
  ? JSON.parse(readFileSync(process.env.SCENEWEAVE_IMPORT_SAFETY_CASES, 'utf8')) : {}
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes))
const stripSessionMetadata = (document: Backup['document']) => {
  const { sceneId: _id, createdAt: _created, updatedAt: _updated, revision: _revision, ...content } = document
  return content
}

function negativePackages(bytes: Buffer) {
  const original = unzipSync(bytes), manifest: ProjectManifest = parse(original['manifest.json'])
  const asset = manifest.entries.findLast(entry => entry.role === 'asset')!
  expect(asset).toBeDefined()
  const variants: { name: string; buffer: Buffer; mutation: string }[] = []
  const add = (name: string, mutation: string, change: (files: Record<string, Uint8Array>, manifest: ProjectManifest) => void) => {
    const files = Object.fromEntries(Object.entries(original).map(([key, value]) => [key, value.slice()]))
    const header = structuredClone(manifest)
    change(files, header)
    files['manifest.json'] = strToU8(JSON.stringify(header))
    variants.push({ name, mutation, buffer: Buffer.from(zipSync(files, { level: 6, mtime: new Date(2000, 0, 1) })) })
  }
  const changeScene = (files: Record<string, Uint8Array>, header: ProjectManifest, change: (scene: any) => void) => {
    const scene = parse(files['scene.json']); change(scene)
    const changed = strToU8(JSON.stringify(scene)); files['scene.json'] = changed
    const entry = header.entries.find(entry => entry.path === 'scene.json')!
    entry.sha256 = sha(changed); entry.sizeBytes = changed.length
  }
  variants.push({ name: 'truncated', buffer: bytes.subarray(0, bytes.length - 25), mutation: 'Remove the ZIP end, retaining the original local entries.' })
  add('future-version', 'Only manifest.schemaVersion=2.', (_files, header) => { (header as any).schemaVersion = 2 })
  add('unknown-scene-field', 'Add one unknown scene field and update its declared hash/length.', (files, header) => {
    changeScene(files, header, scene => { scene.unrecognizedImportField = true })
  })
  add('missing-floor', 'Change one actual prop floor reference and update the scene hash/length.', (files, header) => {
    changeScene(files, header, scene => { Object.values<any>(scene.props)[0].floorId = 'nonexistent-import-floor' })
  })
  add('zero-wall-thickness', 'Set one actual wall thickness to zero and update the scene hash/length.', (files, header) => {
    changeScene(files, header, scene => { Object.values<any>(scene.walls)[0].thicknessMm = 0 })
  })
  add('missing-asset', `Remove declared ${asset.path}.`, files => { delete files[asset.path] })
  add('changed-asset-bytes', `Change one byte in declared ${asset.path}, retaining its hash.`, files => {
    const image = files[asset.path]; image[image.length - 5] ^= 1
  })
  add('wrong-pixel-dimensions', 'Change the declared width of one unchanged actual image.', (_files, header) => {
    header.assetRecords[asset.sha256].pixelWidth++
  })
  const document = parse(original['scene.json'])
  const definition = Object.values<any>(document.assets).find(value => value.sha256 === asset.sha256)!
  expect(definition).toBeDefined()
  expect(manifest.licenseBindings.some(binding => binding.subjectKind === 'asset' && binding.subjectId === definition.id)).toBe(true)
  add('missing-license-binding', 'Remove the actual image license binding; retain all image/license bytes.', (_files, header) => {
    header.licenseBindings = header.licenseBindings.filter(binding => binding.subjectKind !== 'asset' || binding.subjectId !== definition.id)
  })
  const control = Buffer.from(zipSync(original, { level: 6, mtime: new Date(2000, 0, 1) }))
  expect(Object.fromEntries(Object.entries(unzipSync(control)).map(([name, value]) => [name, sha(value)])))
    .toEqual(Object.fromEntries(Object.entries(original).map(([name, value]) => [name, sha(value)])))
  return { variants, control }
}

async function fileMenu(page: Page) {
  await closeWorkspaceDrawers(page)
  const menu = page.locator('details.workspace-file-menu')
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
  return menu
}
async function openFile(page: Page, file: { name: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser')
  await (await fileMenu(page)).getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles({ ...file, mimeType: 'application/octet-stream' })
}
async function picture(page: Page, audience: 'gm' | 'player', path: string) {
  await closeWorkspaceDrawers(page)
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(path)
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  const image = PNG.sync.read(await readFile(path))
  expect(Math.max(image.width, image.height)).toBe(4096)
  return { width: image.width, height: image.height, rgbaSha256: sha(image.data) }
}

for (const [key, width] of [['fantasy', 1512], ['modern', 390]] as const) test(`complete ${key} import failures preserve drafts, undo and the saved project at ${width}px`, async ({ page, context }, info) => {
  test.skip(!inputs[key], 'Requires explicit preserved complete-project inputs')
  test.setTimeout(300000)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const input = inputs[key], errors: string[] = [], events: object[] = [], rejected: object[] = []
  let stage = 'open', pendingFileChoosers = 0
  page.on('pageerror', error => errors.push(error.message))
  page.on('filechooser', () => { pendingFileChoosers++ })
  const backup = async (label: string) => {
    await closeWorkspaceDrawers(page)
    const result = await keyboardProjectBackup(page, info.outputPath(label + '.sceneweave'))
    events.push({ label, sceneId: result.document.sceneId, revision: result.document.revision, hashes: result.hashes })
    return result
  }
  try {
    const response = await page.goto('./#home')
    expect(response?.ok()).toBe(true)
    if (process.env.SCENEWEAVE_TEST_BASE_URL) expect(await response!.text()).not.toContain('/@vite/client')
    await page.getByTestId('native-project-file').setInputFiles(input.input)
    await keyboardWorkspaceSaved(page)
    const initial = await backup('initial')
    expect(Object.keys(initial.document.props)).toHaveLength(input.props)
    const editedTitle = initial.document.title + ' · 导入失败保全'

    stage = 'name-draft'
    const settings = await openSceneSettings(page)
    await settings.getByLabel('工程名称', { exact: true }).fill(editedTitle)
    const draftMenu = await fileMenu(page)
    await expect(draftMenu.getByRole('button', { name: '打开工程文件', exact: true })).toBeDisabled()
    await draftMenu.locator('summary').click()
    // Reopen the existing detail drawer without changing the unfinished name.
    if (width === 390) await page.locator('.workspace-layout-actions').getByRole('button', { name: '当前详情', exact: true }).click()
    await expect(settings.getByLabel('工程名称', { exact: true })).toHaveValue(editedTitle)
    expect(pendingFileChoosers).toBe(0)
    await settings.getByRole('button', { name: '保存名称', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    const edited = await backup('edited')
    expect(edited.document.revision).toBe(initial.document.revision + 1)
    expect(stripSessionMetadata(edited.document)).toEqual(stripSessionMetadata({ ...initial.document, title: editedTitle }))
    expect(edited.identity).toEqual(initial.identity); expect(edited.appearance).toEqual(initial.appearance)
    expect(keyboardResourceHashes(edited.hashes)).toEqual(keyboardResourceHashes(initial.hashes))

    stage = 'visual-candidate'
    const objects = await openSceneObjects(page)
    const allLayers = objects.getByRole('button', { name: '显示所有图层的对象', exact: true })
    if (await allLayers.isVisible()) await allLayers.click()
    await objects.getByLabel('搜索场景对象', { exact: true }).fill(input.roomId)
    await objects.locator(`[data-entity-id="${input.roomId}"]`).click()
    const visual = await openVisualTask(page, '铺装')
    await expect(visual.getByLabel('视觉铺装对象', { exact: true })).toHaveValue(input.roomId)
    await visual.getByLabel('视觉纹理方向 °', { exact: true }).fill('30')
    await visual.getByRole('button', { name: '预览铺装', exact: true }).click()
    await expect(page.getByRole('region', { name: '候选审阅', exact: true })).toBeVisible()
    const candidateMenu = await fileMenu(page)
    await expect(candidateMenu.getByRole('button', { name: '打开工程文件', exact: true })).toBeDisabled()
    await candidateMenu.locator('summary').click()
    if (width === 390) await page.locator('.workspace-layout-actions').getByRole('button', { name: '当前详情', exact: true }).click()
    await expect(page.getByRole('region', { name: '候选审阅', exact: true })).toBeVisible()
    expect(pendingFileChoosers).toBe(0)
    await page.getByRole('button', { name: '取消视觉预览', exact: true }).click()
    expect((await backup('candidate-cancelled')).hashes).toEqual(edited.hashes)

    const baselineImages = {
      gm: await picture(page, 'gm', info.outputPath('before-gm.png')),
      player: await picture(page, 'player', info.outputPath('before-player.png')),
    }
    const { variants, control } = negativePackages(await readFile(info.outputPath('edited.sceneweave')))
    await writeFile(info.outputPath('repacked-valid-control.sceneweave'), control)
    for (const variant of variants) {
      stage = variant.name
      await writeFile(info.outputPath('input-' + variant.name + '.sceneweave'), variant.buffer)
      const previous = page.locator('.workspace-notice')
      if (await previous.isVisible()) await previous.getByRole('button', { name: '关闭提示', exact: true }).click()
      await openFile(page, { name: variant.name + '.sceneweave', buffer: variant.buffer })
      await expect(page.getByRole('dialog', { name: '检查完整工程', exact: true })).toHaveCount(0, { timeout: 30000 })
      await expect(previous).toBeVisible()
      const rejection = (await previous.locator('span').textContent())!.trim()
      expect(rejection.length).toBeGreaterThan(5)
      await keyboardWorkspaceSaved(page)
      const retained = await backup('retained-' + variant.name)
      expect(retained.hashes).toEqual(edited.hashes)
      await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
      rejected.push({ variant: variant.name, mutation: variant.mutation, sha256: sha(variant.buffer), rejection })
    }
    expect(pendingFileChoosers).toBe(variants.length)
    expect(await picture(page, 'gm', info.outputPath('after-gm.png'))).toEqual(baselineImages.gm)
    expect(await picture(page, 'player', info.outputPath('after-player.png'))).toEqual(baselineImages.player)

    stage = 'undo-redo'
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
    expect(stripSessionMetadata((await backup('undone')).document)).toEqual(stripSessionMetadata(initial.document))
    await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
    const redone = await backup('redone')
    expect(stripSessionMetadata(redone.document)).toEqual(stripSessionMetadata(edited.document))
    expect(redone.identity).toEqual(edited.identity); expect(redone.appearance).toEqual(edited.appearance)

    stage = 'saved-observer'
    const observer = await context.newPage()
    observer.on('pageerror', error => errors.push(error.message))
    try {
      await observer.goto('./#home')
      await expect(observer.getByTestId('workspace-home').locator('[data-project-key^="native:"]')).toHaveCount(1)
      await observer.locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
      await keyboardWorkspaceSaved(observer)
      expect((await keyboardProjectBackup(observer, info.outputPath('observer-cold.sceneweave'))).hashes).toEqual(redone.hashes)
    } finally { await observer.close() }

    stage = 'cold-reopen'
    await closeWorkspaceDrawers(page)
    await page.getByRole('button', { name: '回到首页', exact: true }).click(); await page.reload()
    await page.locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    expect((await backup('cold')).hashes).toEqual(redone.hashes)
    expect(await picture(page, 'gm', info.outputPath('cold-gm.png'))).toEqual(baselineImages.gm)
    expect(await picture(page, 'player', info.outputPath('cold-player.png'))).toEqual(baselineImages.player)

    stage = 'valid-control'
    await openFile(page, { name: 'repacked-valid-control.sceneweave', buffer: control })
    await expect(page.getByRole('dialog', { name: '检查完整工程', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '检查完整工程', exact: true })).toHaveCount(0, { timeout: 30000 })
    await keyboardWorkspaceSaved(page)
    const accepted = await backup('accepted-valid-control')
    expect(accepted.document.sceneId).not.toBe(redone.document.sceneId)
    expect(accepted.document.revision).toBe(0)
    expect(stripSessionMetadata(accepted.document)).toEqual(stripSessionMetadata(edited.document))
    expect(accepted.identity).toEqual(edited.identity); expect(accepted.appearance).toEqual(edited.appearance)
    expect(keyboardResourceHashes(accepted.hashes)).toEqual(keyboardResourceHashes(edited.hashes))
    await closeWorkspaceDrawers(page)
    await page.getByRole('button', { name: '回到首页', exact: true }).click(); await page.reload()
    await expect(page.getByTestId('workspace-home').locator('[data-project-key^="native:"]')).toHaveCount(2)
    await page.locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    expect((await backup('original-after-valid-import')).hashes).toEqual(redone.hashes)
    expect(errors).toEqual([])
    stage = 'complete'
  } finally {
    await writeFile(info.outputPath('facts.json'), JSON.stringify({ key, width, stage, normalProduction: !!process.env.SCENEWEAVE_TEST_BASE_URL, pendingFileChoosers, rejected, events, pageErrors: errors }, null, 2) + '\n')
  }
})
