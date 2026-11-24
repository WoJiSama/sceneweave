import { expect, test } from '@playwright/test'
import { createKeyboardProject, placeKeyboardLamp } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

test('空白画布的三个入口悬浮时文字清晰', async ({ page }) => {
  await page.goto('./#workspace')
  const actions = page.locator('.workspace-start-actions')

  for (const name of ['新建场景', '生成地图', '从样板开始']) {
    const button = actions.getByRole('button', { name, exact: true })
    await button.hover()
    await expect(button).toHaveCSS('background-color', 'rgb(231, 239, 223)')
    await expect(button).toHaveCSS('color', 'rgb(52, 85, 65)')
  }
})

test('D1 首页生成地图打开现有生成面板', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#home')
  const home = page.getByTestId('workspace-home')
  const generate = home.getByRole('button', { name: '生成地图', exact: true })
  await expect(home.getByRole('region', { name: '当前编辑会话', exact: true })).toHaveCount(0)
  await expect(generate).toBeInViewport({ ratio: 1 })
  await info.attach('首页空会话-390.png', { body: await page.screenshot(), contentType: 'image/png' })

  await generate.click()
  await expect(page).toHaveURL(/#workspace$/)
  const generation = page.getByTestId('workspace-resources').getByRole('region', { name: '生成地图', exact: true })
  await expect(generation.getByRole('group', { name: '生成场景类型', exact: true })).toBeVisible()
})

test('D1 当前编辑会话卡继续同一会话并保留修订、快照名称输入和选区', async ({ page }, info) => {
  test.setTimeout(90_000)
  const title = 'D1 首屏续编夹具'
  await createKeyboardProject(page, title)
  await placeKeyboardLamp(page)

  const workbench = page.getByTestId('outdoor-workbench')
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await expect(viewport).toHaveAttribute('data-selected-ids', /^\["[^"]+"\]$/)
  const selection = await viewport.getAttribute('data-selected-ids')

  const history = (await openWorkspaceModule(page, '历史')).getByRole('region', { name: '命名历史', exact: true })
  await history.getByRole('button', { name: '新建命名快照', exact: true }).click()
  const draft = history.getByRole('textbox', { name: '命名快照名称', exact: true })
  const snapshotName = '尚未提交的快照名称'
  await draft.fill(snapshotName)

  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await expect(page).toHaveURL(/#home$/)
  const current = page.getByTestId('workspace-home').getByRole('region', { name: '当前编辑会话', exact: true })
  await expect(current.getByRole('heading', { name: title, exact: true })).toBeVisible()
  const resume = current.getByRole('button', { name: '继续编辑', exact: true })
  await expect(resume).toBeInViewport({ ratio: 1 })
  await info.attach('首页当前会话-1512.png', { body: await page.screenshot(), contentType: 'image/png' })

  await resume.click()
  await expect(page).toHaveURL(/#workspace$/)
  await expect(workbench).toHaveAttribute('data-revision', '1')
  await expect(viewport).toHaveAttribute('data-selected-ids', selection!)
  await expect(draft).toHaveValue(snapshotName)
})
