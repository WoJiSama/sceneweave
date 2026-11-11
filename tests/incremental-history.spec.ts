import { openBuildingTask, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton, projectBackupButton } from './workspace-ux-helpers'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ProjectData } from '../src/shared/model/project'
import type { HistoryIndex, ProjectManifest, ProjectReferences } from '../src/shared/project/file'
import { projectContentHash } from '../src/shared/project/validate'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 60_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })
}
async function download(page: Page, info: TestInfo, button: Locator, filename: string) {
  const pending = page.waitForEvent('download', { timeout: 60_000 })
  await button.click()
  const file = await pending, target = info.outputPath(filename)
  await file.saveAs(target)
  expect(await file.failure()).toBeNull()
  await settled(page)
  const exportMenu = page.locator('.workspace-export-menu')
  if (await exportMenu.getAttribute('open') !== null) await exportMenu.locator(':scope > summary').click()
  const bytes = await readFile(target)
  await info.attach(filename, { path: target })
  return bytes
}
function unpack(bytes: Buffer) {
  const files = unzipSync(bytes), json = <T>(path: string): T => JSON.parse(new TextDecoder().decode(files[path])) as T
  const manifest = json<ProjectManifest>('manifest.json')
  expect(manifest.format).toBe('sceneweave-complete-project')
  expect(Object.keys(files).sort()).toEqual(['manifest.json', ...manifest.entries.map(entry => entry.path)].sort())
  for (const entry of manifest.entries) {
    expect(files[entry.path].length, entry.path).toBe(entry.sizeBytes)
    expect(sha256(files[entry.path]), entry.path).toBe(entry.sha256)
  }
  const project = (refs?: ProjectReferences): ProjectData => {
    const hashes = refs?.assetHashes ?? Object.keys(manifest.assetRecords)
    const bindings = refs?.licenseBindings ?? manifest.licenseBindings
    const licenses = refs?.licenseHashes ?? [...new Set(bindings.map(binding => binding.licensePath.slice('licenses/'.length, -'.txt'.length)))]
    return {
      format: 'sceneweave-complete-project', schemaVersion: manifest.schemaVersion,
      document: json(refs?.scenePath ?? 'scene.json'), historyIdentity: json(refs?.identityPath ?? 'identity.json'),
      appearance: json(refs?.appearancePath ?? 'appearance.json'), authoringSources: json(refs?.sourcesPath ?? 'sources.json'),
      assets: Object.fromEntries(hashes.map(hash => [hash, manifest.assetRecords[hash]])),
      licenses: Object.fromEntries(licenses.map(hash => [hash, { sha256: hash, text: new TextDecoder().decode(files[`licenses/${hash}.txt`]) }])),
      licenseBindings: bindings,
    }
  }
  const history = manifest.packageMode === 'history' ? json<HistoryIndex>('history.json') : null
  return { manifest, files, current: project(history?.current), snapshots: history?.snapshots.map(refs => ({ ...refs.summary, project: project(refs) })) ?? [] }
}
async function complete(page: Page, info: TestInfo, name: string) {
  return unpack(await download(page, info, (await projectBackupButton(page)), `${name}.sceneweave`))
}
async function pixels(page: Page, png: Buffer) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    try {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const rgba = context.getImageData(0, 0, image.width, image.height).data
      const digest = await crypto.subtle.digest('SHA-256', rgba)
      return { width: image.width, height: image.height, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
    } finally { image.close() }
  }, png.toString('base64'))
}
async function audienceImages(page: Page, info: TestInfo, name: string) {
  const result = {} as Record<'gm' | 'player', Awaited<ReturnType<typeof pixels>>>
  for (const [audience, label] of [['gm', '主持人'], ['player', '玩家']] as const) {
    await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: label, exact: true }).click()
    await settled(page)
    result[audience] = await pixels(page, await download(page, info, (await mapExportButton(page, audience)), `${name}-${audience}.png`))
    expect(Math.max(result[audience].width, result[audience].height)).toBe(4096)
  }
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '主持人', exact: true }).click()
  await settled(page)
  return result
}
async function history(page: Page) {
  await openWorkspaceModule(page, '历史')
  await expect(page.getByLabel('完整保存版本', { exact: true })).toBeEnabled()
}
async function chooseVersion(page: Page, revision: number) {
  const select = page.getByLabel('完整保存版本', { exact: true })
  const option = select.locator('option').filter({ hasText: new RegExp(`^r${revision} ·`) })
  await expect(option).toHaveCount(1)
  const value = await option.getAttribute('value')
  if (!value) throw new Error(`Missing saved version r${revision}`)
  await select.selectOption(value)
  return value
}
async function restore(page: Page, revision: number) {
  await history(page); await chooseVersion(page, revision)
  await page.getByRole('button', { name: `恢复整个版本 · r${revision}`, exact: true }).click()
  await settled(page)
}
async function chooseProp(page: Page, id: string) {
  await openWorkspaceModule(page, '场景')
  await page.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
  await page.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await page.locator(`.asset-entity-list [data-entity-id="${id}"]`).click()
}
async function move(page: Page, id: string, x: number) {
  await chooseProp(page, id)
  const input = page.getByRole('spinbutton', { name: '物件 X', exact: true })
  await input.fill(String(x / 1000)); await input.press('Tab'); await settled(page)
}
async function named(page: Page, name: string) {
  await history(page)
  await page.getByRole('button', { name: '新建命名快照', exact: true }).click()
  await page.getByLabel('命名快照名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存快照', exact: true }).click()
  await settled(page)
  await expect(page.getByRole('button', { name: `查看快照 ${name}`, exact: true })).toBeVisible()
}

test('complete saved versions retain both branches, cold reads, selected portable history and actual dual-audience pixels', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('增量历史分支检查')
  await dialog.getByLabel('画布宽度', { exact: true }).fill('18')
  await dialog.getByLabel('画布高度', { exact: true }).fill('12')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click(); await settled(page)

  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await library.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  await page.getByRole('button', { name: '在此放置', exact: true }).click(); await settled(page)
  const placed = await complete(page, info, 'placed'), propId = Object.keys(placed.current.document.props)[0]
  expect(propId).toBeTruthy()

  await openBuildingTask(page, '文字与线索')
  await page.getByLabel('新注记内容', { exact: true }).fill('只供主持人查看的历史标记')
  await page.getByLabel('新注记可见性', { exact: true }).selectOption('gm')
  await page.getByRole('button', { name: '预览新增注记', exact: true }).click()
  await page.getByRole('checkbox', { name: '确认完整影响范围', exact: true }).check()
  await page.getByRole('button', { name: '采用结构修改', exact: true }).click(); await settled(page)
  const baseline = await complete(page, info, 'baseline'), baselineRevision = baseline.current.document.revision
  expect(Object.values(baseline.current.document.notes)).toEqual([expect.objectContaining({ visibility: 'gm' })])
  await named(page, '改变前')
  const baselineImages = await audienceImages(page, info, 'baseline')
  expect(baselineImages.gm.sha256).not.toBe(baselineImages.player.sha256)

  const originalX = baseline.current.document.props[propId].positionMm.x
  await move(page, propId, originalX + 1200)
  const tip = await complete(page, info, 'old-tip'), tipRevision = tip.current.document.revision
  await named(page, '改变后')
  await restore(page, baselineRevision)
  const reverted = await complete(page, info, 'reverted')
  expect(reverted.current.document.revision).toBe(tipRevision + 1)
  expect(reverted.current.document.props[propId]).toEqual(baseline.current.document.props[propId])
  expect(reverted.current.historyIdentity).toEqual(baseline.current.historyIdentity)
  const revertedImages = await audienceImages(page, info, 'reverted')
  expect(revertedImages).toEqual(baselineImages)

  await move(page, propId, originalX + 2400)
  const fork = await complete(page, info, 'new-branch')
  await restore(page, tipRevision)
  const forward = await complete(page, info, 'forward')
  expect(forward.current.document.revision).toBe(fork.current.document.revision + 1)
  expect(forward.current.document.props[propId]).toEqual(tip.current.document.props[propId])
  await history(page)
  const versions = page.getByLabel('完整保存版本', { exact: true }).locator('option')
  await expect(versions.filter({ hasText: new RegExp(`^r${tipRevision} ·`) })).toHaveCount(1)
  await expect(versions.filter({ hasText: new RegExp(`^r${fork.current.document.revision} ·`) })).toHaveCount(1)

  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开', exact: true }).first().click(); await settled(page)
  const cold = await complete(page, info, 'cold')
  expect(projectContentHash(cold.current)).toBe(projectContentHash(forward.current))
  await restore(page, baselineRevision)
  expect(await audienceImages(page, info, 'cold-reverted')).toEqual(baselineImages)
  await history(page)
  await page.getByRole('checkbox', { name: '备份携带所选快照', exact: true }).check()
  await page.getByRole('checkbox', { name: '备份快照 改变前', exact: true }).check()
  await page.getByRole('checkbox', { name: '备份快照 改变后', exact: true }).check()
  const archiveBytes = await download(page, info, page.getByRole('button', { name: '下载工程与所选历史 · 2 份', exact: true }), 'selected-history.sceneweave')
  const archive = unpack(archiveBytes)
  expect(archive.manifest.packageMode).toBe('history')
  expect(archive.snapshots.map(snapshot => snapshot.name).sort()).toEqual(['改变前', '改变后'])
  for (const [name, expected] of [['改变前', baseline.current], ['改变后', tip.current]] as const) {
    const snapshot = archive.snapshots.find(snapshot => snapshot.name === name)!
    expect(projectContentHash(snapshot.project)).toBe(snapshot.contentHash)
    expect(projectContentHash(snapshot.project)).toBe(projectContentHash(expected))
  }
  expect(Object.keys(archive.files).some(path => /delta|history-version/.test(path))).toBe(false)
  const importedPath = info.outputPath('selected-history.sceneweave')
  await page.getByLabel('选择完整工程', { exact: true }).setInputFiles(importedPath)
  await expect(page.getByRole('dialog', { name: '检查完整工程', exact: true })).toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByTestId('outdoor-workbench')).toHaveAttribute('data-revision', '0', { timeout: 60_000 })
  await settled(page)
  const imported = await complete(page, info, 'independent-import')
  expect(imported.current.document.sceneId).not.toBe(archive.current.document.sceneId)
  expect(imported.current.document.revision).toBe(0)
  expect(imported.current.document.props).toEqual(archive.current.document.props)
  await history(page)
  await expect(page.getByRole('button', { name: '查看快照 改变前', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看快照 改变后', exact: true })).toBeVisible()
  expect(errors).toEqual([])
  await info.attach('history-summary.json', { body: JSON.stringify({ baselineRevision, tipRevision, forkRevision: fork.current.document.revision,
    forwardRevision: forward.current.document.revision, coldHash: projectContentHash(cold.current), baselineImages, revertedImages,
    snapshots: archive.snapshots.map(snapshot => ({ name: snapshot.name, revision: snapshot.sourceRevision, contentHash: snapshot.contentHash })) }, null, 2), contentType: 'application/json' })
})
