import { expect, test, type Page, type Worker } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { acknowledgeAssetQuality } from './asset-quality-helpers'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openBuildingTask, openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'
import { decodeCanonicalPng } from '../src/shared/project/png-rgba'

type Input = { project: string; items: { kind: 'prop' | 'material' | 'prefab'; definitionId: string; name: string }[] }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const library = (page: Page) => page.getByRole('region', { name: '组件素材库', exact: true })
const audiences = ['gm', 'player'] as const

async function picturePixels(path: string) {
  const { width, height, rgba } = decodeCanonicalPng(await readFile(path))
  return { width, height, sha256: hash(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)) }
}

async function browse(page: Page, scope: 'project' | 'mine') {
  await openWorkspaceModule(page, '素材')
  const lib = library(page)
  const browsing = lib.getByRole('group', { name: '素材库操作', exact: true }).getByRole('button', { name: '浏览素材', exact: true })
  await browsing.click()
  await lib.getByLabel('素材来源', { exact: true }).selectOption(scope)
  await expect(lib).toHaveAttribute('aria-busy', 'false')
  return lib
}
async function manage(page: Page) {
  const lib = library(page)
  await lib.getByRole('group', { name: '素材库操作', exact: true }).getByRole('button', { name: /^导入\/管理/ }).click()
  const batch = lib.locator('details.catalog-management')
  if (await batch.getAttribute('open') === null) await batch.locator('summary').click()
  return lib
}
async function number(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true }); await field.fill(value); await field.press('Tab')
}
async function picture(page: Page, file: string, audience: 'gm' | 'player') {
  const pending = page.waitForEvent('download', { timeout: 60000 })
  await (await mapExportButton(page, audience)).click()
  await (await pending).saveAs(file); await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
}
async function adopt(page: Page, structure = false) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible(); await acknowledgeAssetQuality(page)
  if (structure) await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: structure ? '采用结构修改' : '采用组件修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function selectItems(page: Page, input: Input) {
  const lib = library(page)
  for (const item of input.items) {
    await lib.getByLabel('搜索组件素材', { exact: true }).fill(item.name)
    const row = lib.locator(`article[data-definition-id="${item.definitionId}"]`)
    await expect(row).toHaveAttribute('data-definition-id', item.definitionId)
    await row.getByRole('checkbox').check()
  }
}

// The real artwork is deliberately supplied by an explicit, frozen-input config.
// Ordinary CI discovery excludes this case; missing input is never a passing skip.
test('a real inn exports selected fixed prop, material and prefab content, restores an empty personal library and continues offline', async ({ page, browser }, info) => {
  test.setTimeout(360000)
  const path = process.env.SCENEWEAVE_LIBRARY_CASE
  if (!path) throw Error('SCENEWEAVE_LIBRARY_CASE must identify the frozen real-artwork input manifest')
  const input = JSON.parse(await readFile(path, 'utf8')) as Input
  expect(input.items.map(row => row.kind).sort()).toEqual(['material', 'prefab', 'prop'])
  const originalBytes = await readFile(input.project), originalHash = hash(originalBytes)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('native-project-file').setInputFiles(input.project)
  await keyboardWorkspaceSaved(page)
  const source = await keyboardProjectBackup(page, info.outputPath('source.sceneweave'))
  await browse(page, 'project'); await selectItems(page, input); await manage(page)
  await library(page).getByRole('button', { name: '保存到我的素材（3）', exact: true }).click()
  await expect(library(page).locator('.catalog-operation-status')).toContainText('已完整安装3项', { timeout: 60000 })
  await expect(library(page)).toHaveAttribute('aria-busy', 'false')
  await library(page).getByRole('button', { name: '整理所选', exact: true }).click()
  await library(page).getByLabel('个人素材标签', { exact: true }).fill('旅舍复用\n手绘素材')
  const organization = library(page).getByRole('form', { name: '个人素材整理草稿', exact: true })
  await organization.getByRole('button', { name: '棕色', exact: true }).click()
  await organization.getByLabel('收藏所选素材', { exact: true }).check()
  await organization.getByRole('button', { name: '保存这3项整理', exact: true }).click()
  await expect(organization).toHaveCount(0)
  const download = page.waitForEvent('download', { timeout: 60000 })
  await library(page).getByRole('button', { name: '备份所选内容与整理（3）', exact: true }).click()
  const libraryFile = info.outputPath('inn-selected.sceneweave-library')
  await (await download).saveAs(libraryFile)
  const packed = JSON.parse(await readFile(libraryFile, 'utf8'))
  expect(packed).toMatchObject({ format: 'sceneweave-asset-library', schemaVersion: 1, capsuleFormat: 'sceneweave-complete-project@1' })
  expect(packed.records).toHaveLength(3); expect(Object.keys(packed.organizations)).toHaveLength(3)
  expect(packed.records.map((r: { item: { selector: object } }) => r.item.selector)).toEqual(expect.arrayContaining(input.items.map(({ kind, definitionId }) => ({ kind, definitionId }))))
  for (const record of packed.records) {
    const capsule = Buffer.from(record.capsuleBase64, 'base64')
    expect(hash(capsule)).toBe(record.capsuleSha256)
    const scene = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(capsule))['scene.json']))
    expect(scene.title).toBe('素材目录载体')
    for (const field of ['props', 'prefabInstances', 'rooms', 'notes', 'regions', 'walls']) expect(scene[field]).toEqual({})
    expect(packed.organizations[record.item.identity.key]).toEqual({ tags: ['旅舍复用', '手绘素材'], colors: ['棕'], favorite: true })
  }
  expect((await keyboardProjectBackup(page, info.outputPath('source-after-library.sceneweave'))).hashes).toEqual(source.hashes)
  await library(page).getByRole('button', { name: '移除个人安装条目', exact: true }).click()
  await library(page).getByRole('button', { name: '确认移除这3项', exact: true }).click()
  await expect(library(page).locator('.catalog-operation-status')).toContainText('已移除3项')
  expect((await keyboardProjectBackup(page, info.outputPath('source-after-removal.sceneweave'))).hashes).toEqual(source.hashes)
  await page.getByRole('button', { name: '回到首页', exact: true }).click(); await page.reload()
  await page.locator(`[data-project-key="native:${source.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('source-cold.sceneweave'))).hashes).toEqual(source.hashes)
  for (const audience of ['gm', 'player'] as const) await picture(page, info.outputPath(`source-${audience}.png`), audience)

  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  const offlineRequests: string[] = [], failedRequests: string[] = []
  const applicationDecoration = (url: string) => /\/sceneweave\/(?:favicon\.svg|assets\/home-scenes\/[a-z0-9-]+\.png)$/.test(url)
  const requested = (request: { url(): string }) => { if (/^https?:/.test(request.url())) offlineRequests.push(request.url()) }
  const failed = (request: { url(): string }) => failedRequests.push(request.url())
  try {
    const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message))
    const svgWorkers: Worker[] = []
    target.on('worker', worker => {
      if (worker.url().startsWith('blob:') || /\/svg-worker-[^/]+\.js$/.test(worker.url())) svgWorkers.push(worker)
    })
    await createKeyboardProject(target, '旅舍素材跨设备 · 离线布景示例')
    await openBuildingTask(target)
    await target.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
    await target.getByLabel('房间名称', { exact: true }).fill('可复用客房与餐叙空间')
    const roomPosition = target.locator('.building-panel form details').filter({ has: target.getByLabel('房间起点 X', { exact: true }) })
    if (await roomPosition.getAttribute('open') === null) await roomPosition.locator('summary').click()
    for (const [label, value] of [['房间起点 X', '1'], ['房间起点 Y', '1'], ['房间宽度', '12'], ['房间高度', '8']]) await number(target, label, value)
    await target.getByRole('button', { name: '预览新房间', exact: true }).click(); await adopt(target, true)
    const before = await keyboardProjectBackup(target, info.outputPath('target-before-library.sceneweave'))
    const room = Object.values(before.document.rooms)[0]
    const mine = await browse(target, 'mine')
    await expect(mine.locator('.catalog-empty')).toContainText('还没有个人素材')
    for (const item of input.items) {
      const definitions = item.kind === 'material' ? before.document.materials : item.kind === 'prefab' ? before.document.prefabDefinitions : before.document.propDefinitions
      expect(definitions[item.definitionId]).toBeUndefined()
    }
    await manage(target)
    const imports = mine.locator('details.catalog-backup')
    if (await imports.getAttribute('open') === null) await imports.locator('summary').click()
    // A fresh room does not need the lazy SVG rasterizer. Read the backup once
    // through the ordinary preview and cancel while online to load that module;
    // neither the personal library nor the scene has adopted the content.
    await mine.getByLabel('导入素材库备份', { exact: true }).setInputFiles(libraryFile)
    const preview = mine.getByLabel('素材库导入预览', { exact: true })
    await expect(preview).toContainText('完整验证3项素材、3项整理', { timeout: 60000 })
    await preview.getByRole('button', { name: '取消导入预览', exact: true }).click()
    await expect(mine.locator('.catalog-empty')).toContainText('还没有个人素材')
    // Let the production reader release every warmed rasterizer before the
    // network disappears. The next validation must start a new worker.
    expect(svgWorkers.length).toBeGreaterThan(0)
    await expect.poll(() => target.workers().some(worker => svgWorkers.includes(worker)), { timeout: 12000 }).toBe(false)
    const onlineWorkerCount = svgWorkers.length
    target.on('request', requested); target.on('requestfailed', failed)
    await context.setOffline(true)
    await mine.getByLabel('导入素材库备份', { exact: true }).setInputFiles(libraryFile)
    await expect(preview).toContainText('完整验证3项素材、3项整理', { timeout: 60000 })
    await preview.getByRole('button', { name: '取消导入预览', exact: true }).click()
    expect((await keyboardProjectBackup(target, info.outputPath('target-import-cancelled.sceneweave'))).hashes).toEqual(before.hashes)
    await browse(target, 'mine'); await expect(mine.locator('.catalog-empty')).toContainText('还没有个人素材')
    await manage(target)
    await mine.getByLabel('导入素材库备份', { exact: true }).setInputFiles(libraryFile)
    await preview.getByRole('button', { name: '确认导入所选3项', exact: true }).click()
    await expect(mine.locator('.catalog-operation-status')).toContainText('已原子导入3项', { timeout: 60000 })
    expect((await keyboardProjectBackup(target, info.outputPath('target-library-only.sceneweave'))).hashes).toEqual(before.hashes)
    await browse(target, 'mine'); await selectItems(target, input); await manage(target)
    const reexport = target.waitForEvent('download', { timeout: 60000 })
    await mine.getByRole('button', { name: '备份所选内容与整理（3）', exact: true }).click()
    const restoredLibrary = info.outputPath('restored.sceneweave-library'); await (await reexport).saveAs(restoredLibrary)
    expect(JSON.parse(await readFile(restoredLibrary, 'utf8'))).toEqual(packed)
    await mine.getByRole('button', { name: '预览采用到本工程', exact: true }).click()
    await expect(target.getByRole('button', { name: '取消组件预览', exact: true })).toBeVisible({ timeout: 60000 })
    await target.getByRole('button', { name: '取消组件预览', exact: true }).click()
    expect((await keyboardProjectBackup(target, info.outputPath('target-adoption-cancelled.sceneweave'))).hashes).toEqual(before.hashes)
    await mine.getByRole('button', { name: '预览采用到本工程', exact: true }).click(); await adopt(target)
    const adopted = await keyboardProjectBackup(target, info.outputPath('target-adopted.sceneweave'))
    expect(adopted.document.props).toEqual(before.document.props)
    const prop = input.items.find(row => row.kind === 'prop')!, prefab = input.items.find(row => row.kind === 'prefab')!, material = input.items.find(row => row.kind === 'material')!
    for (const item of input.items) {
      const key = item.kind === 'prop' ? 'propDefinitions' : item.kind === 'prefab' ? 'prefabDefinitions' : 'materials'
      expect(adopted.document[key][item.definitionId]).toEqual(source.document[key][item.definitionId])
    }
    await browse(target, 'project'); await mine.getByLabel('搜索组件素材', { exact: true }).fill(prop.name)
    await mine.getByRole('button', { name: `放置组件 ${prop.name}`, exact: true }).click(); await openKeyboardPanel(target, 'inspector')
    await target.getByLabel('放置表面', { exact: true }).selectOption(`room:${room.id}`)
    await number(target, '放置 X', '3'); await number(target, '放置 Y', '3')
    await target.getByRole('button', { name: '在此放置', exact: true }).click()
    await target.getByRole('button', { name: '选择地图对象', exact: true }).click(); await keyboardWorkspaceSaved(target)
    await browse(target, 'project'); await mine.getByLabel('搜索组件素材', { exact: true }).fill(prefab.name)
    await mine.getByRole('button', { name: `放置组件 ${prefab.name}`, exact: true }).click(); await openKeyboardPanel(target, 'inspector')
    await target.getByLabel('组合放置X', { exact: true }).fill('9000'); await target.getByLabel('组合放置Y', { exact: true }).fill('5000')
    await target.getByLabel('组合支撑表面', { exact: true }).selectOption(JSON.stringify({ kind: 'room', id: room.id }))
    await target.getByRole('button', { name: '预览放置组合', exact: true }).click(); await adopt(target)
    const placing = target.getByRole('button', { name: '取消组合放置', exact: true }); if (await placing.isVisible()) await placing.click()
    const objects = await openSceneObjects(target)
    await objects.getByLabel('搜索场景对象', { exact: true }).fill(room.id); await objects.locator(`[data-entity-id="${room.id}"]`).click()
    await browse(target, 'project'); await mine.getByLabel('搜索组件素材', { exact: true }).fill(material.name)
    await mine.getByRole('button', { name: `应用材质 ${material.name}`, exact: true }).click()
    await openKeyboardPanel(target, 'inspector')
    const materialReview = target.getByRole('region', { name: '候选审阅', exact: true })
    await materialReview.getByLabel('确认完整影响范围', { exact: true }).check()
    await materialReview.getByRole('button', { name: '采用视觉修改', exact: true }).click()
    await keyboardWorkspaceSaved(target)
    const offlineBackup = info.outputPath('target-final.sceneweave')
    const final = await keyboardProjectBackup(target, offlineBackup)
    expect(svgWorkers.length).toBeGreaterThan(onlineWorkerCount)
    expect(Object.keys(final.document.prefabInstances)).toHaveLength(1)
    expect(Object.keys(final.document.props)).toHaveLength(source.document.prefabDefinitions[prefab.definitionId].members.length + 1)
    expect(final.document.rooms[room.id].floorStyle?.base.materialRef.id).toBe(material.definitionId)
    const offlinePngs = []
    for (const audience of audiences) {
      const path = info.outputPath('target-' + audience + '.png')
      await picture(target, path, audience)
      offlinePngs.push(await picturePixels(path))
    }
    await target.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    await target.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(target)
    const redone = await keyboardProjectBackup(target, info.outputPath('target-redone.sceneweave'))
    expect(redone.document.props).toEqual(final.document.props)
    await target.getByRole('button', { name: '回到首页', exact: true }).click()
    await target.locator(`[data-project-key="native:${final.document.sceneId}"]`).getByRole('button', { name: '继续编辑', exact: true }).click()
    await keyboardWorkspaceSaved(target)
    expect((await keyboardProjectBackup(target, info.outputPath('target-session-reopened.sceneweave'))).hashes).toEqual(redone.hashes)
    await target.setViewportSize({ width: 390, height: 844 }); await browse(target, 'mine')
    await mine.getByLabel('搜索组件素材', { exact: true }).fill(prop.name)
    await expect(mine.getByRole('button', { name: `查看素材 ${prop.name}`, exact: true })).toBeVisible()
    await target.screenshot({ path: info.outputPath('narrow-personal-library.png') })
    await closeWorkspaceDrawers(target)
    const offlineContentRequests = offlineRequests.filter(url => !applicationDecoration(url))
    const failedContentRequests = failedRequests.filter(url => !applicationDecoration(url))
    expect(offlineContentRequests).toEqual([]); expect(failedContentRequests).toEqual([])
    target.off('request', requested); target.off('requestfailed', failed)
    // Cold navigation needs the hosted application; the content itself has
    // already been imported, used, rendered, saved and re-opened while offline.
    await context.setOffline(false)
    await target.getByRole('button', { name: '回到首页', exact: true }).click(); await target.reload()
    await target.locator(`[data-project-key="native:${final.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(target)
    expect((await keyboardProjectBackup(target, info.outputPath('target-cold.sceneweave'))).hashes).toEqual(redone.hashes)
    for (const audience of ['gm', 'player'] as const) await picture(target, info.outputPath(`cold-${audience}.png`), audience)
    const fresh = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1512, height: 982 } })
    try {
      const imported = await fresh.newPage(); imported.on('pageerror', error => errors.push(error.message))
      await imported.goto('./#home')
      const chooser = imported.waitForEvent('filechooser')
      await imported.getByRole('button', { name: '打开工程文件', exact: true }).click()
      await (await chooser).setFiles(offlineBackup)
      await keyboardWorkspaceSaved(imported)
      const reopened = await keyboardProjectBackup(imported, info.outputPath('target-cold-import.sceneweave'))
      expect(reopened.document.sceneId).not.toBe(final.document.sceneId)
      expect(reopened.document.rooms).toEqual(final.document.rooms)
      expect(reopened.document.props).toEqual(final.document.props)
      expect(reopened.document.prefabInstances).toEqual(final.document.prefabInstances)
      expect(reopened.appearance).toEqual(final.appearance)
      expect(keyboardResourceHashes(reopened.hashes)).toEqual(keyboardResourceHashes(final.hashes))
      for (const [index, audience] of audiences.entries()) {
        const path = info.outputPath('cold-import-' + audience + '.png')
        await picture(imported, path, audience)
        expect(await picturePixels(path)).toEqual(offlinePngs[index])
      }
    } finally { await fresh.close() }
    expect(errors).toEqual([]); expect(hash(await readFile(input.project))).toBe(originalHash)
    await writeFile(info.outputPath('facts.json'), JSON.stringify({ input, originalHash, librarySha256: hash(await readFile(libraryFile)), sourceSceneId: source.document.sceneId, targetSceneId: final.document.sceneId, targetRoomId: room.id, targetProps: Object.keys(final.document.props).length, offlineRequests, failedRequests, offlineContentRequests, failedContentRequests, onlineWorkerCount, offlinePngs, svgModulePreparation: 'Online validation, cancel preview, wait for rasterizer release, restore and back up offline, then cold import.', errors, browserVersion: browser.version() }, null, 2))
  } finally { await context.close() }
})
