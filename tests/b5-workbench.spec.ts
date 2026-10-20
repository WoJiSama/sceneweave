import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const fixturePath = '/src/editor/v2/performance-fixtures.ts'
const projectPath = '/src/io/v2/project-file.ts'

for (const sample of ['study', 'island'] as const) for (const count of [500, 2000] as const) {
  test(`B5 ${sample} ${count}: full workbench imports, selects, edits, previews, backs up and reopens offline`, async ({ page, browser }, testInfo) => {
    await page.goto('/#assets')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const fixtureDirectory = process.env.SCENEWEAVE_B5_FIXTURE_DIR
    const fixture = fixtureDirectory ? {
      bytes: [...await readFile(path.join(fixtureDirectory, 'fixtures', `${sample}-${count}.sceneweave`))],
      summary: JSON.parse(await readFile(path.join(fixtureDirectory, 'manifest.json'), 'utf8')).cases.find((entry: { name: string }) => entry.name === `${sample}-${count}`).summary,
    } : await page.evaluate(async ({ fixturePath, projectPath, sample, count }) => {
      const { createPerformanceFixtureV2 } = await import(fixturePath), { exportProjectV2 } = await import(projectPath)
      const { project, summary } = await createPerformanceFixtureV2(sample, count)
      const blob = await exportProjectV2(project)
      return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), summary }
    }, { fixturePath, projectPath, sample, count })
    expect(await page.evaluate(() => Reflect.has(window, '__sceneweavePerformance'))).toBe(false)
    const report: Record<string, unknown> = { sample, count, summary: fixture.summary }
    await page.getByLabel('选择完整素材工程').setInputFiles({ name: `${sample}-${count}.sceneweave`, mimeType: 'application/x-sceneweave', buffer: Buffer.from(fixture.bytes) })
    await page.getByRole('button', { name: '保存并打开副本', exact: true }).click()
    const shell = page.getByTestId('asset-workbench'), saved = () => expect(page.locator('.asset-save')).toHaveText('本地已保存')
    await saved(); await expect(shell).toHaveAttribute('data-revision', '0')
    await expect(page.locator('.asset-canvas-footer')).toContainText(`${count} 件物件`)
    const canvas = page.getByLabel('材质场景主持人预览')
    await expect(canvas).toBeVisible()
    const rect = await canvas.boundingBox(), p = fixture.summary.selectionPointMm, bounds = fixture.summary.worldBoundsMm
    if (!rect) throw new Error('No real product canvas')
    await page.mouse.click(rect.x + (p.x - bounds.x) / bounds.width * rect.width, rect.y + (p.y - bounds.y) / bounds.height * rect.height)
    await expect(page.getByRole('heading', { name: '物件属性', exact: true })).toBeVisible()
    await expect(page.getByLabel('物件旋转')).toHaveValue('0')
    await page.getByLabel('物件旋转').fill('15'); await page.getByLabel('物件旋转').press('Enter')
    await expect(shell).toHaveAttribute('data-revision', '1'); await saved()
    await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
    await expect(page.getByLabel('物件旋转')).toHaveValue('0')
    await page.getByRole('button', { name: '重做素材编辑', exact: true }).click()
    await expect(page.getByLabel('物件旋转')).toHaveValue('15'); await saved()
    const target = fixture.summary.contourEditTarget
    await page.getByRole('group', { name: '场景对象分类' }).getByRole('button', { name: '结构', exact: true }).click()
    await page.locator(`[data-entity-id="${target.kind === 'vertex' ? target.id : target.pointId}"]`).click()
    const coordinate = page.getByLabel(sample === 'study' ? '顶点 X' : '轮廓点 X', { exact: true })
    await coordinate.fill(String(target.positionMm.x + 1)); await coordinate.press('Enter')
    await expect(page.getByRole('button', { name: '采用结构修改', exact: true })).toBeVisible()
    await expect(shell).toHaveAttribute('data-revision', '3')
    await page.getByRole('button', { name: '取消结构预览', exact: true }).click()
    await expect(coordinate).toHaveValue(String(target.positionMm.x))
    await coordinate.fill(String(target.positionMm.x + 1)); await coordinate.press('Enter')
    await page.getByRole('button', { name: '采用结构修改', exact: true }).click()
    await expect(shell).toHaveAttribute('data-revision', '4'); await saved()
    await page.getByRole('button', { name: '撤销素材编辑', exact: true }).click()
    await expect(shell).toHaveAttribute('data-revision', '5'); await saved()
    await expect(coordinate).toHaveValue(String(target.positionMm.x))
    report.actualProductInteractions = { pointerSelection: true, propEditUndoRedo: true, contourCandidateCancelAdoptUndo: true, monotonicRevision: 5 }
    await expect(canvas).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`${sample}-${count}-workbench.png`) })
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '完整工程', exact: true }).click()
    const download = await pending, file = await download.path()
    if (!file) throw new Error('No complete project download')
    const fresh = await browser.newContext()
    try {
      const reopened = await fresh.newPage()
      reopened.on('pageerror', error => errors.push(error.message))
      await reopened.goto('/#assets')
      await expect(reopened.getByTestId('asset-workbench')).toBeVisible()
      const offlineRequests: string[] = []
      reopened.on('request', request => offlineRequests.push(new URL(request.url()).pathname))
      await fresh.setOffline(true)
      await reopened.getByLabel('选择完整素材工程').setInputFiles(file)
      await reopened.getByRole('button', { name: '保存并打开副本', exact: true }).click()
      await expect(reopened.locator('.asset-save')).toHaveText('本地已保存')
      await expect(reopened.locator('.asset-canvas-footer')).toContainText(`${count} 件物件`)
      await expect(reopened.getByLabel('材质场景主持人预览')).toBeVisible()
      await reopened.getByRole('group', { name: '场景对象分类' }).getByRole('button', { name: '物件', exact: true }).click()
      await reopened.locator(`[data-entity-id="${fixture.summary.editablePropId}"]`).click()
      await expect(reopened.getByLabel('物件旋转')).toHaveValue('15')
      await reopened.getByLabel('物件旋转').fill('16'); await reopened.getByLabel('物件旋转').press('Enter')
      await expect(reopened.getByTestId('asset-workbench')).toHaveAttribute('data-revision', '1')
      await expect(reopened.locator('.asset-save')).toHaveText('本地已保存')
      expect(offlineRequests).toEqual([])
      report.offlineDataReopen = { emptyStorage: true, runtimePreloadedOnline: true, requestsAfterOffline: offlineRequests, editable: true }
    } finally { await fresh.close() }
    expect(errors).toEqual([])
    await testInfo.attach(`${sample}-${count}-workbench.json`, { body: JSON.stringify(report), contentType: 'application/json' })
  })
}
