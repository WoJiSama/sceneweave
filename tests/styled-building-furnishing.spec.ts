import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { keyboardProjectBackup, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'
import { openSamples, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const roles = { bed: '床', storage: '储物柜', table: '桌子', seat: '座椅', work: '工作台', hearth: '炉台', shelf: '搁架' }
const briefs = [
  { id: 'house', name: '中世纪住宅 · 待布置', era: 'medieval', style: 'peasant', rooms: [{ bed: 1, storage: 2, seat: 1 }, { storage: 2 }, { table: 1, seat: 1, storage: 1 }, { table: 1, seat: 4, storage: 1 }], missing: ['厨房炉具', '洗漱与生活小件', '专用书桌及书架'] },
  { id: 'tavern', name: '西幻酒馆 · 待布置', era: 'fantasy', style: 'dwarven', rooms: [{ bed: 2, storage: 1, seat: 1 }, { storage: 4 }, { table: 3, seat: 8, storage: 2 }], missing: ['酒具', '专用吧台', '厨房炉具及酿造设备'] },
  { id: 'office', name: '1920年代事务所 · 待布置', era: '1920s', style: 'arts-crafts', rooms: [{ work: 2, seat: 2, storage: 2 }, { storage: 4, seat: 1 }, { work: 1, seat: 3, storage: 1 }], missing: ['电话', '打字机', '档案小件'] },
] as const
async function adopt(page: Page) {
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible({ timeout: 90000 })
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用结构修改', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}
async function outputs(page: Page, info: TestInfo, prefix: string) {
  const results: Record<string, unknown> = {}
  for (const audience of ['gm', 'player'] as const) {
    const pending = page.waitForEvent('download'); await (await mapExportButton(page, audience)).click()
    const path = info.outputPath(`${prefix}-${audience}.png`); await (await pending).saveAs(path)
    await keyboardWorkspaceSaved(page); await page.locator('.workspace-export-menu > summary').click()
    results[audience] = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)])), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close()
      const hash = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, canvas.width, canvas.height).data)
      return { width: canvas.width, height: canvas.height, rgba: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('') }
    }, [...await readFile(path)])
  }
  return results
}
for (const brief of briefs) test(`${brief.id}: ordinary styled multi-room furnishing, review, cancel, undo, cold read and outputs`, async ({ page }, info) => {
  test.setTimeout(420000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home'); await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const newScene = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await newScene.getByLabel('场景名称', { exact: true }).fill(`${brief.id}独立建筑布置`)
  await newScene.getByRole('button', { name: '创建空白场景', exact: true }).click(); await keyboardWorkspaceSaved(page)
  await openSamples(page); await page.getByRole('button', { name: brief.name, exact: true }).click()
  const open = page.getByRole('dialog', { name: '确认打开工程', exact: true }); await expect(open).toBeVisible({ timeout: 90000 })
  await open.getByRole('button', { name: '保存并打开副本', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const before = await keyboardProjectBackup(page, info.outputPath(`${brief.id}-empty-building.sceneweave`))
  expect(Object.keys(before.document.rooms)).toHaveLength(brief.rooms.length); expect(Object.keys(before.document.props)).toHaveLength(0)
  await openWorkspaceModule(page, '素材与布景')
  const panel = page.getByRole('region', { name: '按用途布置现有房间', exact: true }), queue = panel.getByRole('region', { name: '本次建筑布置', exact: true })
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  for (const [index, counts] of brief.rooms.entries()) {
    await panel.getByLabel('用途布置目标房间', { exact: true }).selectOption(`styled-${brief.id}-room-${index + 1}`)
    await panel.getByLabel('用途布置家具来源', { exact: true }).selectOption('collection')
    await panel.getByLabel('用途布置年代', { exact: true }).selectOption(brief.era)
    await panel.getByLabel('用途布置风格', { exact: true }).selectOption(brief.style)
    for (const [role, name] of Object.entries(roles)) await panel.getByLabel(`布置${name}数量`, { exact: true }).fill(String((counts as Record<string, number>)[role] ?? 0))
    if (!index) {
      await panel.getByRole('button', { name: '查看匹配素材图', exact: true }).click()
      await expect(panel.locator('.furnishing-material-image').first()).toBeVisible({ timeout: 90000 })
      await expect(panel.getByRole('button', { name: '预览用途布置', exact: true })).toBeEnabled({ timeout: 90000 })
      if (brief.id === 'house') {
        await panel.getByLabel('布置炉台数量', { exact: true }).fill('1')
        await expect(panel.getByRole('alert')).toContainText('还缺少炉台')
        await expect(panel.getByRole('button', { name: '预览用途布置', exact: true })).toBeDisabled()
        await panel.getByLabel('布置炉台数量', { exact: true }).fill('0')
      }
      await panel.getByRole('button', { name: '预览用途布置', exact: true }).click()
      await expect(review).toBeVisible({ timeout: 90000 }); await review.getByRole('button', { name: '返回调整布置', exact: true }).click()
      await expect(panel.getByLabel('用途布置风格', { exact: true })).toHaveValue(brief.style)
    }
    await panel.getByRole('button', { name: '加入本次建筑布置', exact: true }).click()
  }
  await expect(queue.locator('[data-furnishing-room]')).toHaveCount(brief.rooms.length)
  await panel.getByLabel('用途布置布局变化', { exact: true }).fill(`${brief.id}-rearranged`)
  await expect(queue.getByRole('button', { name: `预览本次${brief.rooms.length}个房间`, exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '更新此房间设置', exact: true }).click()
  await queue.getByRole('button', { name: `预览本次${brief.rooms.length}个房间`, exact: true }).click()
  await expect(review.getByLabel('逐房布置结果')).toBeVisible({ timeout: 90000 })
  const resultText = await review.getByLabel('用途布置结果', { exact: true }).first().textContent()
  await page.screenshot({ path: info.outputPath(`${brief.id}-candidate.png`) })
  await review.getByRole('button', { name: '返回调整布置', exact: true }).click()
  await expect(queue.locator('[data-furnishing-room]')).toHaveCount(brief.rooms.length)
  expect((await keyboardProjectBackup(page, info.outputPath(`${brief.id}-cancelled.sceneweave`))).hashes).toEqual(before.hashes)
  await queue.getByRole('button', { name: `预览本次${brief.rooms.length}个房间`, exact: true }).click(); await adopt(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath(`${brief.id}-furnished.sceneweave`))
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  for (const room of Object.values(adopted.document.rooms)) expect(room.furnishingPlan).toBeDefined()
  expect(Object.keys(adopted.document.props).length).toBeGreaterThan(brief.rooms.length)
  for (const definition of Object.values(adopted.document.propDefinitions)) expect(definition.catalogId.endsWith(brief.style)).toBe(true)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath(`${brief.id}-undone.sceneweave`))
  expect(undone.document.props).toEqual(before.document.props); expect(undone.document.rooms).toEqual(before.document.rooms)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const images = await outputs(page, info, brief.id)
  await page.reload(); await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${adopted.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click(); await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath(`${brief.id}-cold.sceneweave`))
  expect(cold.document.rooms).toEqual(adopted.document.rooms); expect(cold.document.props).toEqual(adopted.document.props)
  const coldImages = await outputs(page, info, `${brief.id}-cold`); expect(coldImages).toEqual(images)
  if (brief.id === 'house') {
    await openWorkspaceModule(page, '素材与布景')
    await panel.getByLabel('用途布置目标房间', { exact: true }).selectOption('styled-house-room-1')
    await panel.getByLabel('用途布置家具来源', { exact: true }).selectOption('collection')
    await panel.getByLabel('用途布置年代', { exact: true }).selectOption('fantasy')
    await panel.getByLabel('用途布置风格', { exact: true }).selectOption('elven')
    await panel.getByLabel('布置床素材', { exact: true }).selectOption('furniture-collection-v1-prop-bed-peasant')
    await expect(panel.getByRole('alert')).toContainText('跨风格或未标注')
    await expect(panel.getByRole('button', { name: '预览用途布置', exact: true })).toBeDisabled()
    await panel.getByLabel('明确允许本房间跨风格选材', { exact: true }).check()
    await panel.getByRole('button', { name: '预览用途布置', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText('没有需要修改', { timeout: 90000 })
  }
  const prop = Object.values(adopted.document.props)[0]
  await selectKeyboardProp(page, prop.id)
  const rotation = (prop.rotationDeg + 180) % 360, input = page.getByLabel('物件旋转', { exact: true })
  await input.fill(String(rotation)); await input.press('Tab'); await keyboardWorkspaceSaved(page)
  await expect(input).toHaveValue(String(rotation))
  const edited = await keyboardProjectBackup(page, info.outputPath(`${brief.id}-continued.sceneweave`))
  expect(edited.document.props[prop.id].rotationDeg).toBe(rotation)
  await page.screenshot({ path: info.outputPath(`${brief.id}-editor.png`) })
  await writeFile(info.outputPath(`${brief.id}-observations.json`), JSON.stringify({ images, coldImages, resultText, missingEquipment: brief.missing, roomCount: brief.rooms.length, propCount: Object.keys(adopted.document.props).length, errors }, null, 2))
  expect(errors).toEqual([])
})
