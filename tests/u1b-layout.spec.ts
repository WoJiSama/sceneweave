import { expect, test, type Page } from '@playwright/test'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'

// Two small U1b smoke cases only. Creation uses the public Home form; DEV access
// observes the active project and never installs fixtures or calls editor writes.
const preferenceKey = 'sceneweave:workspace-layout:v1'
const defaults = { version: 1, resourcesWidth: 280, detailsWidth: 320, resourcesCollapsed: false, inspectorCollapsed: false, navigationCollapsed: false }
type Dev = { workspace: WorkspaceV6 }
const home = (page: Page) => page.getByTestId('workspace-home')
const layout = (page: Page) => page.getByTestId('workspace-layout')
const resources = (page: Page) => page.getByTestId('workspace-resources')
const navigation = (page: Page) => page.getByTestId('workspace-navigation')

async function settled(page: Page) {
  await expect(page.getByTestId('outdoor-workbench')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.asset-busy')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30_000 })
}

async function createBlank(page: Page, title: string) {
  await home(page).getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await settled(page)
}

async function projectState(page: Page) {
  return page.evaluate(() => {
    const state = (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev).workspace.getState()
    if (!state.project) throw new Error('Expected a native v6 project created through Home')
    return {
      document: structuredClone(state.project.document),
      identity: structuredClone(state.project.historyIdentity),
      appearance: structuredClone(state.project.appearance),
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    }
  })
}

async function preferences(page: Page) {
  return page.evaluate(key => {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw) as typeof defaults
  }, preferenceKey)
}

async function rememberCanvas(page: Page) {
  await page.evaluate(() => Reflect.set(window, '__u1bCanvas', document.querySelector('.asset-map-wrap canvas')))
}

async function expectSameCanvas(page: Page) {
  expect(await page.evaluate(() => {
    const original = Reflect.get(window, '__u1bCanvas') as HTMLCanvasElement | undefined
    return !!original && original.isConnected && original === document.querySelector('.asset-map-wrap canvas')
  })).toBe(true)
}

async function reopenFromHome(page: Page, sceneId: string) {
  await expect(home(page)).toBeVisible()
  await home(page).locator(`[data-project-key="v6:${sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await settled(page)
}

test('U1b desktop panels resize, fold, retain passive drafts and remember layout without editing the project', async ({ page }, info) => {
  test.setTimeout(75_000)
  await page.setViewportSize({ width: 1512, height: 982 })
  await page.goto('/#home')
  await createBlank(page, 'U1b 桌面布局简单测试')
  const before = await projectState(page)
  await rememberCanvas(page)
  await expect(layout(page)).toBeVisible()
  const resourceSeparator = page.getByRole('separator', { name: '调整资源面板宽度', exact: true })
  const detailSeparator = page.getByRole('separator', { name: '调整右侧面板宽度', exact: true })
  const initialWidth = Number(await resourceSeparator.getAttribute('aria-valuenow'))
  await resourceSeparator.focus()
  await resourceSeparator.press('ArrowRight')
  await expect.poll(async () => Number(await resourceSeparator.getAttribute('aria-valuenow'))).toBeGreaterThan(initialWidth)
  const divider = await detailSeparator.boundingBox()
  if (!divider) throw new Error('Expected a visible desktop detail separator')
  const oldDetailsWidth = Number(await detailSeparator.getAttribute('aria-valuenow'))
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
  await page.mouse.down()
  await page.mouse.move(divider.x - 32, divider.y + divider.height / 2)
  await page.mouse.up()
  await expect.poll(async () => Number(await detailSeparator.getAttribute('aria-valuenow'))).toBeGreaterThan(oldDetailsWidth)
  for (const name of ['资源面板', '属性面板', '场景导航']) {
    await page.getByRole('button', { name: `折叠${name}`, exact: true }).click()
    await page.getByRole('button', { name: `展开${name}`, exact: true }).click()
    await expectSameCanvas(page)
  }
  await page.getByRole('button', { name: '重置布局', exact: true }).click()
  await expect.poll(() => preferences(page)).toEqual(defaults)

  // A parameter draft remains local and mounted while browsing both independent sides.
  await page.getByLabel('外观调整项目', { exact: true }).selectOption('brightness')
  await page.getByLabel('外观亮度', { exact: true }).fill('0.55')
  for (const name of ['建筑', '室外', '素材库']) await resources(page).getByRole('tab', { name, exact: true }).click()
  for (const name of ['图层', '对象', '历史']) await navigation(page).getByRole('tab', { name, exact: true }).click()
  await page.getByRole('button', { name: '折叠属性面板', exact: true }).click()
  await page.getByRole('button', { name: '展开属性面板', exact: true }).click()
  await expect(page.getByLabel('外观亮度', { exact: true })).toHaveValue('0.55')
  await expectSameCanvas(page)
  expect(await projectState(page)).toEqual(before)
  await page.getByRole('button', { name: '取消外观草稿', exact: true }).click()

  await resourceSeparator.focus()
  await resourceSeparator.press('ArrowRight')
  await detailSeparator.focus()
  await detailSeparator.press('ArrowLeft')
  await page.getByRole('button', { name: '折叠场景导航', exact: true }).click()
  await expect.poll(async () => (await preferences(page))?.navigationCollapsed).toBe(true)
  const remembered = await preferences(page)
  expect(remembered?.navigationCollapsed).toBe(true)
  expect(remembered?.resourcesWidth).toBeGreaterThan(defaults.resourcesWidth)
  expect(await projectState(page)).toEqual(before)
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(home(page)).toBeVisible()
  await page.reload()
  await reopenFromHome(page, before.document.sceneId)
  expect(await preferences(page)).toEqual(remembered)
  await expect(page.getByRole('button', { name: '展开场景导航', exact: true })).toBeVisible()
  expect(await projectState(page)).toEqual(before)
  await info.attach('u1b-desktop.png', { body: await page.screenshot(), contentType: 'image/png' })
  await info.attach('u1b-desktop-smoke.json', { body: JSON.stringify({ viewport: { width: 1512, height: 982 }, sceneId: before.document.sceneId, revision: before.document.revision, remembered, unchangedDocumentIdentityAppearance: true, sameCanvasBeforeRealReload: true }), contentType: 'application/json' })
})

test.describe('U1b narrow workspace', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
  test('U1b narrow drawers remain reachable, restore focus and reject unusable preferences', async ({ page }, info) => {
    test.setTimeout(75_000)
    await page.addInitScript(key => {
      if (!sessionStorage.getItem('__u1bPreferencesSeeded')) {
        localStorage.setItem(key, JSON.stringify({ version: 999, resourcesWidth: 999999, detailsWidth: -1, resourcesCollapsed: true, inspectorCollapsed: true, navigationCollapsed: true }))
        sessionStorage.setItem('__u1bPreferencesSeeded', 'yes')
      }
    }, preferenceKey)
    await page.goto('/#home')
    await expect(home(page)).toBeVisible()
    expect(await page.evaluate(() => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev | undefined)?.workspace.getState().project ?? null)).toBeNull()
    await createBlank(page, 'U1b 窄屏抽屉简单测试')
    await expect(page.locator('.asset-save')).toBeVisible()
    await expect(page.locator('.asset-save')).toBeInViewport()
    const before = await projectState(page)
    await expect.poll(() => preferences(page)).toEqual(defaults)
    await rememberCanvas(page)
    for (const name of ['资源面板', '属性面板', '场景导航']) {
      const trigger = page.getByRole('button', { name, exact: true })
      await trigger.tap()
      const drawer = page.getByRole('region', { name, exact: true })
      await expect(drawer).toBeVisible()
      expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true)
      if (name === '资源面板') for (const tab of ['素材库', '建筑', '室外']) await drawer.getByRole('tab', { name: tab, exact: true }).tap()
      if (name === '属性面板') await expect(drawer.getByLabel('外观调整项目', { exact: true })).toBeVisible()
      if (name === '场景导航') for (const tab of ['图层', '对象', '历史']) await drawer.getByRole('tab', { name: tab, exact: true }).tap()
      await page.keyboard.press('Escape')
      await expect(drawer).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await expectSameCanvas(page)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await projectState(page)).toEqual(before)

    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    await expect(home(page)).toBeVisible()
    await page.evaluate(key => localStorage.setItem(key, '{malformed-layout'), preferenceKey)
    await page.reload()
    await expect(home(page)).toBeVisible()
    expect(await page.evaluate(() => (Reflect.get(window, '__sceneweaveOutdoorDev') as Dev | undefined)?.workspace.getState().project ?? null)).toBeNull()
    await reopenFromHome(page, before.document.sceneId)
    await expect.poll(() => preferences(page)).toEqual(defaults)
    await expect(page.getByRole('button', { name: '资源面板', exact: true })).toBeVisible()
    expect(await projectState(page)).toEqual(before)
    await info.attach('u1b-narrow.png', { body: await page.screenshot(), contentType: 'image/png' })
    await info.attach('u1b-narrow-smoke.json', { body: JSON.stringify({ viewport: { width: 390, height: 844 }, touch: true, sceneId: before.document.sceneId, revision: before.document.revision, unknownAndMalformedPreferences: 'usable defaults', drawers: ['resources', 'inspector', 'navigation'], unchangedDocumentIdentityAppearance: true }), contentType: 'application/json' })
  })
})
