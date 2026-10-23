import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openCalibration(page: Page) {
  await page.goto('/#assets')
  await page.locator('.asset-new-card').click()
  await expect(page.getByRole('dialog', { name: '确认打开素材工程' })).toBeVisible()
  await page.getByRole('button', { name: '保存并打开副本' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '木纹书房 · 材质校样', exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '本地已保存' })).toBeVisible()
}
async function changeNumber(page: Page, label: string, value: string) {
  await page.getByRole('spinbutton', { name: label, exact: true }).fill(value)
  await page.getByRole('spinbutton', { name: label, exact: true }).press('Tab')
}
async function saved(page: Page) { await expect(page.locator('.asset-save')).toHaveText('本地已保存') }
async function identity(page: Page) {
  return page.evaluate(() => {
    const { workspace } = Reflect.get(window, '__sceneweaveAssetsDev')
    const state = workspace.getState()
    return { document: state.project.document, hashes: Object.keys(state.project.assets).sort(), status: state.status }
  })
}

test('unavailable selection preferences keep complete projects usable through the recent list', async ({ page }) => {
  await page.addInitScript(() => {
    const storage = window.localStorage
    Object.defineProperty(window, 'localStorage', { configurable: true, value: new Proxy(storage, {
      get(target, key) {
        if (key === 'getItem' || key === 'setItem') return (name: string, ...args: string[]) => {
          if (name === 'sceneweave.assetSceneId') throw new DOMException('Preferences unavailable', 'SecurityError')
          return key === 'getItem' ? target.getItem(name) : target.setItem(name, args[0])
        }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) })
  })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await openCalibration(page)
  const original = await identity(page)
  await page.reload()
  await expect(page.locator('.asset-recent button').first()).toBeVisible()
  await page.locator('.asset-recent button').first().click(); await saved(page)
  expect(await identity(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('asset workbench edits, undo, reload and complete import preserve all resources', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await openCalibration(page)
  await expect(page.getByLabel('材质场景主持人预览')).toBeVisible()
  await page.getByRole('button', { name: '书桌校样', exact: true }).click()
  await page.getByRole('spinbutton', { name: '物件 X', exact: true }).fill('6700')
  await page.getByRole('spinbutton', { name: '物件 X', exact: true }).press('Escape')
  await expect(page.getByRole('spinbutton', { name: '物件 X', exact: true })).toHaveValue('5000')
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '0')
  await changeNumber(page, '物件 X', '5500')
  await expect(page.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '1')
  await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '物件 X', exact: true })).toHaveValue('5000')
  await page.getByRole('button', { name: '重做素材编辑', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '物件 X', exact: true })).toHaveValue('5500')
  await page.getByRole('button', { name: '返回工程信息' }).click()
  await changeNumber(page, '木纹方向', '90')
  await saved(page)
  const edited = await identity(page)
  expect(edited.document.revision).toBe(4)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const download = await downloadPromise, path = (await download.path())!
  const bytes = await readFile(path)
  await testInfo.attach('complete-calibration.sceneweave', { body: bytes, contentType: 'application/zip' })
  await page.reload(); await saved(page)
  expect(await identity(page)).toEqual(edited)
  // A cancelled preview must not adopt or write an extra scene.
  await page.getByLabel('选择完整素材工程').setInputFiles({ name: 'roundtrip.sceneweave', mimeType: 'application/zip', buffer: bytes })
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(await identity(page)).toEqual(edited)
  // Corrupt input leaves the displayed document and stored data untouched.
  await page.getByLabel('选择完整素材工程').setInputFiles({ name: 'corrupt.sceneweave', mimeType: 'application/zip', buffer: Buffer.from('broken zip') })
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await identity(page)).toEqual(edited)
  await page.getByLabel('选择完整素材工程').setInputFiles({ name: 'roundtrip.sceneweave', mimeType: 'application/zip', buffer: bytes })
  await page.getByRole('button', { name: '保存并打开副本' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await saved(page)
  const imported = await identity(page)
  expect(imported.document.sceneId).not.toBe(edited.document.sceneId)
  expect(imported.document.revision).toBe(0)
  expect(imported.hashes).toEqual(edited.hashes)
  expect(imported.document.props).toEqual(edited.document.props)
  expect(imported.document.rooms).toEqual(edited.document.rooms)
  await page.getByRole('button', { name: '校验完整工程', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('完整工程校验通过')
  // A report changes the available viewport while preserving actual px/mm.
  // Fitting the whole image is an explicit action under the U1b contract.
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await expect.poll(() => page.locator('.asset-viewport').evaluate(element => ({ zoom: Number((element as HTMLElement).dataset.zoom), x: Number((element as HTMLElement).dataset.panX), y: Number((element as HTMLElement).dataset.panY) }))).toEqual({ zoom: 1, x: 0, y: 0 })
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const canvasBox = (await page.getByLabel('材质场景主持人预览').boundingBox())!, viewportBox = (await page.locator('.asset-viewport').boundingBox())!
  expect(canvasBox.x).toBeGreaterThanOrEqual(viewportBox.x - 2)
  expect(canvasBox.y).toBeGreaterThanOrEqual(viewportBox.y - 2)
  expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width + 2)
  expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height + 2)
  // Ensure the preview has really decoded and drawn non-flat material pixels.
  const pixels = await page.getByLabel('材质场景主持人预览').evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext('2d')!, bytes = ctx.getImageData(0, 0, element.width, element.height).data
    const colors = new Set<string>()
    for (let index = 0; index < bytes.length; index += 40) colors.add(`${bytes[index]},${bytes[index + 1]},${bytes[index + 2]}`)
    return colors.size
  })
  expect(pixels).toBeGreaterThan(100)
  const screenshot = testInfo.outputPath('asset-workbench.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  await testInfo.attach('asset-workbench.png', { path: screenshot, contentType: 'image/png' })
  await testInfo.attach('workbench-roundtrip.json', { body: JSON.stringify({ sameAssetHashes: true, editsAndUndoRetained: true, corruptAndCancelPreserved: true, pixels, browser: await page.context().browser()!.version(), hashes: imported.hashes, revision: edited.document.revision }, null, 2), contentType: 'application/json' })
  expect(errors).toEqual([])
})

test('M0 migration uses its saved revision, keeps its original and restores history as a copy', async ({ page }, testInfo) => {
  await page.goto('/#geometry')
  await expect(page.getByRole('heading', { name: '雾灯宅', exact: true })).toBeVisible()
  await expect(page.getByText('本地已保存', { exact: true })).toBeVisible()
  const source = await page.evaluate(() => structuredClone(Reflect.get(window, '__sceneweaveDev').store.getState().document))
  await page.getByRole('button', { name: '素材工坊', exact: true }).click()
  await page.getByRole('button', { name: '迁移当前 M0 场景' }).click()
  await expect(page.getByRole('dialog')).toContainText(`实际来源修订 r${source.revision}`)
  await page.getByRole('button', { name: '保存并打开副本' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await saved(page)
  const check = await page.evaluate(async sceneId => {
    const { workspace } = Reflect.get(window, '__sceneweaveAssetsDev'), project = workspace.getState().project
    const path = '/src/io/storage.ts', { SceneRepository } = await import(path), repository = new SceneRepository()
    try { return { source: await repository.load(sceneId), target: project.document, metadata: { ...project.migrationSource, original: undefined }, original: JSON.parse(await project.migrationSource.original.text()) } } finally { repository.close() }
  }, source.sceneId)
  expect(check.source).toEqual(source); expect(check.original).toEqual(source)
  expect(check.metadata.sourceRevision).toBe(source.revision)
  expect(check.target.sceneId).not.toBe(source.sceneId)
  expect(check.target.notes).toEqual(source.notes)
  const selected = Object.values(check.target.props).find((prop: any) => !prop.editLocked) as any
  await page.getByRole('button', { name: `符号物件 · ${selected.id}`, exact: true }).click()
  await changeNumber(page, '物件旋转', '45'); await saved(page)
  await page.getByRole('button', { name: '素材历史快照' }).click()
  await page.getByRole('button', { name: '恢复副本', exact: true }).last().click()
  await expect(page.getByRole('dialog')).toContainText('从历史快照创建副本')
  await page.getByRole('button', { name: '保存并打开副本' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await saved(page)
  const restored = await identity(page)
  expect(restored.document.sceneId).not.toBe(check.target.sceneId)
  expect(restored.document.props).toEqual(check.target.props)
  await testInfo.attach('migration.json', { body: JSON.stringify({ sourceUnchanged: true, originalBytesPreserved: true, savedRevision: source.revision, newSceneId: true, secretsAndNotesPreserved: true, historicalCopyRestored: true }, null, 2), contentType: 'application/json' })
})

test('two v2 tabs retain a stale edited branch and can save it as an independent copy', async ({ page, context }, testInfo) => {
  await openCalibration(page)
  const original = await identity(page)
  const second = await context.newPage(); await second.goto('/#assets'); await saved(second)
  expect((await identity(second)).document.sceneId).toBe(original.document.sceneId)
  await page.getByRole('button', { name: '书桌校样', exact: true }).click()
  await second.getByRole('button', { name: '书桌校样', exact: true }).click()
  await changeNumber(page, '物件 X', '5500'); await saved(page)
  await changeNumber(second, '物件 X', '6000')
  await expect(second.locator('.asset-save')).toHaveText('版本冲突')
  await expect(second.getByRole('spinbutton', { name: '物件 X', exact: true })).toHaveValue('6000')
  await second.getByRole('button', { name: '另存副本', exact: true }).click(); await saved(second)
  const branch = await identity(second)
  expect(branch.document.sceneId).not.toBe(original.document.sceneId)
  expect(branch.document.props['p-cal-0'].positionMm.x).toBe(6000)
  const first = await page.evaluate(async id => (await Reflect.get(window, '__sceneweaveAssetsDev').repository.load(id)).document, original.document.sceneId)
  expect(first.props['p-cal-0'].positionMm.x).toBe(5500)
  await testInfo.attach('two-tab-cas.json', { body: JSON.stringify({ staleWriteRejected: true, firstBranchX: 5500, independentCopyX: 6000, hashesRetained: branch.hashes }, null, 2), contentType: 'application/json' })
  await second.close()
})
