import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const samples = [
  { key: 'VIS-01', card: '.asset-study-card', title: '书房与露台 · 墨绘原野', assets: 15 },
  { key: 'VIS-02', card: '.asset-island-card', title: '双层岩岛 · 墨绘原野', assets: 13 },
] as const

async function openSample(page: Page, sample: typeof samples[number]) {
  await page.goto('/#assets'); await page.locator(sample.card).click()
  await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: sample.title, exact: true })).toBeVisible()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  await expect(page.getByLabel('材质场景主持人预览')).toBeVisible()
}
async function identity(page: Page) {
  return page.evaluate(async () => {
    const { workspace, repository } = Reflect.get(window, '__sceneweaveAssetsDev'), state = workspace.getState()
    return { document: structuredClone(state.project.document), persisted: (await repository.load(state.project.document.sceneId)).document,
      canUndo: state.canUndo, canRedo: state.canRedo, status: state.status, scenes: (await repository.list()).map((entry: { sceneId: string }) => entry.sceneId).sort() }
  })
}
async function completePackage(page: Page) {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '完整工程', exact: true }).click()
  const downloaded = await downloading
  return readFile((await downloaded.path())!)
}

for (const sample of samples) {
  test(`B4 ${sample.key} UI lists all missing dependencies and repair/cancel never replaces the current project`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await openSample(page, sample)
    const original = await identity(page), complete = await completePackage(page)
    const files = unzipSync(complete), manifest = JSON.parse(strFromU8(files['manifest.json']))
    const removed = manifest.entries.filter((entry: { role: string }) => entry.role === 'asset').slice(0, 2).map((entry: { path: string }) => entry.path) as string[]
    removed.push(...manifest.entries.filter((entry: { role: string }) => entry.role === 'license').map((entry: { path: string }) => entry.path))
    for (const path of removed) delete files[path]
    manifest.entries = manifest.entries.filter((entry: { path: string }) => !removed.includes(entry.path))
    files['manifest.json'] = strToU8(JSON.stringify(manifest))
    await page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '玩家', exact: true }).click()
    await expect(page.getByLabel('材质场景玩家预览')).toBeVisible()
    await page.getByLabel('选择完整素材工程').setInputFiles({ name: 'incomplete.sceneweave', mimeType: 'application/x-sceneweave', buffer: Buffer.from(zipSync(files)) })
    const diagnostics = page.getByRole('region', { name: '工程完整性检查', exact: true })
    await expect(diagnostics).toContainText('工程未通过检查')
    await expect(page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '主持人', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await diagnostics.locator('li').count()).toBeGreaterThanOrEqual(3)
    for (const path of removed.slice(0, 2)) await expect(diagnostics).toContainText(path.slice(7, -4))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await identity(page)).toEqual(original)
    const failedScreenshot = testInfo.outputPath(`b4-${sample.key}-missing-dependencies.png`)
    await page.screenshot({ path: failedScreenshot }); await testInfo.attach('missing-dependencies.png', { path: failedScreenshot, contentType: 'image/png' })
    const choosing = page.waitForEvent('filechooser')
    await diagnostics.getByRole('button', { name: '选择修复后的工程', exact: true }).click()
    await (await choosing).setFiles({ name: 'repaired.sceneweave', mimeType: 'application/x-sceneweave', buffer: complete })
    const dialog = page.getByRole('dialog', { name: '确认打开素材工程', exact: true })
    await expect(dialog).toContainText(sample.title)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    expect(await identity(page)).toEqual(original)
    await expect(diagnostics).toHaveCount(0)
    await page.getByRole('button', { name: '校验完整工程', exact: true }).click()
    await expect(diagnostics).toContainText('完整工程检查通过')
    await expect(diagnostics).toContainText(`${sample.assets} 项 · ${sample.assets} 份图片`)
    expect(await identity(page)).toEqual(original)
    await page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '玩家', exact: true }).click()
    await expect(diagnostics).toHaveCount(0)
    await expect(page.getByLabel('材质场景玩家预览')).toBeVisible()
    await page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '主持人', exact: true }).click()
    await expect(diagnostics).toHaveCount(0)
    await page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '玩家', exact: true }).click()
    await expect(page.getByLabel('材质场景玩家预览')).toBeVisible()
    const corruptedHash = await page.evaluate(async () => {
      const { repository, workspace } = Reflect.get(window, '__sceneweaveAssetsDev')
      const table = repository.db.table('assetBlobs'), hash = Object.keys(workspace.getState().project.assets)[0]
      const original = await table.get(hash)
      Reflect.set(window, '__b4RecentResource', { table, original })
      await table.put({ ...original, blob: new Blob(['B4 invalid stored bytes'], { type: original.mimeType }) })
      return hash
    })
    try {
      await page.locator('.asset-recents > summary').click()
      await page.locator('.asset-recent button').first().click()
      await expect(diagnostics).toContainText('工程未通过检查')
      await expect(diagnostics).toContainText(corruptedHash)
      await expect(diagnostics).toContainText('打开本地工程')
      await expect(page.getByRole('group', { name: '预览受众' }).getByRole('button', { name: '主持人', exact: true })).toHaveAttribute('aria-pressed', 'true')
    } finally {
      await page.evaluate(async () => { const { table, original } = Reflect.get(window, '__b4RecentResource'); await table.put(original) })
    }
    expect(await identity(page)).toEqual(original)
    expect(errors).toEqual([])
    const report = testInfo.outputPath(`b4-${sample.key}-diagnostics.json`)
    await writeFile(report, JSON.stringify({ sample: sample.key, missingPaths: removed, repairPreparedButCancelled: true, identityHistoryAndPersistedUnchanged: true, completeCheckPassed: true, diagnosticClearedOnPrepare: true, diagnosticClearedOnAudienceSwitch: true, corruptRecentOpenFromPlayerShowsDiagnostic: true, browserErrors: errors }, null, 2))
    await testInfo.attach('diagnostics.json', { path: report, contentType: 'application/json' })
  })

  test(`B4 ${sample.key} cancelling an actual pending decode discards its late result and retains saved editing history`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await openSample(page, sample)
    const original = await identity(page), complete = await completePackage(page)
    // Resizes can schedule another viewport crop at any time. Only hold/count
    // fresh imported Blobs; previews keep the current project's Blob identities.
    await page.evaluate(() => {
      const { workspace } = Reflect.get(window, '__sceneweaveAssetsDev')
      const assets = workspace.getState().project.assets as Record<string, { blob: Blob }>
      const visibleResources = new WeakSet(Object.values(assets).map(resource => resource.blob))
      const original = window.createImageBitmap.bind(window)
      const probe = { decoded: 0, closed: 0, ignoredPreview: 0, release: null as (() => void) | null, restore: () => { window.createImageBitmap = original } }
      window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
        const bitmap = await (original as (...input: Parameters<typeof createImageBitmap>) => Promise<ImageBitmap>)(...args)
        if (visibleResources.has(args[0] as Blob)) { probe.ignoredPreview++; return bitmap }
        probe.decoded++
        const close = bitmap.close.bind(bitmap); bitmap.close = () => { probe.closed++; close() }
        if (probe.decoded === 1) await new Promise<void>(resolve => { probe.release = resolve })
        return bitmap
      }) as typeof createImageBitmap
      Reflect.set(window, '__b4WorkbenchDecode', probe)
    })
    try {
      await page.getByLabel('选择完整素材工程').setInputFiles({ name: 'cancelled.sceneweave', mimeType: 'application/x-sceneweave', buffer: complete })
      await page.waitForFunction(() => Reflect.get(window, '__b4WorkbenchDecode').release !== null)
      await page.getByRole('button', { name: '取消准备', exact: true }).click()
      await page.evaluate(() => Reflect.get(window, '__b4WorkbenchDecode').release())
      await expect(page.getByRole('alert')).toContainText('准备已取消')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.asset-busy')).toHaveCount(0)
      expect(await identity(page)).toEqual(original)
      const cleanup = await page.evaluate(() => { const probe = Reflect.get(window, '__b4WorkbenchDecode'); return { decoded: probe.decoded, closed: probe.closed, ignoredPreview: probe.ignoredPreview } })
      expect(cleanup.decoded).toBeGreaterThan(0); expect(cleanup.closed).toBe(cleanup.decoded)
      const report = testInfo.outputPath(`b4-${sample.key}-cancel.json`)
      await writeFile(report, JSON.stringify({ sample: sample.key, lateDecodeDiscarded: true, identityHistoryAndPersistedUnchanged: true, ...cleanup }, null, 2))
      await testInfo.attach('cancel.json', { path: report, contentType: 'application/json' })
    } finally {
      await page.evaluate(() => { const probe = Reflect.get(window, '__b4WorkbenchDecode'); probe.release?.(); probe.restore() })
    }
  })
}
