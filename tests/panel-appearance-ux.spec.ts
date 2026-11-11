import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { closeWorkspaceDrawers, openVisualTask, openWorkspaceModule, openSceneSettings } from './workspace-navigation-helpers'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, placeKeyboardLamp } from './keyboard-ux-helpers'

async function closeDrawers(page: Page) {
  await closeWorkspaceDrawers(page)
}
async function shot(page: Page, info: TestInfo, name: string) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(dimensions.root).toBeLessThanOrEqual(dimensions.viewport)
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport)
  await page.screenshot({ path: info.outputPath(`${name}.png`) })
}

for (const width of [1512, 390]) test(`normal production panel appearance, drafts and layout at ${width}px`, async ({ page, browser }, info) => {
  test.setTimeout(240000)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, `面板视觉统一 ${width}`)
  await placeKeyboardLamp(page)
  await closeDrawers(page)
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const sceneSettings = await openSceneSettings(page)
  const title = sceneSettings.getByLabel('工程名称', { exact: true })
  await expect(title).toHaveValue(before.document.title)
  const projectControl = await title.evaluate(node => {
    const css = getComputedStyle(node)
    return { font: css.fontFamily, fontSize: css.fontSize, radius: css.borderRadius, height: node.getBoundingClientRect().height }
  })
  // docs/reference/editor-and-architecture.md#workspace-information-density (2026-11-09):
  // desktop controls 32px, narrow/coarse controls 38px.
  expect(projectControl.height).toBeGreaterThanOrEqual(width === 390 ? 38 : 32)
  await shot(page, info, 'project')
  for (const tab of ['生成', '建筑', '素材与布景', '地形', 'AI'] as const) {
    await openWorkspaceModule(page, tab)
    await shot(page, info, `module-${tab}`)
  }
  const visualTools = await openWorkspaceModule(page, '氛围')
  await expect(visualTools.getByRole('heading', { name: '外观与氛围', exact: true })).toBeVisible()
  const panel = await openVisualTask(page)
  const transition = panel.getByRole('region', { name: '地形过渡', exact: true })
  await panel.getByText('地形材质过渡', { exact: true }).click()
  await expect(transition.getByLabel('地形过渡距离采样', { exact: true })).toBeHidden()
  await transition.getByText('精细设置', { exact: true }).click()
  const spacing = transition.getByLabel('地形过渡距离采样', { exact: true })
  await spacing.fill('450')
  await openVisualTask(page, '灯光')
  await expect(transition).toBeHidden()
  const intensity = panel.getByLabel('视觉灯光强度', { exact: true })
  await intensity.fill('0.35')
  const visualControl = await intensity.evaluate(node => {
    const css = getComputedStyle(node)
    return { font: css.fontFamily, fontSize: css.fontSize, radius: css.borderRadius, height: node.getBoundingClientRect().height }
  })
  expect(visualControl).toEqual(projectControl)
  for (const tab of ['边界', '铺装', '环境', '灯光', '雾', '滤镜'] as const) {
    await openVisualTask(page, tab)
    await shot(page, info, `appearance-${tab}`)
  }
  await openVisualTask(page, '边界')
  await expect(spacing).toHaveValue('450')
  await openVisualTask(page, '灯光')
  await expect(intensity).toHaveValue('0.35')
  await panel.getByRole('button', { name: '预览灯光', exact: true }).click()
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  await expect(review).toBeVisible()
  const settings = page.locator('.workspace-layout-settings'), summary = settings.locator('summary')
  await expect(settings.getByRole('button', { name: '重置布局', exact: true })).toBeHidden()
  await summary.click()
  await expect(settings.getByRole('button', { name: '重置布局', exact: true })).toBeVisible()
  await summary.focus(); await summary.press('Escape')
  await expect(settings).not.toHaveAttribute('open')
  await expect(summary).toBeFocused()
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: '取消视觉预览', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await summary.click()
  await settings.getByRole('button', { name: '展开全部面板', exact: true }).click()
  await expect(settings).not.toHaveAttribute('open')
  await expect(summary).toBeFocused()
  for (const id of ['resources', 'inspector']) {
    await expect(page.getByTestId(`workspace-${id}`)).toHaveAttribute('data-open', String(width === 1512))
  }
  await page.getByRole('button', { name: '内容面板', exact: true }).click()
  await expect(page.getByTestId('workspace-resources')).toHaveAttribute('data-open', String(width === 390))
  await summary.click()
  await settings.getByRole('button', { name: '重置布局', exact: true }).click()
  await expect(settings).not.toHaveAttribute('open')
  await expect(summary).toBeFocused()
  for (const id of ['resources', 'inspector']) {
    await expect(page.getByTestId(`workspace-${id}`)).toHaveAttribute('data-open', String(width === 1512))
  }
  const after = await keyboardProjectBackup(page, info.outputPath('after.sceneweave'))
  expect(after.hashes).toEqual(before.hashes)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${before.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.hashes).toEqual(before.hashes)
  await closeDrawers(page)
  await shot(page, info, 'canvas')
  expect(errors).toEqual([])
  await writeFile(info.outputPath('panel-facts.json'), JSON.stringify({ width, browser: browser.version(), projectControl, visualControl, errors, resourceAndDocumentHashesUnchanged: true, nativeTests: 'not run by user decision' }, null, 2))
})
