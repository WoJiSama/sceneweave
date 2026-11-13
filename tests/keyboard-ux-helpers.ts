import { expect, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { EditableProject } from '../src/application/workspace/project'
import { projectBackupButton } from './workspace-ux-helpers'
import { openWorkspaceModule, openSceneObjects } from './workspace-navigation-helpers'

export async function keyboardWorkspaceSaved(page: Page): Promise<void> {
  await expect.poll(async () => ({
    save: (await page.locator('.asset-save').textContent())?.trim(),
    busy: await page.locator('.asset-busy').count(),
    rendering: await page.locator('.asset-map-wrap').getAttribute('aria-busy'),
  }), { timeout: 30000 }).toEqual({ save: '本地已保存', busy: 0, rendering: 'false' })
}

export async function openKeyboardPanel(page: Page, panel: 'resources' | 'inspector' | 'navigation'): Promise<Locator> {
  if (panel === 'navigation') return openWorkspaceModule(page, '场景')
  const target = page.getByTestId(`workspace-${panel}`)
  const name = { resources: '内容面板', inspector: '当前详情' }[panel]
  if (await target.getAttribute('data-open') !== 'true') {
    const trigger = page.locator('.workspace-layout-actions').getByRole('button', { name, exact: true })
    await trigger.click()
  }
  await expect(target).toHaveAttribute('data-open', 'true')
  return target
}

export async function createKeyboardProject(page: Page, title: string): Promise<void> {
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
}

export async function placeKeyboardLamp(page: Page): Promise<void> {
  await openWorkspaceModule(page, '素材')
  const library = page.getByRole('region', { name: '组件素材库', exact: true })
  await library.getByLabel('搜索组件素材', { exact: true }).fill('铜色桌灯')
  await library.getByRole('button', { name: '放置组件 铜色桌灯', exact: true }).click()
  await openKeyboardPanel(page, 'inspector')
  for (const axis of ['X', 'Y']) {
    await page.getByLabel(`放置 ${axis}`, { exact: true }).fill('4')
    await page.getByLabel(`放置 ${axis}`, { exact: true }).press('Tab')
  }
  await page.getByRole('button', { name: '在此放置', exact: true }).click()
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') === 'true') {
    const details = page.getByTestId('workspace-inspector')
    if (await details.getAttribute('data-open') === 'true') await details.getByRole('button', { name: '关闭当前详情', exact: true }).click()
  }
  await page.getByRole('button', { name: '选择地图对象', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

export async function selectKeyboardProp(page: Page, id: string): Promise<void> {
  const navigation = await openSceneObjects(page, '物件与装饰')
  const allLayers = navigation.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await allLayers.isVisible()) await allLayers.click()
  await navigation.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '物件与装饰', exact: true }).click()
  await navigation.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await navigation.locator(`.asset-entity-list [data-entity-id=${JSON.stringify(id)}]`).click()
}

/** Facts come only from an actual normal-UI complete-project download. */
export async function keyboardProjectBackup(page: Page, path: string) {
  const downloaded = page.waitForEvent('download')
  await (await projectBackupButton(page)).click()
  await (await downloaded).saveAs(path)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await page.locator('.workspace-export-menu > summary').click()
  const files = unzipSync(new Uint8Array(await readFile(path)))
  const json = (name: string) => JSON.parse(new TextDecoder().decode(files[name]))
  return {
    document: json('scene.json') as EditableProject['document'],
    identity: json('identity.json') as EditableProject['historyIdentity'],
    appearance: json('appearance.json') as EditableProject['appearance'],
    hashes: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])),
  }
}

export function keyboardResourceHashes(hashes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(hashes).filter(([path]) => /^(assets\/|sources\/|licenses\/|sources\.json$)/.test(path)))
}

/** Click a world point using only the rendered canvas and a downloaded project's bounds. */
export async function clickKeyboardWorldPoint(page: Page, point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
  const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Expected a real native canvas for world-point input.')
  await page.mouse.click(box.x + (point.x - bounds.x) / bounds.width * box.width, box.y + (point.y - bounds.y) / bounds.height * box.height)
}
