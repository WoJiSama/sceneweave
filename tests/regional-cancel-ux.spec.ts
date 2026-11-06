import { expect, test, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel, placeKeyboardLamp } from './keyboard-ux-helpers'
import { openGenerationTask } from './workspace-navigation-helpers'

// Resource preparation cancellation with a real encoded PNG; synchronous geometry is not preempted.

type PngGate = {
  armed: boolean
  matches: number
  released: number
  pending: Array<{ type: string; size: number; width: number; height: number; release: () => void }>
}
type GatedWindow = Window & { __sceneweaveRegionalPngGate: PngGate }

/** Keep the original canvas, pixels, encoder and Blob; hold only fulfillment. */
async function installPngGate(page: Page) {
  await page.evaluate(() => {
    if (typeof OffscreenCanvas !== 'function' || typeof OffscreenCanvas.prototype.convertToBlob !== 'function') {
      throw new Error('This draft requires the native Chromium OffscreenCanvas PNG path.')
    }
    const native = OffscreenCanvas.prototype.convertToBlob
    const gate: PngGate = { armed: false, matches: 0, released: 0, pending: [] }
    Object.defineProperty(window, '__sceneweaveRegionalPngGate', { value: gate })
    OffscreenCanvas.prototype.convertToBlob = function(options) {
      const actual = native.call(this, options)
      if (this.width !== 256 || this.height !== 256 || options?.type !== 'image/png') return actual
      gate.matches++
      if (!gate.armed) return actual
      gate.armed = false
      return actual.then(async blob => {
        const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer)
        if (blob.type !== 'image/png' || blob.size < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
          throw new Error('The real canvas encoder did not return a PNG.')
        }
        const width = view.getUint32(16), height = view.getUint32(20)
        if (width !== 256 || height !== 256) throw new Error('The real encoded PNG dimensions do not match the symbol raster.')
        return new Promise<Blob>(resolve => {
          let released = false
          gate.pending.push({ type: blob.type, size: blob.size, width, height, release: () => {
            if (released) throw new Error('Native PNG fulfillment was already released.')
            released = true; gate.released++; resolve(blob)
          } })
        })
      })
    }
  })
}

async function facts(page: Page) {
  return page.evaluate(() => {
    const gate = (window as unknown as GatedWindow).__sceneweaveRegionalPngGate
    return { armed: gate.armed, matches: gate.matches, released: gate.released, pending: gate.pending.map(({ type, size, width, height }) => ({ type, size, width, height })) }
  })
}

async function closeResourceDrawer(page: Page, width: number) {
  if (width < 1080 && await page.getByTestId('workspace-resources').getAttribute('data-open') === 'true') {
    await page.getByRole('button', { name: '关闭资源面板', exact: true }).click()
  }
}

for (const width of [1512, 390]) test(`production regional Escape cancels a real PNG preparation and explicitly retries at ${width}px`, async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'The gate intentionally targets the current native Chromium OffscreenCanvas PNG path.')
  test.setTimeout(240000)
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const title = `区域取消保全 ${width}`
  await createKeyboardProject(page, title)
  await placeKeyboardLamp(page)
  if (width === 390) {
    const inspector = page.getByTestId('workspace-inspector')
    if (await inspector.getAttribute('data-open') === 'true') await inspector.getByRole('button', { name: '关闭属性面板', exact: true }).click()
  }
  await closeResourceDrawer(page, width)
  const before = await keyboardProjectBackup(page, info.outputPath('regional-before.sceneweave'))
  const revision = String(before.document.revision)
  const undo = page.getByRole('button', { name: '撤销编辑', exact: true })
  await expect(undo).toBeEnabled()
  await installPngGate(page)
  await openKeyboardPanel(page, 'resources')
  await openGenerationTask(page, '区域地图')
  let panel = page.getByRole('region', { name: '区域地图', exact: true })
  const preview = () => panel.getByRole('button', { name: '预览独立区域地图', exact: true })
  const candidate = () => panel.getByRole('article', { name: '区域候选', exact: true })
  const progress = () => panel.getByRole('status').filter({ hasText: '正在校验区域候选与真实资源' })
  // These are the actual defaults and the UI's request is riverlands,
  // regional-2026-1, widthMm 10000000, heightMm 8000000.
  await expect(panel.getByLabel('区域配方', { exact: true })).toHaveValue('riverlands')
  await expect(panel.getByLabel('区域种子', { exact: true })).toHaveValue('regional-2026-1')
  await expect(panel.getByLabel('区域宽 km', { exact: true })).toHaveValue('10')
  await expect(panel.getByLabel('区域高 km', { exact: true })).toHaveValue('8')

  await page.evaluate(() => { (window as unknown as GatedWindow).__sceneweaveRegionalPngGate.armed = true })
  await preview().click()
  await expect(progress()).toBeVisible()
  await expect.poll(async () => (await facts(page)).pending.length, { timeout: 30000 }).toBe(1)
  const running = await facts(page)
  expect(running.matches).toBe(1)
  expect(running.pending[0]).toMatchObject({ type: 'image/png', width: 256, height: 256 })
  expect(running.pending[0].size).toBeGreaterThan(24)
  const cancel = panel.getByRole('button', { name: '取消区域候选', exact: true })
  await cancel.scrollIntoViewIfNeeded()
  await expect(cancel).toBeInViewport({ ratio: 1 })
  await cancel.focus()
  await page.screenshot({ path: info.outputPath('regional-running-png-held.png') })
  await page.keyboard.press('Escape')
  await expect(progress()).toHaveCount(0)
  await expect(candidate()).toHaveCount(0)
  await expect(preview()).toBeEnabled()
  if (width === 390) await expect(page.getByTestId('workspace-resources')).toHaveAttribute('data-open', 'true')

  // This is the actual successful native encoding from the canceled operation.
  // Its abort checkpoint must reject before preparing the second symbol.
  await page.evaluate(() => (window as unknown as GatedWindow).__sceneweaveRegionalPngGate.pending[0].release())
  await keyboardWorkspaceSaved(page)
  await expect(candidate()).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await expect(undo).toBeEnabled()
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', revision)
  expect((await facts(page)).matches).toBe(1)
  await page.screenshot({ path: info.outputPath('regional-cancelled-after-native-png.png') })
  await closeResourceDrawer(page, width)
  expect((await keyboardProjectBackup(page, info.outputPath('regional-after-cancel.sceneweave'))).hashes).toEqual(before.hashes)

  // A second held native encode is proof of a fresh explicit attempt. Once it
  // is released, all remaining original SVG/PNG validation runs normally.
  await openKeyboardPanel(page, 'resources')
  panel = page.getByRole('region', { name: '区域地图', exact: true })
  await page.evaluate(() => { (window as unknown as GatedWindow).__sceneweaveRegionalPngGate.armed = true })
  await preview().click()
  await expect.poll(async () => (await facts(page)).pending.length, { timeout: 30000 }).toBe(2)
  await expect(progress()).toBeVisible()
  await expect(candidate()).toHaveCount(0)
  expect((await facts(page)).matches).toBe(2)
  await page.evaluate(() => (window as unknown as GatedWindow).__sceneweaveRegionalPngGate.pending[1].release())
  await expect(candidate()).toBeVisible({ timeout: 120000 })
  await expect(candidate()).toContainText('河谷古道')
  await expect(candidate().getByLabel('确认区域候选范围', { exact: true })).toBeEnabled()
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', revision)
  await page.screenshot({ path: info.outputPath('regional-retried-candidate.png') })
  await panel.getByRole('button', { name: '取消区域候选', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await expect(candidate()).toHaveCount(0)
  await expect(undo).toBeEnabled()
  await closeResourceDrawer(page, width)
  expect((await keyboardProjectBackup(page, info.outputPath('regional-after-retry-cancel.sceneweave'))).hashes).toEqual(before.hashes)
  expect(errors).toEqual([])
})
