import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { SceneDocument } from '../src/shared/model/scene'
import { projectBackupButton } from './workspace-ux-helpers'

async function settled(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 })
}

async function backup(page: Page, path: string) {
  const downloaded = page.waitForEvent('download')
  await (await projectBackupButton(page)).click()
  await (await downloaded).saveAs(path)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await page.locator('.workspace-export-menu > summary').click()
  const files = unzipSync(new Uint8Array(await readFile(path)))
  return {
    document: JSON.parse(new TextDecoder().decode(files['scene.json'])) as SceneDocument,
    hashes: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')])),
  }
}

for (const unit of ['m', 'ft'] as const) test(`production fill-copy in ${unit} preserves cancellation and two copies adopt and undo once`, async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('填充复制体验自检')
  if (unit === 'ft') await dialog.getByLabel('使用预设', { exact: true }).selectOption('tactical')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await settled(page)

  await page.getByTestId('workspace-resources').getByRole('tab', { name: '素材库', exact: true }).click()
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await library.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  await page.getByLabel('放置 X', { exact: true }).fill(unit === 'm' ? '4' : '13.123')
  await page.getByLabel('放置 X', { exact: true }).press('Tab')
  await page.getByLabel('放置 Y', { exact: true }).fill(unit === 'm' ? '4' : '13.123')
  await page.getByLabel('放置 Y', { exact: true }).press('Tab')
  await page.getByRole('button', { name: '在此放置', exact: true }).click()
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  await settled(page)

  const original = await backup(page, info.outputPath('fill-before.sceneweave'))
  expect(original.document.units.display).toBe(unit)
  const offset = unit === 'm' ? { x: 1000, y: 250 } : { x: 1524, y: 381 }
  const [source] = Object.values(original.document.props)
  expect(Object.keys(original.document.props)).toHaveLength(1)
  expect(source.positionMm).toEqual({ x: 4000, y: 4000 })
  const navigation = page.getByTestId('workspace-navigation')
  await navigation.getByRole('tab', { name: '对象', exact: true }).click()
  await navigation.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  await navigation.getByLabel('搜索场景物件', { exact: true }).fill(source.id)
  await navigation.locator('.asset-entity-list [data-entity-id]').click()
  await page.getByLabel('填充副本数量', { exact: true }).fill('2')
  const numeric = page.locator('[data-fill-copy-settings] details')
  await numeric.locator('summary').click()
  await expect(numeric.locator('.asset-number small')).toHaveText([unit, unit])
  await numeric.getByLabel('填充间距 X', { exact: true }).fill(unit === 'm' ? '1' : '5')
  await numeric.getByLabel('填充间距 X', { exact: true }).press('Tab')
  await numeric.getByLabel('填充间距 Y', { exact: true }).fill(unit === 'm' ? '0.25' : '1.25')
  await numeric.getByLabel('填充间距 Y', { exact: true }).press('Tab')

  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const adopt = review.getByRole('button', { name: '采用填充复制', exact: true })
  const undo = page.getByRole('button', { name: '撤销编辑', exact: true })
  const redo = page.getByRole('button', { name: '重做编辑', exact: true })
  const revision = page.locator('.workspace-unified')
  const preview = async () => {
    await numeric.getByRole('button', { name: '预览数值填充', exact: true }).click()
    await expect(review.getByLabel('填充复制参数', { exact: true })).toContainText('新增 2 份')
    await expect(review).toContainText(unit === 'm' ? '每份偏移 1.000 m, 0.250 m' : '每份偏移 5.000 ft, 1.250 ft')
    const distance = (mm: number) => `${(mm / (unit === 'm' ? 1000 : 304.8)).toFixed(3)} ${unit}`
    await expect(review).toContainText(`首件 (${distance(4000 + offset.x)}, ${distance(4000 + offset.y)})`)
    await expect(review).toContainText(`末件 (${distance(4000 + 2 * offset.x)}, ${distance(4000 + 2 * offset.y)})`)
    await expect(adopt).toHaveCount(1)
    await expect(adopt).toBeEnabled()
    await expect(adopt).toBeInViewport({ ratio: 1 })
    await expect(revision).toHaveAttribute('data-revision', String(original.document.revision))
    await settled(page)
  }

  await preview()
  await page.screenshot({ path: info.outputPath('fill-preview.png') })
  await review.getByRole('button', { name: '取消填充复制预览', exact: true }).click()
  await expect(review).toHaveCount(0)
  await expect(page.locator('.asset-notice')).toContainText('已取消「填充复制 · 2 件」预览，工程未修改。')
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()
  expect((await backup(page, info.outputPath('fill-cancelled.sceneweave'))).hashes).toEqual(original.hashes)

  await preview()
  await page.keyboard.press('Escape')
  await expect(review).toHaveCount(0)
  await expect(page.locator('.asset-notice')).toContainText('已取消「填充复制 · 2 件」预览，工程未修改。')
  expect((await backup(page, info.outputPath('fill-escape.sceneweave'))).hashes).toEqual(original.hashes)

  await preview()
  await adopt.click()
  await expect(review).toHaveCount(0)
  await settled(page)
  await expect(page.locator('.asset-notice')).toContainText('作为一次编辑；可用顶部“撤销”整笔撤回。')
  await page.screenshot({ path: info.outputPath('fill-adopted.png') })
  const adopted = await backup(page, info.outputPath('fill-adopted.sceneweave'))
  expect(adopted.document.revision).toBe(original.document.revision + 1)
  expect(adopted.document.props[source.id]).toEqual(source)
  const copies = Object.values(adopted.document.props).filter(prop => prop.id !== source.id).sort((a, b) => a.positionMm.x - b.positionMm.x)
  expect(copies).toHaveLength(2)
  for (const [index, copy] of copies.entries()) {
    expect(copy).toEqual({ ...source, id: copy.id, renderOrder: copy.renderOrder,
      positionMm: { x: source.positionMm.x + (index + 1) * offset.x, y: source.positionMm.y + (index + 1) * offset.y } })
    expect(adopted.document.entityLayers[copy.id]).toBe(original.document.entityLayers[source.id])
  }

  await undo.click()
  await settled(page)
  await expect(redo).toBeEnabled()
  const undone = await backup(page, info.outputPath('fill-undone.sceneweave'))
  expect(undone.document).toEqual({ ...original.document, revision: original.document.revision + 2, updatedAt: undone.document.updatedAt })
  const resources = (hashes: Record<string, string>) => Object.fromEntries(Object.entries(hashes).filter(([path]) => /^(assets\/|sources\/|licenses\/|sources\.json$)/.test(path)))
  expect(resources(adopted.hashes)).toEqual(resources(original.hashes))
  expect(resources(undone.hashes)).toEqual(resources(original.hashes))
  expect(errors).toEqual([])
  await info.attach('fill-copy-facts.json', { body: JSON.stringify({ revisions: [original.document.revision, adopted.document.revision, undone.document.revision], source, copies, errors }), contentType: 'application/json' })
})
