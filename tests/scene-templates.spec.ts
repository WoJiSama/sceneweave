import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

async function pixels(page: import('@playwright/test').Page, info: import('@playwright/test').TestInfo, phase: string) {
  const result: Record<string, unknown> = {}
  for (const audience of ['gm', 'player'] as const) {
    const pending = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
    const path = info.outputPath(`${phase}-${audience}.png`); await (await pending).saveAs(path); await keyboardWorkspaceSaved(page)
    await page.locator('.workspace-export-menu > summary').click()
    result[audience] = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)])), canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))).map(value => value.toString(16).padStart(2, '0')).join('')
      return { width: canvas.width, height: canvas.height, rgbaSha256: hash }
    }, [...await readFile(path)])
  }
  return result
}

test('ordinary themed room template library supports preview/cancel/adopt, undo, portable backup and cold reuse', async ({ page }, info) => {
  test.setTimeout(300000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home'); await createKeyboardProject(page, '模板目标工程')
  await openWorkspaceModule(page, '素材与布景')
  const library = page.getByRole('region', { name: '房间与建筑模板', exact: true })
  await library.getByText('灰橡主题房间', { exact: true }).click()
  await library.getByRole('button', { name: '准备主题房间模板', exact: true }).click()
  await expect(library.getByRole('status')).toContainText('已入库', { timeout: 90000 })
  await expect(library.getByLabel('我的场景模板')).toContainText('紧凑单床')
  const downloading = page.waitForEvent('download')
  await library.getByRole('button', { name: '导出所选模板', exact: true }).click()
  const templatePath = info.outputPath('guest-compact.sceneweave-template'); await (await downloading).saveAs(templatePath)
  const backupDownload = page.waitForEvent('download')
  await library.getByRole('button', { name: '备份全部场景模板', exact: true }).click()
  const backupPath = info.outputPath('rooms.sceneweave-templates'); await (await backupDownload).saveAs(backupPath)
  await expect(library.getByRole('status')).toContainText('已导出模板库备份')
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const preview = () => library.getByRole('button', { name: '预览放置场景模板', exact: true }).click()
  await preview()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible({ timeout: 60000 }); await expect(review).toContainText('紧凑单床')
  await page.screenshot({ path: info.outputPath('guest-candidate.png') })
  await review.getByRole('button', { name: '取消结构预览', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('cancelled.sceneweave'))).hashes).toEqual(before.hashes)
  await preview(); await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('adopted.sceneweave'))
  expect(Object.keys(adopted.document.rooms)).toHaveLength(1)
  expect(Object.keys(adopted.document.props).length).toBeGreaterThan(1)
  await page.screenshot({ path: info.outputPath('guest-adopted.png') })
  const adoptedPixels = await pixels(page, info, 'adopted')
  const groups = await openSceneObjects(page, '组合'), groupId = Object.keys(adopted.document.prefabInstances)[0]
  await groups.locator(`[data-entity-id=${JSON.stringify(groupId)}]`).click(); await openWorkspaceModule(page, '素材与布景')
  const dressing = page.getByRole('region', { name: '保存当前布景', exact: true })
  await dressing.getByLabel('布景模板名称').fill('当前客房真实布景')
  await dressing.getByRole('button', { name: '保存当前布景到我的素材', exact: true }).click()
  await expect(dressing.getByRole('status')).toContainText('已保存', { timeout: 60000 })
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))).document.rooms).toEqual({})
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${adopted.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await page.context().setOffline(true)
  expect((await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))).document.props).toEqual(adopted.document.props)
  const coldPixels = await pixels(page, info, 'cold'); expect(coldPixels).toEqual(adoptedPixels)
  await page.context().setOffline(false)
  await writeFile(info.outputPath('pixel-comparison.json'), JSON.stringify({ adopted: adoptedPixels, cold: coldPixels }, null, 2))
  await openWorkspaceModule(page, '素材与布景')
  await library.getByLabel('我的场景模板').selectOption({ label: '灰橡客房 · 紧凑单床' })
  await library.getByRole('button', { name: '移除所选本机模板', exact: true }).click()
  await expect(library.getByRole('status')).toContainText('已移除')
  await library.getByLabel('导入场景模板文件', { exact: true }).setInputFiles(backupPath)
  await expect(library.getByRole('status')).toContainText('已导入1个模板', { timeout: 60000 })
  await createKeyboardProject(page, '另一工程放置模板')
  await openWorkspaceModule(page, '素材与布景')
  await library.getByLabel('我的场景模板').selectOption({ label: '灰橡客房 · 紧凑单床' })
  await library.getByLabel('场景模板X米').fill('12'); await library.getByLabel('场景模板朝向').selectOption('1')
  await preview(); await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const independent = await keyboardProjectBackup(page, info.outputPath('independent.sceneweave'))
  expect(Object.keys(independent.document.rooms)).toHaveLength(1)
  expect(Object.keys(independent.document.props).some(id => adopted.document.props[id])).toBe(false)
  await writeFile(info.outputPath('page-errors.json'), JSON.stringify(errors, null, 2)); expect(errors).toEqual([])
})

test('six coordinated purpose rooms export editable source results and independent real GM/player images', async ({ page }, info) => {
  test.setTimeout(600000)
  const presets = ['guest-compact', 'guest-spacious', 'kitchen-compact', 'kitchen-spacious', 'storage-compact', 'storage-spacious']
  const manifest: unknown[] = [], errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  for (const id of presets) {
    await createKeyboardProject(page, `灰橡主题交付 ${id}`); await openWorkspaceModule(page, '素材与布景')
    const library = page.getByRole('region', { name: '房间与建筑模板', exact: true })
    await library.getByText('灰橡主题房间', { exact: true }).click(); await library.getByLabel('主题房间样板').selectOption(id)
    await library.getByRole('button', { name: '准备主题房间模板', exact: true }).click()
    await expect(library.getByRole('status').last()).toContainText('已入库', { timeout: 90000 })
    const status = await library.getByRole('status').last().textContent(), pending = page.waitForEvent('download')
    await library.getByRole('button', { name: '导出所选模板', exact: true }).click()
    await (await pending).saveAs(info.outputPath(`${id}.sceneweave-template`))
    await library.getByRole('button', { name: '预览放置场景模板', exact: true }).click()
    const review = page.getByRole('region', { name: '候选审阅', exact: true })
    await expect(review).toBeVisible({ timeout: 60000 }); await review.getByLabel('确认完整影响范围', { exact: true }).check()
    await review.getByRole('button', { name: '采用结构修改', exact: true }).click(); await keyboardWorkspaceSaved(page)
    const project = await keyboardProjectBackup(page, info.outputPath(`${id}.sceneweave`)), images = await pixels(page, info, id)
    const template = page.getByRole('region', { name: '房间与建筑模板', exact: true })
    await template.getByText('保存当前房间／建筑', { exact: true }).click()
    const room = Object.values(project.document.rooms)[0]
    await template.getByRole('checkbox', { name: room.purpose, exact: true }).check()
    await template.getByLabel('场景模板名称').fill(`实际摆位副本 ${id}`)
    await template.getByRole('button', { name: '保存完整场景模板', exact: true }).click()
    await expect(template.getByRole('status').last()).toContainText('源工程未修改', { timeout: 60000 })
    manifest.push({ id, status, sceneId: project.document.sceneId, props: Object.keys(project.document.props).length, rooms: Object.keys(project.document.rooms).length, images })
  }
  const library = page.getByRole('region', { name: '房间与建筑模板', exact: true }), pending = page.waitForEvent('download')
  await library.getByRole('button', { name: '备份全部场景模板', exact: true }).click()
  await (await pending).saveAs(info.outputPath('gray-oak-six-rooms.sceneweave-templates'))
  await expect(library.getByRole('status').last()).toContainText('已导出模板库备份')
  await writeFile(info.outputPath('six-room-manifest.json'), JSON.stringify({ examples: manifest, errors }, null, 2))
  expect(errors).toEqual([])
})
