import { chromium, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { clickKeyboardWorldPoint, createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'

declare const chrome: { tabs: {
  query: (query: Record<string, unknown>) => Promise<Array<{ id?: number; url?: string }>>
  setZoom: (id: number, factor: number) => Promise<void>
  getZoom: (id: number) => Promise<number>
} }

test('real Chromium tab zoom at 200 percent keeps review, errors and keyboard controls reachable', async ({ baseURL }, info) => {
  test.setTimeout(240000)
  if (!baseURL) throw new Error('A frozen normal production baseURL is required.')
  const temporary = await mkdtemp(join(tmpdir(), 'sceneweave-zoom-'))
  const extension = join(temporary, 'extension')
  await mkdir(extension)
  // The browser owns this zoom. No CSS zoom, viewport emulation or app-state injection.
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Sceneweave local browser zoom verification', version: '1.0',
    permissions: ['tabs'], background: { service_worker: 'worker.js' },
  }))
  await writeFile(join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});')
  const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
    channel: 'chromium', headless: true, baseURL, viewport: { width: 1512, height: 982 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  })
  let restore: (() => Promise<unknown>) | undefined
  try {
    const page = context.pages()[0] ?? await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(baseURL)
    await createKeyboardProject(page, '浏览器真实200%放大')
    const original = await keyboardProjectBackup(page, info.outputPath('zoom-before.sceneweave'))
    const initial = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const targetUrl = page.url()
    const setZoom = (factor: number) => worker.evaluate(async ({ url, factor }: { url: string; factor: number }) => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find(tab => tab.url === url);
      if (!target?.id) throw new Error('The isolated test tab was not found.');
      await chrome.tabs.setZoom(target.id, factor);
      return { tabId: target.id, factor: await chrome.tabs.getZoom(target.id) };
    }, { url: targetUrl, factor })
    restore = () => setZoom(1)
    const browserZoom = await setZoom(2)
    expect(browserZoom.factor).toBe(2)
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(initial.dpr * 2)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(initial.width / 2)
    const layout = page.getByTestId('workspace-layout')
    await expect(layout).toHaveAttribute('data-narrow', 'true')
    const assertWidth = async () => {
      const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, root: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
      expect(size.root).toBeLessThanOrEqual(size.width)
      expect(size.body).toBeLessThanOrEqual(size.width)
      return size
    }
    const closeDrawers = async () => {
      for (const [id, name] of [['resources', '资源面板'], ['inspector', '属性面板'], ['navigation', '场景导航']] as const) {
        const panel = page.getByTestId(`workspace-${id}`)
        if (await panel.getAttribute('data-open') !== 'true') continue
        await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
        await expect(panel).toHaveAttribute('data-open', 'false')
        await expect(page.getByRole('button', { name, exact: true })).toBeFocused()
      }
    }
    await closeDrawers()
    const zoomed = await assertWidth()
    const resources = await openKeyboardPanel(page, 'resources')
    await resources.getByRole('tab', { name: '建筑', exact: true }).click()
    const width = page.getByRole('spinbutton', { name: '房间宽度', exact: true })
    const initialWidth = await width.inputValue()
    await width.fill('')
    await width.press('Enter')
    await expect(width).toHaveValue(initialWidth)
    await expect(width).toHaveAttribute('aria-invalid', 'true')
    const errorId = await width.getAttribute('aria-describedby')
    expect(errorId).toBeTruthy()
    const errorMessage = page.locator(`[id="${errorId}"]`)
    await expect(errorMessage).toContainText('已保留原值')
    await width.scrollIntoViewIfNeeded()
    // Native 200% zoom can round a scroll edge by less than one CSS pixel.
    await expect(width).toBeInViewport({ ratio: 0.99 })
    // The drawer's module tabs are sticky; align below them instead of under their overlay.
    await errorMessage.evaluate(node => node.scrollIntoView({ block: 'end' }))
    const errorVisibility = await errorMessage.evaluate(node => {
      const rect = node.getBoundingClientRect()
      const body = node.closest('.workspace-panel-body')!.getBoundingClientRect()
      const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      const visibleHeight = Math.max(0, Math.min(rect.bottom, body.bottom, innerHeight) - Math.max(rect.top, body.top, 0))
      const visibleWidth = Math.max(0, Math.min(rect.right, body.right, innerWidth) - Math.max(rect.left, body.left, 0))
      return { text: node.textContent, top: rect.top, bottom: rect.bottom, hiddenHeight: rect.height - visibleHeight, hiddenWidth: rect.width - visibleWidth, unobscured: target === node || !!target && node.contains(target), coveringTag: target?.tagName, coveringLabel: target?.getAttribute('aria-label') }
    })
    await writeFile(info.outputPath('browser-zoom-error-visibility.json'), JSON.stringify(errorVisibility, null, 2))
    expect(errorVisibility.hiddenHeight).toBeLessThanOrEqual(1)
    expect(errorVisibility.hiddenWidth).toBeLessThanOrEqual(1)
    expect(errorVisibility.unobscured).toBe(true)
    await page.screenshot({ path: info.outputPath('browser-zoom-200-error.png') })
    await width.press('Escape')
    await expect(width).toHaveAttribute('aria-invalid', 'false')
    await page.getByRole('button', { name: '取消建筑草稿', exact: true }).click()
    const closeResources = resources.getByRole('button', { name: '关闭资源面板', exact: true })
    await closeResources.focus()
    await closeResources.press('Escape')
    await expect(resources).toHaveAttribute('data-open', 'false')
    await expect(page.getByRole('button', { name: '资源面板', exact: true })).toBeFocused()

    const help = page.locator('.workspace-help > summary')
    await help.focus()
    await help.press('Enter')
    const helpContent = page.getByRole('region', { name: '制作流程与快捷键', exact: true })
    await expect(helpContent).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(helpContent).toBeFocused()
    await page.keyboard.press('PageDown')
    await assertWidth()
    await page.screenshot({ path: info.outputPath('browser-zoom-200-help.png') })
    await page.keyboard.press('Escape')
    await expect(help).toBeFocused()

    await page.getByRole('button', { name: '工具：画房间', exact: true }).click()
    await expect(resources).toHaveAttribute('data-open', 'true')
    await closeDrawers()
    await keyboardWorkspaceSaved(page)
    await page.getByRole('button', { name: '适应全图', exact: true }).click()
    await expect(page.getByLabel('地图缩放比例', { exact: true })).toHaveText('100%')
    await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeInViewport({ ratio: 0.99 })
    const canvasClicks: unknown[] = []
    for (const point of [{ x: 1000, y: 1000 }, { x: 5000, y: 4000 }]) {
      const canvas = page.getByLabel('材质场景主持人预览', { exact: true })
      const box = await canvas.boundingBox()
      if (!box) throw new Error('The zoomed canvas has no visible bounds.')
      const bounds = original.document.exportBoundsMm
      const pixel = { x: box.x + (point.x - bounds.x) / bounds.width * box.width, y: box.y + (point.y - bounds.y) / bounds.height * box.height }
      const before = await page.evaluate(({ x, y }) => {
        const node = document.elementFromPoint(x, y)
        const canvas = document.querySelector('[aria-label="材质场景主持人预览"]')!.getBoundingClientRect()
        return { target: node?.tagName, label: node?.getAttribute('aria-label'), text: node?.textContent?.slice(0, 60), inMapViewport: !!node?.closest('[aria-label="地图视口"]'), canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height } }
      }, pixel)
      expect(before.inMapViewport).toBe(true)
      await clickKeyboardWorldPoint(page, point, bounds)
      canvasClicks.push({ point, box, pixel, before, resourcesOpen: await resources.getAttribute('data-open') })
      await writeFile(info.outputPath('browser-zoom-pointer-facts.json'), JSON.stringify(canvasClicks, null, 2))
    }
    const viewport = page.getByRole('group', { name: '地图视口', exact: true })
    await viewport.focus()
    await viewport.press('Enter')
    const review = page.getByRole('region', { name: '候选审阅', exact: true })
    await expect(review).toContainText('新建新房间')
    await keyboardWorkspaceSaved(page)
    const changes = review.locator('details.composition-preview-details')
    await changes.locator(':scope > summary').focus()
    await page.keyboard.press('Enter')
    await expect(changes).toHaveAttribute('open', '')
    await changes.locator('summary').filter({ hasText: '字段与 ID 详情' }).first().focus()
    await page.keyboard.press('Space')
    const scroll = await review.locator('.workspace-candidate-body').evaluate(node => ({ content: node.scrollHeight, visible: node.clientHeight }))
    expect(scroll.content).toBeGreaterThan(scroll.visible)
    const confirm = review.getByLabel('确认完整影响范围', { exact: true })
    const cancel = review.getByRole('button', { name: '取消结构预览', exact: true })
    const adopt = review.getByRole('button', { name: '采用结构修改', exact: true })
    await confirm.focus()
    await page.keyboard.press('Space')
    await expect(adopt).toBeEnabled()
    await page.keyboard.press('Tab')
    await expect(cancel).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(adopt).toBeFocused()
    await expect(adopt).toBeInViewport({ ratio: 0.99 })
    await page.keyboard.press('Shift+Tab')
    await expect(cancel).toBeFocused()
    await expect(cancel).toBeInViewport({ ratio: 0.99 })
    await assertWidth()
    await page.screenshot({ path: info.outputPath('browser-zoom-200-review.png') })
    await page.keyboard.press('Enter')
    await expect(review).toHaveCount(0)
    await keyboardWorkspaceSaved(page)
    const after = await keyboardProjectBackup(page, info.outputPath('zoom-after.sceneweave'))
    expect(after.hashes).toEqual(original.hashes)
    expect(errors).toEqual([])
    const restored = await setZoom(1)
    restore = undefined
    expect(restored.factor).toBe(1)
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(initial.dpr)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(initial.width)
    const facts = { method: 'Isolated bundled Chromium, native chrome.tabs.setZoom/getZoom', browserVersion: context.browser()?.version(), initial, browserZoom, zoomed, errorVisibility, canvasClicks, scroll, restored, errors, excluded: ['native VoiceOver speech', 'real operating-system IME', 'Safari application', 'OS display scaling'] }
    const factsPath = info.outputPath('browser-zoom-facts.json')
    await writeFile(factsPath, JSON.stringify(facts, null, 2))
    await info.attach('browser-zoom-facts.json', { path: factsPath, contentType: 'application/json' })
  } catch (error) {
    const page = context.pages()[0]
    if (page) await page.screenshot({ path: info.outputPath('browser-zoom-failure.png') }).catch(() => {})
    throw error
  } finally {
    if (restore) await restore().catch(() => {})
    await context.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
