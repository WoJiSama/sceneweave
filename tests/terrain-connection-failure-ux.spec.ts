import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { openDetailsBySummary } from './workspace-ux-helpers'

const highPoints = '7300,1000\n12500,1000\n12500,9000\n7300,9000'
const crossingPoints = '4000,5000\n9000,5000'
const clearPoints = '4000,8000\n9000,8000'
const toolsFor = (page: Page) => page.getByTestId('workspace-inspector').locator('.outdoor-panel.workspace-tool-parameters')
const reviewFor = (page: Page) => page.getByRole('region', { name: '候选审阅', exact: true }).and(page.locator('.workspace-candidate-review'))

async function closeDrawers(page: Page): Promise<void> {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, name] of [['resources', '内容面板'], ['inspector', '当前详情']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') === 'true') {
      await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
      await expect(panel).toHaveAttribute('data-open', 'false')
    }
  }
}

async function openTools(page: Page, task: '地形与高程' | '用途 / 危险区域' | '台阶 / 坡道') {
  const resources = await openWorkspaceModule(page, '地形')
  await resources.getByRole('group', { name: '室外任务', exact: true }).getByRole('button', { name: new RegExp(`^${task}`) }).click()
  await expect(page.getByTestId('workspace-inspector')).toHaveAttribute('data-open', 'true')
  return toolsFor(page)
}

async function adopt(page: Page): Promise<void> {
  const review = reviewFor(page)
  await expect(review).toBeVisible()
  await closeDrawers(page)
  await openKeyboardPanel(page, 'inspector')
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  await expect(review).toHaveCount(0)
}

async function area(page: Page, coordinates: string, elevation: string, priority: string): Promise<void> {
  const tools = await openTools(page, '地形与高程')
  await openDetailsBySummary(tools, /^精确坐标 · 区域轮廓$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill(coordinates)
  await tools.getByLabel('地形高程', { exact: true }).fill(elevation)
  await tools.getByLabel('地形高程', { exact: true }).press('Tab')
  await openDetailsBySummary(tools, /^重叠地形的显示顺序$/)
  await tools.getByLabel('地形覆盖优先级', { exact: true }).fill(priority)
  await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
  await adopt(page)
  await keyboardWorkspaceSaved(page)
}

async function configureConnection(page: Page, floorId: string, highId: string, points = crossingPoints): Promise<void> {
  const tools = await openTools(page, '台阶 / 坡道')
  await openDetailsBySummary(tools, /^精确坐标 · 连接路线节点$/)
  await tools.getByLabel('室外坐标', { exact: true }).fill(points)
  await tools.getByLabel('连接起点表面', { exact: true }).selectOption(`floor:${floorId}`)
  await tools.getByLabel('连接终点表面', { exact: true }).selectOption(`terrainArea:${highId}`)
  await tools.getByLabel('室外通路净宽', { exact: true }).fill('0.9')
  await tools.getByLabel('室外通路净宽', { exact: true }).press('Tab')
}

async function cancelDraft(page: Page): Promise<void> {
  await closeDrawers(page)
  const cancel = page.getByRole('button', { name: '取消室外草稿', exact: true })
  if (await cancel.isVisible()) await cancel.click()
}

async function selectOutdoor(page: Page, id: string): Promise<void> {
  const nav = await openWorkspaceModule(page, '场景')
  const allLayers = nav.getByRole('button', { name: '显示所有图层的对象', exact: true })
  if (await allLayers.isVisible()) await allLayers.click()
  await nav.getByRole('group', { name: '场景对象分类', exact: true }).getByRole('button', { name: '结构', exact: true }).click()
  await nav.getByLabel('搜索场景对象', { exact: true }).fill(id)
  await nav.locator('[data-entity-id]').click()
  await closeDrawers(page)
  await openKeyboardPanel(page, 'inspector')
}

async function openSavedHome(page: Page, id: string): Promise<void> {
  await page.goto('./#home')
  const row = page.getByTestId('workspace-home').locator(`[data-project-key="native:${id}"]`)
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
}

async function record(info: TestInfo, facts: unknown): Promise<void> {
  const path = info.outputPath('connection-failure-facts.json')
  await writeFile(path, JSON.stringify(facts, null, 2))
  await info.attach('connection-failure-facts.json', { path, contentType: 'application/json' })
}

for (const size of [{ width: 1512, height: 982 }, { width: 390, height: 844 }]) {
  test(`production connection failures retain input and project at ${size.width}px`, async ({ page, browser }, info) => {
    test.setTimeout(180000)
    await page.setViewportSize(size)
    const errors: string[] = [], messages: unknown[] = []
    page.on('pageerror', error => errors.push(error.message))
    await createKeyboardProject(page, `连接失败保护 ${size.width}`)
    await area(page, highPoints, '1.2', '1')
    let baseline = await keyboardProjectBackup(page, info.outputPath('high-before.sceneweave'))
    const [high] = Object.values(baseline.document.terrainAreas)
    const floorId = high.floorId
    const fail = async (name: string, message: RegExp, inline = false) => {
      const tools = toolsFor(page)
      const input = await tools.getByLabel('室外坐标', { exact: true }).inputValue()
      await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
      const alert = inline ? tools.getByRole('alert') : page.locator('.asset-notice').filter({ hasText: '室外候选未通过' })
      await expect(alert).toContainText(message)
      await expect(reviewFor(page)).toHaveCount(0)
      await keyboardWorkspaceSaved(page)
      await expect(tools.getByLabel('室外坐标', { exact: true })).toHaveValue(input)
      await alert.scrollIntoViewIfNeeded()
      await expect(alert).toBeInViewport()
      const visible = await alert.evaluate(node => {
        const box = node.getBoundingClientRect(), x = (Math.max(0, box.left) + Math.min(innerWidth, box.right)) / 2
        const y = (Math.max(0, box.top) + Math.min(innerHeight, box.bottom)) / 2
        return { text: node.textContent, x, y, unobscured: node.contains(document.elementFromPoint(x, y)) }
      })
      expect(visible.unobscured, JSON.stringify(visible)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${name}.png`) })
      messages.push({ name, ...visible })
      expect((await keyboardProjectBackup(page, info.outputPath(`${name}.sceneweave`))).hashes).toEqual(baseline.hashes)
      await openKeyboardPanel(page, 'inspector')
      await expect(tools.getByLabel('室外坐标', { exact: true })).toHaveValue(input)
    }

    await configureConnection(page, floorId, high.id, '4000,5000\n5000,5000')
    await toolsFor(page).getByLabel('连接终点表面', { exact: true }).selectOption('')
    await fail('missing-support', /明确选择支撑表面/, true)
    await toolsFor(page).getByLabel('连接终点表面', { exact: true }).selectOption(`terrainArea:${high.id}`)
    await fail('wrong-endpoint', /连接两端须落在各自的有效支撑面内/)
    await toolsFor(page).getByLabel('室外坐标', { exact: true }).fill(crossingPoints)
    await toolsFor(page).getByLabel('室外通路净宽', { exact: true }).fill('0')
    await toolsFor(page).getByLabel('室外通路净宽', { exact: true }).press('Tab')
    await fail('zero-width', /通路净宽须大于 0/, true)
    await cancelDraft(page)

    // A real intermediate support makes this route cross two boundaries.
    await area(page, '5500,4000\n6500,4000\n6500,6000\n5500,6000', '0.6', '2')
    baseline = await keyboardProjectBackup(page, info.outputPath('third-support-before.sceneweave'))
    await configureConnection(page, floorId, high.id)
    await fail('third-support', /不得侵入第三支撑面/)
    await cancelDraft(page)

    // This blocker occupies a different route, leaving the upper route clear.
    const tools = await openTools(page, '用途 / 危险区域')
    await openDetailsBySummary(tools, /^精确坐标 · 区域轮廓$/)
    await tools.getByLabel('室外坐标', { exact: true }).fill('5500,6500\n6500,6500\n6500,7500\n5500,7500')
    await tools.getByLabel('区域阻挡移动', { exact: true }).check()
    await tools.getByRole('button', { name: '预览室外修改', exact: true }).click()
    await adopt(page)
    await keyboardWorkspaceSaved(page)
    baseline = await keyboardProjectBackup(page, info.outputPath('obstacle-before.sceneweave'))
    await configureConnection(page, floorId, high.id, '4000,7000\n9000,7000')
    await fail('blocked-route', /连接净宽带被 Region 阻挡/)
    await cancelDraft(page)

    await selectOutdoor(page, high.id)
    const inspector = page.getByRole('region', { name: '室外对象属性', exact: true })
    await inspector.getByRole('button', { name: '锁定对象编辑', exact: true }).click()
    await adopt(page)
    await keyboardWorkspaceSaved(page)
    baseline = await keyboardProjectBackup(page, info.outputPath('locked-before.sceneweave'))
    expect(baseline.document.terrainAreas[high.id].editLocked).toBe(true)
    await configureConnection(page, floorId, high.id, clearPoints)
    await fail('locked-support', /露台石板 · 高程 1.2 m/)
    const lockMessage = messages.at(-1) as { text: string }
    expect(lockMessage.text).toContain('解除编辑锁')
    expect(lockMessage.text).not.toContain(high.id)
    await cancelDraft(page)
    await selectOutdoor(page, high.id)
    await expect(inspector).toContainText('此对象自身有编辑锁')
    await expect(inspector.getByLabel('对象地形高程', { exact: true })).toBeDisabled()
    await inspector.getByRole('button', { name: '解除对象编辑锁', exact: true }).click()
    await adopt(page)
    await keyboardWorkspaceSaved(page)
    baseline = await keyboardProjectBackup(page, info.outputPath('unlocked-before.sceneweave'))
    await configureConnection(page, floorId, high.id, clearPoints)
    await toolsFor(page).getByRole('button', { name: '预览室外修改', exact: true }).click()
    await expect(reviewFor(page)).toContainText('创建高差连接')
    await closeDrawers(page)
    await openKeyboardPanel(page, 'inspector')
    await reviewFor(page).getByRole('button', { name: '取消室外预览', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    expect((await keyboardProjectBackup(page, info.outputPath('recovered-cancelled.sceneweave'))).hashes).toEqual(baseline.hashes)
    const width = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    expect(width.document).toBeLessThanOrEqual(width.viewport)
    expect(errors).toEqual([])
    await record(info, { size, browser: browser.version(), messages, width, errors, recovery: 'unlock, correct route, original candidate and cancellation', excluded: ['all lock combinations', 'curved and room-attached connections', 'same-session stale API proof', 'visual P3'] })
  })
}

test('production connection preview preserves both branches after a real second-tab save', async ({ page, context, browser }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '连接候选跨页保护')
  await area(page, highPoints, '1.2', '1')
  const before = await keyboardProjectBackup(page, info.outputPath('conflict-before.sceneweave'))
  const [high] = Object.values(before.document.terrainAreas)
  await configureConnection(page, high.floorId, high.id)
  await toolsFor(page).getByRole('button', { name: '预览室外修改', exact: true }).click()
  const review = reviewFor(page)
  await expect(review).toContainText('创建高差连接')
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
  const tools = toolsFor(page)
  await expect(tools.getByRole('button', { name: '预览室外修改', exact: true, includeHidden: true })).toBeDisabled()

  const other = await context.newPage()
  other.on('pageerror', error => errors.push(error.message))
  await openSavedHome(other, before.document.sceneId)
  const otherScene = await openWorkspaceModule(other, '场景')
  await otherScene.getByRole('button', { name: '场景设置', exact: true }).click()
  const settings = (await openKeyboardPanel(other, 'inspector')).getByRole('region', { name: '场景设置', exact: true }).and(other.locator('.workspace-project-tools'))
  await settings.getByLabel('工程名称', { exact: true }).and(settings.locator('input:enabled')).fill('另一标签页已保存')
  await settings.getByRole('button', { name: '保存名称', exact: true }).and(settings.locator('button:enabled')).click()
  await keyboardWorkspaceSaved(other)
  const external = await keyboardProjectBackup(other, info.outputPath('external-saved.sceneweave'))
  expect(external.document.revision).toBe(before.document.revision + 1)
  expect(Object.keys(external.document.terrainConnections)).toHaveLength(0)
  await review.getByLabel('确认完整影响范围', { exact: true }).check()
  await review.getByRole('button', { name: '采用室外修改', exact: true }).click()
  const recovery = page.getByRole('alert', { name: '保存恢复选项', exact: true })
  await expect(recovery).toContainText('保存版本发生冲突')
  await expect(recovery).toContainText('当前编辑仍保留在此页面')
  await expect(recovery).toContainText('另一版本不会被覆盖')
  await expect(recovery.getByRole('button', { name: '下载当前工程备份', exact: true })).toBeEnabled()
  await expect(recovery.getByRole('button', { name: '另存副本', exact: true })).toBeEnabled()
  await expect(recovery.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0)
  await expect(page.locator('.asset-save')).toContainText('冲突')
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('two-tab-conflict.png') })
  const backupDownload = page.waitForEvent('download')
  await recovery.getByRole('button', { name: '下载当前工程备份', exact: true }).click()
  const recoveryBackup = info.outputPath('recovery-backup.sceneweave')
  await (await backupDownload).saveAs(recoveryBackup)
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  const retained = await keyboardProjectBackup(page, info.outputPath('local-retained.sceneweave'))
  const recoveryFiles = unzipSync(new Uint8Array(await readFile(recoveryBackup)))
  expect(Object.fromEntries(Object.entries(recoveryFiles).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]))).toEqual(retained.hashes)
  expect(retained.document.title).toBe(before.document.title)
  expect(Object.keys(retained.document.terrainConnections)).toHaveLength(1)
  expect(retained.document.terrainAreas).toEqual(before.document.terrainAreas)
  expect((await keyboardProjectBackup(other, info.outputPath('external-after-conflict.sceneweave'))).hashes).toEqual(external.hashes)
  await recovery.getByRole('button', { name: '另存副本', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const copied = await keyboardProjectBackup(page, info.outputPath('local-copy.sceneweave'))
  expect(copied.document.sceneId).not.toBe(before.document.sceneId)
  expect(copied.document.revision).toBe(0)
  expect(copied.document.terrainConnections).toEqual(retained.document.terrainConnections)
  expect(copied.document.terrainAreas).toEqual(retained.document.terrainAreas)
  await other.reload()
  await other.getByRole('button', { name: '回到首页', exact: true }).click()
  await openSavedHome(other, before.document.sceneId)
  expect((await keyboardProjectBackup(other, info.outputPath('external-cold.sceneweave'))).hashes).toEqual(external.hashes)
  await page.reload()
  await page.getByRole('button', { name: '回到首页', exact: true }).click()
  await openSavedHome(page, copied.document.sceneId)
  expect((await keyboardProjectBackup(page, info.outputPath('copy-cold.sceneweave'))).hashes).toEqual(copied.hashes)
  expect(errors).toEqual([])
  await record(info, { browser: browser.version(), before: { id: before.document.sceneId, revision: before.document.revision }, external: { title: external.document.title, revision: external.document.revision }, retained: { revision: retained.document.revision, connections: Object.keys(retained.document.terrainConnections) }, copy: { id: copied.document.sceneId, revision: copied.document.revision }, errors, boundary: 'same-page edits are guarded; cross-tab CAS preserves separate branches instead of silently rejecting the local preview' })
  await other.close()
})
