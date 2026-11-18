import { expect, test, type Locator, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardWorkspaceSaved, placeKeyboardLamp } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openSceneObjects, openWorkspaceModule } from './workspace-navigation-helpers'

const sizes = [{ width: 1512, height: 982 }, { width: 900, height: 800 }, { width: 390, height: 844 }]

async function tabTo(page: Page, control: Locator) {
  for (let step = 0; step < 32; step++) {
    if (await control.evaluate(element => document.activeElement === element)) return
    await page.keyboard.press('Tab')
  }
  await expect(control).toBeFocused()
}

async function expectControlsInViewport(container: Locator) {
  for (const control of await container.locator('button:visible, summary:visible, select:visible').all()) {
    const label = await control.getAttribute('aria-label') ?? await control.textContent()
    await expect(control, `Control clipped: ${label}`).toBeInViewport({ ratio: 0.99 })
  }
}

for (const size of sizes) {
  test(`delivery controls fit and are keyboard reachable at ${size.width}px`, async ({ page }, info) => {
    await page.setViewportSize(size)
    await createKeyboardProject(page, '溪谷驿站与山间营地的场景地图')
    await closeWorkspaceDrawers(page)
    const header = page.locator('.asset-header')
    const file = header.locator('.workspace-file-menu > summary')
    const help = header.locator('.workspace-help > summary')
    const exportMenu = header.locator('.workspace-export-menu > summary')
    const canvasToolbar = page.getByRole('toolbar', { name: '画布工具', exact: true })
    const viewport = page.getByRole('group', { name: '地图视口', exact: true })
    const select = canvasToolbar.getByRole('button', { name: '选择地图对象', exact: true })
    const pan = canvasToolbar.getByRole('button', { name: '平移地图', exact: true })
    await expect(select).toHaveAttribute('aria-pressed', 'true')
    await expect(select).toBeInViewport({ ratio: 1 })
    await expect(pan).toBeInViewport({ ratio: 1 })
    await expect(viewport).toBeInViewport({ ratio: 1 })
    if (size.width === 390) expect((await viewport.boundingBox())!.height).toBeGreaterThan(size.height * 0.6)
    const navigation = page.getByTestId('workspace-module-navigation')
    for (const region of [header, navigation, canvasToolbar, page.locator('.asset-view-bar'), page.locator('.workspace-footer')]) {
      await expectControlsInViewport(region)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
    await page.screenshot({ path: info.outputPath(`editor-${size.width}.png`), animations: 'disabled' })

    await pan.press('Space')
    await expect(pan).toHaveAttribute('aria-pressed', 'true')
    await select.press('Space')
    await expect(select).toHaveAttribute('aria-pressed', 'true')
    if (size.width === 390) {
      const options = canvasToolbar.getByRole('button', { name: '地图选项', exact: true })
      const mapTools = page.getByRole('group', { name: '地图视口工具', exact: true })
      await expect(mapTools).toBeHidden()
      await options.press('Space')
      await expect(options).toHaveAttribute('aria-expanded', 'true')
      await expect(mapTools.getByRole('button', { name: '全选可编辑对象', exact: true })).toBeFocused()
      await expectControlsInViewport(mapTools)
      await page.screenshot({ path: info.outputPath('map-options-390.png'), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(mapTools).toBeHidden()
      await expect(options).toBeFocused()
    }

    await header.getByRole('button', { name: '回到首页', exact: true }).focus()
    await tabTo(page, file)
    await page.keyboard.press('Enter')
    const fileActions = header.getByRole('group', { name: '文件操作', exact: true })
    await expect(fileActions).toContainText('浏览器')
    const openProject = fileActions.getByRole('button', { name: '打开工程文件', exact: true })
    await tabTo(page, openProject)
    await expect(openProject).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')
    await expect(fileActions).toBeHidden()
    await expect(file).toBeFocused()

    await tabTo(page, help)
    await page.keyboard.press('Space')
    const helpContent = page.getByRole('region', { name: '制作流程与快捷键', exact: true })
    for (const term of ['浏览器', '.sceneweave', '玩家', '主持人']) await expect(helpContent).toContainText(term)
    await page.keyboard.press('Tab')
    await expect(helpContent).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(helpContent).toBeHidden()
    await expect(help).toBeFocused()

    await tabTo(page, exportMenu)
    await page.keyboard.press('Space')
    const exports = header.getByRole('group', { name: '导出选项', exact: true })
    const player = exports.getByRole('button', { name: '玩家地图 PNG', exact: true })
    const gm = exports.getByRole('button', { name: '主持人地图 PNG · 含秘密', exact: true })
    const backup = exports.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true })
    for (const action of [player, gm, backup]) {
      await tabTo(page, action)
      await expect(action).toBeInViewport({ ratio: 1 })
    }
    await expect(player).toHaveAccessibleDescription(/过滤秘密.*分享/)
    await expect(gm).toHaveAccessibleDescription(/仅供主持人/)
    await expect(backup).toHaveAccessibleDescription(/完整工程.*实际资源/)
    await expect(exports).toContainText('.sceneweave')
    await expect(page.getByRole('status', { name: '工程备份状态', exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`export-${size.width}.png`), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(exports).toBeHidden()
    await expect(exportMenu).toBeFocused()

    if (size.width === 390) {
      const audience = page.getByRole('group', { name: '预览受众', exact: true })
      await audience.getByRole('button', { name: '玩家', exact: true }).press('Enter')
      await keyboardWorkspaceSaved(page)
      await exportMenu.press('Enter')
      await expect(player).toBeVisible()
      await expect(gm).toHaveCount(0)
      await expect(backup).toBeVisible()
      await expect(exports.getByRole('button', { name: 'VTT 导出', exact: true })).toBeDisabled()
    }
  })
}

test('live breakpoint changes preserve the canvas, selection, and unfinished tool form', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize(sizes[0])
  await createKeyboardProject(page, '草稿和选区随工作区保留')
  await placeKeyboardLamp(page)
  const shell = page.getByTestId('outdoor-workbench')
  const afterPlacement = Number(await shell.getAttribute('data-revision'))
  const home = page.getByRole('button', { name: '回到首页', exact: true })
  for (const [index, action] of ['撤销编辑', '重做编辑'].entries()) {
    const button = page.getByRole('button', { name: action, exact: true })
    await home.focus()
    await tabTo(page, button)
    await page.keyboard.press('Enter')
    await keyboardWorkspaceSaved(page)
    await expect(shell).toHaveAttribute('data-revision', String(afterPlacement + index + 1))
  }

  const scene = await openSceneObjects(page, '物件与装饰')
  const lamp = scene.locator('.asset-entity-list [data-entity-id]')
  await expect(lamp).toHaveCount(1)
  await lamp.click()
  await expect(lamp).toHaveAttribute('aria-pressed', 'true')
  const canvas = await page.getByRole('group', { name: '地图视口', exact: true }).elementHandle()
  const selected = page.locator('.workspace-footer').getByText('已选 1 项', { exact: true })
  const building = await openWorkspaceModule(page, '建筑')
  await building.getByRole('group', { name: '建筑任务', exact: true }).getByRole('button', { name: /^绘制房间/ }).click()
  const inspector = page.getByTestId('workspace-inspector')
  const roomName = inspector.getByLabel('房间名称', { exact: true })
  await roomName.fill('只填写的未采用房间')
  const revision = await shell.getAttribute('data-revision')
  const draft = page.getByRole('button', { name: '返回当前工具与草稿', exact: true })

  for (const size of [sizes[1], sizes[2], sizes[0]]) {
    await page.setViewportSize(size)
    await expect(page.getByTestId('workspace-layout')).toHaveAttribute('data-narrow', String(size.width < 1080))
    await openWorkspaceModule(page, '素材')
    await draft.press('Enter')
    await expect(roomName).toBeVisible()
    await expect(roomName).toHaveValue('只填写的未采用房间')
    await expect(selected).toBeInViewport({ ratio: 1 })
    await expect(shell).toHaveAttribute('data-revision', revision!)
    expect(await canvas!.evaluate(element => element === document.querySelector('.asset-viewport'))).toBe(true)
  }

  await page.setViewportSize(sizes[2])
  await expect(page.getByTestId('workspace-layout')).toHaveAttribute('data-narrow', 'true')
  await draft.press('Enter')
  const close = inspector.getByRole('button', { name: '关闭当前详情', exact: true })
  await expect(close).toBeFocused()
  await expectControlsInViewport(page.locator('.workspace-session-feedback'))
  const help = page.locator('.workspace-help > summary')
  await help.press('Enter')
  const helpContent = page.getByRole('region', { name: '制作流程与快捷键', exact: true })
  await page.keyboard.press('Tab')
  await expect(helpContent).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(helpContent).toBeHidden()
  await expect(help).toBeFocused()
  await expect(inspector).toHaveAttribute('data-open', 'true')
  await close.press('Escape')
  await expect(inspector).toHaveAttribute('data-open', 'false')
  await expect(draft).toBeFocused()
  await draft.press('Enter')
  await expect(roomName).toHaveValue('只填写的未采用房间')
  await expect(selected).toBeInViewport({ ratio: 1 })
  await expect(shell).toHaveAttribute('data-revision', revision!)
})
