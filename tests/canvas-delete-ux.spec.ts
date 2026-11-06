import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { SceneDocument } from '../src/shared/model/scene'
import { projectBackupButton } from './workspace-ux-helpers'

async function saved(page: Page) {
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

test('production canvas Delete and Backspace preview once with focus, draft, IME and lock guards', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('画布删除体验自检')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await saved(page)
  const resources = page.getByTestId('workspace-resources')
  await resources.getByRole('tab', { name: '素材库', exact: true }).click()
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await library.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  for (const axis of ['X', 'Y']) {
    await page.getByLabel(`放置 ${axis}`, { exact: true }).fill('4')
    await page.getByLabel(`放置 ${axis}`, { exact: true }).press('Tab')
  }
  await page.getByRole('button', { name: '在此放置', exact: true }).click()
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  await saved(page)
  const original = await backup(page, info.outputPath('delete-original.sceneweave'))
  const [source] = Object.values(original.document.props)
  const navigation = page.getByTestId('workspace-navigation')
  await navigation.getByRole('tab', { name: '对象', exact: true }).click()
  await navigation.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件', exact: true }).click()
  const search = navigation.getByLabel('搜索场景物件', { exact: true })
  const select = async () => {
    await search.fill(source.id)
    await navigation.locator('.asset-entity-list [data-entity-id]').click()
  }
  await select()
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const revision = page.locator('.workspace-unified')
  const unchanged = async (value = original.document.revision) => {
    await expect(review).toHaveCount(0)
    await expect(revision).toHaveAttribute('data-revision', String(value))
  }

  // Search text retains native editing, and synthetic composition/repeat never deletes.
  await search.fill('abc')
  await search.press('ControlOrMeta+A')
  await search.press('Backspace')
  await expect(search).toHaveValue('')
  await unchanged()
  await select()
  await viewport.focus()
  for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
    await viewport.dispatchEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, ...guard })
    await unchanged()
  }
  await viewport.press('Control+Backspace')
  await unchanged()

  await page.locator('.workspace-help > summary').click()
  await expect(page.getByRole('region', { name: '制作流程与快捷键' })).toContainText('Backspace')
  await viewport.focus()
  await viewport.press('Delete')
  await unchanged()
  await page.getByRole('button', { name: '关闭操作帮助', exact: true }).click()
  await page.locator('.workspace-export-menu > summary').click()
  await viewport.focus()
  await viewport.press('Backspace')
  await unchanged()
  await page.locator('.workspace-export-menu > summary').click()
  await viewport.focus()
  await viewport.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  await viewport.focus()
  await viewport.press('Delete')
  await unchanged()
  await page.getByRole('menu').getByRole('menuitem').first().press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  await resources.getByRole('tab', { name: '工程', exact: true }).click()
  await resources.getByRole('button', { name: '新建空白场景', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('场景名称', { exact: true }).press('Backspace')
  await unchanged()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await resources.getByLabel('工程名称', { exact: true }).fill('保留中的名称草稿')
  await viewport.focus()
  await viewport.press('Delete')
  await unchanged()
  await expect(resources.getByLabel('工程名称', { exact: true })).toHaveValue('保留中的名称草稿')
  await resources.getByRole('button', { name: '取消改名', exact: true }).click()

  await page.getByRole('button', { name: '平移地图', exact: true }).click()
  await viewport.focus()
  await viewport.press('Delete')
  await unchanged()
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  await resources.getByRole('tab', { name: '素材库', exact: true }).click()
  await library.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  await viewport.focus()
  await viewport.press('Delete')
  await unchanged()
  await viewport.press('Escape')
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  expect((await backup(page, info.outputPath('delete-guarded.sceneweave'))).hashes).toEqual(original.hashes)

  await select()
  await page.getByRole('button', { name: '锁定物件编辑', exact: true }).click()
  await saved(page)
  await viewport.focus()
  await viewport.press('Delete')
  await expect(page.locator('.asset-notice')).toContainText('选择含锁定对象')
  await unchanged(original.document.revision + 1)
  await page.getByRole('button', { name: '解除物件编辑锁', exact: true }).click()
  await saved(page)
  const before = await backup(page, info.outputPath('delete-before.sceneweave'))
  await viewport.focus()
  await viewport.press('Delete')
  await expect(review).toContainText('删除所选 · 1 个选择单元')
  await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
  await expect(review.getByRole('button', { name: '采用批量修改', exact: true })).toHaveCount(1)
  await viewport.press('Backspace')
  await expect(review.getByRole('button', { name: '采用批量修改', exact: true })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await unchanged(before.document.revision)
  expect((await backup(page, info.outputPath('delete-cancelled.sceneweave'))).hashes).toEqual(before.hashes)

  await viewport.focus()
  await viewport.press('Backspace')
  await expect(review).toContainText('删除所选 · 1 个选择单元')
  await saved(page)
  await page.screenshot({ path: info.outputPath('delete-preview.png') })
  await review.getByRole('button', { name: '采用批量修改', exact: true }).click()
  await saved(page)
  const adopted = await backup(page, info.outputPath('delete-adopted.sceneweave'))
  expect(adopted.document.revision).toBe(before.document.revision + 1)
  expect(Object.keys(adopted.document.props)).toHaveLength(0)
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await saved(page)
  const undone = await backup(page, info.outputPath('delete-undone.sceneweave'))
  expect(undone.document).toEqual({ ...before.document, revision: before.document.revision + 2, updatedAt: undone.document.updatedAt })
  await page.getByRole('group', { name: '预览受众', exact: true }).getByRole('button', { name: '玩家', exact: true }).click()
  await saved(page)
  await viewport.focus()
  await viewport.press('Delete')
  await viewport.press('Backspace')
  await unchanged(undone.document.revision)
  expect(errors).toEqual([])
})
