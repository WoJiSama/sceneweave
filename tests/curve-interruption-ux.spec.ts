import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel } from './keyboard-ux-helpers'
import { openGenerationTask, openTerrainTask } from './workspace-navigation-helpers'

async function closeDrawers(page: Page): Promise<void> {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, name] of [['resources', '资源面板'], ['inspector', '属性面板'], ['navigation', '场景导航']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') !== 'true') continue
    await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
    await expect(panel).toHaveAttribute('data-open', 'false')
  }
}

async function chooseContour(page: Page): Promise<void> {
  await openKeyboardPanel(page, 'resources')
  await openTerrainTask(page, '修改地形')
  await page.getByLabel('地形编辑轮廓', { exact: true }).selectOption('terrain-coast-curve')
  await closeDrawers(page)
  await page.getByRole('button', { name: '适应全图', exact: true }).click()
  await expect(page.getByTestId('curve-handle-0-control1')).toBeVisible()
}

async function geometry(page: Page) {
  return page.locator('svg.visual-controls').evaluate(node => ({
    path: node.querySelector('path')!.getAttribute('d'),
    handles: Array.from(node.querySelectorAll('circle')).map(handle => ({
      id: handle.getAttribute('data-testid'), x: handle.getAttribute('cx'), y: handle.getAttribute('cy'),
    })),
  }))
}

// Only observe DOM events; no application hooks, project injection or direct database writes.
async function observeGesture(page: Page): Promise<void> {
  await page.locator('svg.visual-controls').evaluate(node => {
    const events: { type: string; trusted: boolean; pointerId?: number; pointerType?: string }[] = []
    Reflect.set(window, '__curveGestureEvents', events)
    for (const type of ['pointerdown', 'pointercancel', 'pointerup', 'gotpointercapture', 'lostpointercapture']) {
      node.addEventListener(type, event => {
        const pointer = event as PointerEvent
        events.push({ type, trusted: event.isTrusted, pointerId: pointer.pointerId, pointerType: pointer.pointerType })
      }, { capture: true })
    }
    window.addEventListener('blur', event => events.push({ type: 'blur', trusted: event.isTrusted }), { once: true })
  })
}

async function gestureEvents(page: Page) {
  return page.evaluate(() => Reflect.get(window, '__curveGestureEvents') as {
    type: string; trusted: boolean; pointerId?: number; pointerType?: string
  }[])
}

for (const size of [{ width: 1512, height: 982 }, { width: 390, height: 844 }]) {
  test(`production curve native pointer interruption and window blur handler recover at ${size.width}px`, async ({ page, context }, info) => {
    test.setTimeout(360_000)
    await page.setViewportSize(size)
    const errors: string[] = [], editWorkers: string[] = [], facts: unknown[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('worker', worker => { if (/edit-worker/.test(worker.url())) editWorkers.push(worker.url()) })
    await createKeyboardProject(page, `曲线中断恢复 ${size.width}`)
    await openKeyboardPanel(page, 'resources')
    await openGenerationTask(page, '自然地形')
    await page.getByRole('button', { name: '生成地形预览', exact: true }).click()
    await expect(page.getByRole('button', { name: '采用当前地形方案', exact: true })).toBeEnabled({ timeout: 90_000 })
    await page.getByRole('button', { name: '采用当前地形方案', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    await closeDrawers(page)
    const before = await keyboardProjectBackup(page, info.outputPath('curve-before.sceneweave'))
    expect(before.document.units.display).toBe('m')
    const revision = page.locator('.workspace-unified')
    const undo = page.getByRole('button', { name: '撤销编辑', exact: true })
    await expect(undo).toBeDisabled()
    const cdp = await context.newCDPSession(page)

    for (const interruption of ['pointercancel', 'blur-handler', 'lostcapture'] as const) {
      await chooseContour(page)
      const controls = page.locator('svg.visual-controls'), handle = page.getByTestId('curve-handle-0-control1')
      const original = await geometry(page), workerCount = editWorkers.length
      await observeGesture(page)
      const box = (await handle.boundingBox())!, point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      expect(await handle.evaluate((node, p) => document.elementFromPoint(p.x, p.y) === node, point)).toBe(true)
      if (interruption === 'pointercancel') {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 7, radiusX: 1, radiusY: 1, force: 1 }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 12, y: point.y + 8, id: 7, radiusX: 1, radiusY: 1, force: 1 }] })
      } else {
        await page.mouse.move(point.x, point.y); await page.mouse.down()
        await page.mouse.move(point.x + 12, point.y + 8, { steps: 4 })
      }
      await expect.poll(() => geometry(page)).not.toEqual(original)
      const down = (await gestureEvents(page)).find(event => event.type === 'pointerdown')!
      expect(down.trusted).toBe(true)
      expect(down.pointerType).toBe(interruption === 'pointercancel' ? 'touch' : 'mouse')
      expect(await controls.evaluate((node, id) => node.hasPointerCapture(id), down.pointerId!)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${interruption}-dragging.png`) })

      if (interruption === 'pointercancel') {
        // CDP asks Chromium to cancel the real touch stream; the DOM event must be trusted.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      } else if (interruption === 'blur-handler') {
        // Headless Chromium keeps both isolated tabs focused. This proves only
        // the registered blur handler, not a native operating-system focus change.
        await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      } else {
        // Exercise the browser's capture API, followed by a native move that delivers capture loss.
        await controls.evaluate((node, id) => node.releasePointerCapture(id), down.pointerId!)
        await page.mouse.move(point.x + 14, point.y + 10)
      }
      await expect.poll(() => geometry(page)).toEqual(original)
      expect(await controls.evaluate((node, id) => node.hasPointerCapture(id), down.pointerId!)).toBe(false)
      await page.mouse.up()
      await page.mouse.move(point.x + 20, point.y + 12, { steps: 3 })
      await expect.poll(() => geometry(page)).toEqual(original)
      const events = await gestureEvents(page)
      const expectedEvent = interruption === 'pointercancel' ? 'pointercancel' : interruption === 'blur-handler' ? 'blur' : 'lostpointercapture'
      expect(events.some(event => event.type === expectedEvent && event.trusted === (interruption !== 'blur-handler'))).toBe(true)
      await openKeyboardPanel(page, 'resources')
      await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toHaveCount(0)
      await expect(page.locator('.terrain-editing-panel .terrain-generation-progress')).toHaveCount(0)
      await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
      expect(editWorkers.length).toBe(workerCount)
      await expect(undo).toBeDisabled()
      await closeDrawers(page)
      await page.screenshot({ path: info.outputPath(`${interruption}-cancelled.png`) })

      // Prove a fresh gesture can capture and move the handle, then cancel it.
      // Successful release into a terrain candidate is a separate application check.
      const recoveryBox = (await handle.boundingBox())!, recovery = { x: recoveryBox.x + recoveryBox.width / 2, y: recoveryBox.y + recoveryBox.height / 2 }
      await page.mouse.move(recovery.x, recovery.y); await page.mouse.down()
      await page.mouse.move(recovery.x + 2, recovery.y + 1, { steps: 2 })
      await expect.poll(() => geometry(page)).not.toEqual(original)
      const recoveryDown = (await gestureEvents(page)).findLast(event => event.type === 'pointerdown')!
      expect(recoveryDown.trusted).toBe(true)
      expect(recoveryDown.pointerType).toBe('mouse')
      expect(await controls.evaluate((node, id) => node.hasPointerCapture(id), recoveryDown.pointerId!)).toBe(true)
      await page.keyboard.press('Escape')
      await expect.poll(() => geometry(page)).toEqual(original)
      expect(await controls.evaluate((node, id) => node.hasPointerCapture(id), recoveryDown.pointerId!)).toBe(false)
      await page.mouse.up()
      await openKeyboardPanel(page, 'resources')
      await expect(page.getByRole('article', { name: '本次地形影响', exact: true })).toHaveCount(0)
      expect(editWorkers.length).toBe(workerCount)
      await expect(revision).toHaveAttribute('data-revision', String(before.document.revision))
      await page.getByRole('button', { name: '取消本次地形修改', exact: true }).click()
      await keyboardWorkspaceSaved(page)
      await expect(undo).toBeDisabled()
      await closeDrawers(page)
      const after = await keyboardProjectBackup(page, info.outputPath(`${interruption}-recovered.sceneweave`))
      expect(after.hashes).toEqual(before.hashes)
      facts.push({ interruption, pointerId: down.pointerId, events, recoveryEvents: await gestureEvents(page), original, revision: before.document.revision, hashes: after.hashes })
    }

    // A full page reload and normal recent-project open verify the saved project, independently of the live form.
    await page.reload()
    await expect(page.locator('.asset-save')).toHaveText('尚未打开工程')
    await page.getByRole('button', { name: '回到首页', exact: true }).click()
    await page.getByTestId('workspace-home').locator(`[data-project-key="native:${before.document.sceneId}"]`).getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    await closeDrawers(page)
    expect((await keyboardProjectBackup(page, info.outputPath('curve-cold.sceneweave'))).hashes).toEqual(before.hashes)
    expect(errors).toEqual([])
    await cdp.detach()
    await writeFile(info.outputPath('curve-interruption-facts.json'), JSON.stringify({ viewport: size, browserVersion: context.browser()!.version(), facts, errors,
      excluded: ['native window focus loss', 'successful curve release and adoption', 'multi-touch', 'other curves and browser engines', 'visual P3'] }, null, 2))
  })
}
