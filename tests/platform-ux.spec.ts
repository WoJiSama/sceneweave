import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { closeWorkspaceDrawers, openBuildingTask } from './workspace-navigation-helpers'
import { writeFile } from 'node:fs/promises'
import { clickKeyboardWorldPoint, createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { reloadSaved } from './workspace-ux-helpers'

type FocusFact = { step: string; key?: string; tag?: string; name?: string | null; outline?: string }

async function keyboardFact(page: Page, facts: FocusFact[], key: string, step: string): Promise<void> {
  await page.keyboard.press(key)
  facts.push({ step, key, ...await page.evaluate(() => {
    const node = document.activeElement as HTMLElement | null
    return { tag: node?.tagName, name: node?.getAttribute('aria-label') ?? node?.textContent?.trim().slice(0, 100), outline: node ? getComputedStyle(node).outlineStyle : undefined }
  }) })
}

async function closePlatformDrawers(page: Page): Promise<void> {
  await closeWorkspaceDrawers(page)
}

async function pageDimensions(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, rootWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }))
  expect(dimensions.rootWidth).toBeLessThanOrEqual(dimensions.width)
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.width)
  return dimensions
}

async function savePlatformFacts(info: TestInfo, name: string, facts: unknown): Promise<void> {
  const path = info.outputPath(`${name}.json`)
  await writeFile(path, JSON.stringify(facts, null, 2))
  await info.attach(`${name}.json`, { path, contentType: 'application/json' })
}

async function expandChanges(review: Locator, page: Page, focus: FocusFact[]): Promise<void> {
  const changes = review.locator('details.composition-preview-details')
  await changes.locator(':scope > summary').focus()
  await keyboardFact(page, focus, 'Enter', 'expand real candidate changes')
  await expect(changes).toHaveAttribute('open', '')
  await changes.locator('summary').filter({ hasText: '字段与 ID 详情' }).first().focus()
  await keyboardFact(page, focus, 'Space', 'expand real candidate field details')
  const scroll = await review.locator('.workspace-candidate-body').evaluate(node => ({ content: node.scrollHeight, visible: node.clientHeight }))
  expect(scroll.content).toBeGreaterThan(scroll.visible)
}

test('production browser main journey preserves text input, rectangle review, one undo and cold-read backup', async ({ page, browser, browserName }, info) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 1512, height: 982 })
  const errors: string[] = [], focus: FocusFact[] = []
  // Default macOS WebKit uses Option+Tab to include native buttons in sequential navigation.
  const buttonTab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, `跨浏览器主流程 ${browserName}`)
  const original = await keyboardProjectBackup(page, info.outputPath('platform-before.sceneweave'))
  const revision = page.locator('.workspace-unified')
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })
  const review = page.getByRole('region', { name: '候选审阅', exact: true })

  const navigation = await openKeyboardPanel(page, 'navigation')
  const search = navigation.getByLabel('搜索场景对象', { exact: true })
  await search.fill('文字输入保护')
  await search.press('Enter')
  await expect(search).toHaveValue('文字输入保护')
  await search.press('ControlOrMeta+A')
  await search.press('Delete')
  await expect(search).toHaveValue('')
  await expect(review).toHaveCount(0)
  await expect(revision).toHaveAttribute('data-revision', String(original.document.revision))

  const help = page.locator('.workspace-help > summary')
  await help.focus()
  await keyboardFact(page, focus, 'Enter', 'open operation help')
  const helpContent = page.getByRole('region', { name: '制作流程与快捷键', exact: true })
  await expect(helpContent).toBeVisible()
  await keyboardFact(page, focus, 'Tab', 'enter operation help content')
  await expect(helpContent).toBeFocused()
  const helpSemantics = await helpContent.ariaSnapshot()
  await keyboardFact(page, focus, 'Escape', 'close help and restore trigger focus')
  await expect(help).toBeFocused()
  await expect(page.locator('.workspace-help')).not.toHaveAttribute('open')

  await viewport.focus()
  await keyboardFact(page, focus, 'Shift+F10', 'open canvas context menu')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.locator('[role="menuitem"]:not(:disabled)').first()).toBeFocused()
  const menuSemantics = await menu.ariaSnapshot()
  await keyboardFact(page, focus, 'Escape', 'close context menu and restore canvas focus')
  await expect(menu).toHaveCount(0)
  await expect(viewport).toBeFocused()

  await openBuildingTask(page)
  await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
  const begin = page.getByRole('button', { name: '在图上画房间', exact: true })
  const drawRoom = async () => {
    await openBuildingTask(page)
    await begin.click()
    await closePlatformDrawers(page)
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    await expect(page.getByLabel('地图缩放比例', { exact: true })).toHaveText('100%')
    await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeInViewport({ ratio: 1 })
    for (const point of [{ x: 1000, y: 1000 }, { x: 5000, y: 4000 }]) await clickKeyboardWorldPoint(page, point, original.document.exportBoundsMm)
    await viewport.focus()
    await keyboardFact(page, focus, 'Enter', 'finish two corners into review')
    await expect(review).toContainText('新建新房间')
    await keyboardWorkspaceSaved(page)
    await expect(revision).toHaveAttribute('data-revision', String(original.document.revision))
  }

  await drawRoom()
  const adopt = review.getByRole('button', { name: '采用结构修改', exact: true })
  const cancel = review.getByRole('button', { name: '取消结构预览', exact: true })
  await expect(adopt).toBeDisabled()
  await viewport.focus()
  await keyboardFact(page, focus, 'Enter', 'Enter never adopts existing candidate')
  await expect(adopt).toBeDisabled()
  await expandChanges(review, page, focus)
  await cancel.scrollIntoViewIfNeeded()
  await expect(cancel).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: info.outputPath('platform-candidate.png') })
  const candidateSemantics = await review.ariaSnapshot()
  await cancel.focus()
  await keyboardFact(page, focus, 'Enter', 'cancel room candidate')
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  expect((await keyboardProjectBackup(page, info.outputPath('platform-cancelled.sceneweave'))).hashes).toEqual(original.hashes)

  await drawRoom()
  const confirm = review.getByLabel('确认完整影响范围', { exact: true })
  await confirm.focus()
  await keyboardFact(page, focus, 'Space', 'confirm complete room scope')
  await expect(adopt).toBeEnabled()
  await keyboardFact(page, focus, buttonTab, 'reach candidate cancel')
  await expect(cancel).toBeFocused()
  await keyboardFact(page, focus, buttonTab, 'reach candidate adopt')
  await expect(adopt).toBeFocused()
  await expect(adopt).toBeInViewport({ ratio: 1 })
  await keyboardFact(page, focus, 'Enter', 'adopt room as one edit')
  await expect(review).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  const adopted = await keyboardProjectBackup(page, info.outputPath('platform-adopted.sceneweave'))
  expect(adopted.document.revision).toBe(original.document.revision + 1)
  expect(Object.keys(adopted.document.rooms)).toHaveLength(1)
  expect(Object.keys(adopted.document.walls)).toHaveLength(4)
  const room = Object.values(adopted.document.rooms)[0]
  expect(room.boundaryVertexIds.map(id => ({ x: adopted.document.vertices[id].xMm, y: adopted.document.vertices[id].yMm }))).toEqual([
    { x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 4000 }, { x: 1000, y: 4000 },
  ])
  expect(keyboardResourceHashes(adopted.hashes)).toEqual(keyboardResourceHashes(original.hashes))
  await viewport.focus()
  await keyboardFact(page, focus, 'ControlOrMeta+Z', 'undo whole room transaction')
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('platform-undone.sceneweave'))
  expect(undone.document).toEqual({ ...original.document, revision: original.document.revision + 2, updatedAt: undone.document.updatedAt })
  expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(original.hashes))
  await reloadSaved(page)
  await keyboardWorkspaceSaved(page)
  const reloaded = await keyboardProjectBackup(page, info.outputPath('platform-reloaded.sceneweave'))
  expect(reloaded.hashes).toEqual(undone.hashes)
  expect(reloaded.document).toEqual(undone.document)
  expect(reloaded.identity).toEqual(undone.identity)
  expect(reloaded.appearance).toEqual(undone.appearance)
  const dimensions = await pageDimensions(page)
  expect(errors).toEqual([])
  await savePlatformFacts(info, 'platform-main-facts', { browserName, browserVersion: browser.version(), dimensions, focus, helpSemantics, menuSemantics, candidateSemantics, revisions: [original.document.revision, adopted.document.revision, undone.document.revision, reloaded.document.revision], errors, excluded: ['native operating-system IME', 'native screen-reader speech', 'system clipboard across engines', 'browser zoom'] })
})

test('production reduced viewports preserve error semantics, keyboard drawers and expanded review controls', async ({ page, browser, browserName }, info) => {
  test.setTimeout(240000)
  const errors: string[] = [], focus: FocusFact[] = [], sizes: unknown[] = []
  const buttonTab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  const buttonBackTab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Shift+Tab' : 'Shift+Tab'
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, `重排与可访问语义 ${browserName}`)
  const original = await keyboardProjectBackup(page, info.outputPath('platform-reflow-before.sceneweave'))
  const review = page.getByRole('region', { name: '候选审阅', exact: true })
  const revision = page.locator('.workspace-unified')
  const viewport = page.getByRole('group', { name: '地图视口', exact: true })

  // These are CSS viewport/reflow checks, not a claim of real 200% browser zoom or screen-reader testing.
  for (const size of [{ width: 768, height: 500 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size)
    await closePlatformDrawers(page)
    await expect(page.getByTestId('workspace-layout')).toHaveAttribute('data-narrow', 'true')
    await pageDimensions(page)
    await openBuildingTask(page)
    const inspector = page.getByTestId('workspace-inspector')
    await page.getByLabel('房间形状', { exact: true }).selectOption('rectangle')
    const width = page.getByRole('spinbutton', { name: '房间宽度', exact: true })
    const initialWidth = await width.inputValue()
    await width.fill('')
    await width.press('Enter')
    await expect(width).toHaveValue(initialWidth)
    await expect(width).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await width.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const error = page.locator(`[id="${describedBy}"]`)
    await expect(error).toHaveAttribute('role', 'alert')
    await expect(error).toContainText('已保留原值')
    await expect(error).toBeVisible()
    await width.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`platform-error-${size.width}.png`) })
    const errorSemantics = await width.locator('xpath=../..').ariaSnapshot()
    await width.focus()
    await width.press('Escape')
    await expect(width).toHaveAttribute('aria-invalid', 'false')
    await expect(review).toHaveCount(0)
    await expect(revision).toHaveAttribute('data-revision', String(original.document.revision))
    // Resetting one field does not discard the containing form's retained draft.
    await page.getByRole('button', { name: '取消建筑草稿', exact: true }).click()

    const closeInspector = inspector.getByRole('button', { name: '关闭当前详情', exact: true })
    await closeInspector.focus()
    await keyboardFact(page, focus, 'Escape', `close ${size.width}px current-details drawer`)
    await expect(inspector).toHaveAttribute('data-open', 'false')
    await expect(page.getByRole('button', { name: '当前详情', exact: true })).toBeFocused()
    const help = page.locator('.workspace-help > summary')
    await help.focus()
    await keyboardFact(page, focus, 'Enter', `open ${size.width}px help`)
    const helpContent = page.getByRole('region', { name: '制作流程与快捷键', exact: true })
    await expect(helpContent).toBeVisible()
    await keyboardFact(page, focus, 'Tab', `focus ${size.width}px scrollable help`)
    await expect(helpContent).toBeFocused()
    await keyboardFact(page, focus, 'PageDown', `scroll ${size.width}px help`)
    await pageDimensions(page)
    await page.screenshot({ path: info.outputPath(`platform-help-${size.width}.png`) })
    await keyboardFact(page, focus, 'Escape', `close ${size.width}px help`)
    await expect(help).toBeFocused()

    await page.getByRole('button', { name: '工具：画房间', exact: true }).click()
    await expect(page.getByRole('status', { name: '房间绘制提示', exact: true })).toBeVisible()
    await expect(inspector).toHaveAttribute('data-open', 'false')
    await expect(page.getByTestId('workspace-resources')).toHaveAttribute('data-open', 'false')
    await closePlatformDrawers(page)
    await keyboardWorkspaceSaved(page)
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    await expect(page.getByLabel('地图缩放比例', { exact: true })).toHaveText('100%')
    await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeInViewport({ ratio: 1 })
    for (const point of [{ x: 1000, y: 1000 }, { x: 5000, y: 4000 }]) await clickKeyboardWorldPoint(page, point, original.document.exportBoundsMm)
    await viewport.focus()
    await keyboardFact(page, focus, 'Enter', `finish ${size.width}px room into review`)
    await expect(review).toContainText('新建新房间')
    await keyboardWorkspaceSaved(page)
    await expandChanges(review, page, focus)
    const confirm = review.getByLabel('确认完整影响范围', { exact: true })
    const cancel = review.getByRole('button', { name: '取消结构预览', exact: true })
    const adopt = review.getByRole('button', { name: '采用结构修改', exact: true })
    await confirm.focus()
    await keyboardFact(page, focus, 'Space', `confirm ${size.width}px room scope`)
    await expect(adopt).toBeEnabled()
    await keyboardFact(page, focus, buttonTab, `reach ${size.width}px candidate cancel`)
    await expect(cancel).toBeFocused()
    await keyboardFact(page, focus, buttonTab, `reach ${size.width}px candidate adopt`)
    await expect(adopt).toBeFocused()
    await expect(adopt).toBeInViewport({ ratio: 1 })
    await keyboardFact(page, focus, buttonBackTab, `return to ${size.width}px candidate cancel`)
    await expect(cancel).toBeFocused()
    await expect(cancel).toBeInViewport({ ratio: 1 })
    const dimensions = await pageDimensions(page)
    const candidateSemantics = await review.ariaSnapshot()
    await page.screenshot({ path: info.outputPath(`platform-review-${size.width}.png`) })
    await keyboardFact(page, focus, 'Enter', `cancel ${size.width}px room`)
    await expect(review).toHaveCount(0)
    await keyboardWorkspaceSaved(page)
    await expect(revision).toHaveAttribute('data-revision', String(original.document.revision))
    sizes.push({ size, dimensions, describedBy, errorSemantics, candidateSemantics })
  }
  const final = await keyboardProjectBackup(page, info.outputPath('platform-reflow-after.sceneweave'))
  expect(final.hashes).toEqual(original.hashes)
  expect(errors).toEqual([])
  await savePlatformFacts(info, 'platform-reflow-facts', { browserName, browserVersion: browser.version(), sizes, focus, revision: original.document.revision, errors, excluded: ['real browser/text zoom', 'native screen-reader speech', 'native operating-system IME', 'system clipboard across engines'] })
})
