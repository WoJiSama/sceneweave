import { expect, test, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, placeKeyboardLamp } from './keyboard-ux-helpers'
import { openGenerationTask, closeWorkspaceDrawers, openWorkspaceModule } from './workspace-navigation-helpers'

// Normal production UI; only delivery of genuine worker results is delayed.

type WorkerGate = {
  posts: number
  deliveries: number
  pending: Array<{ failed: boolean; deliver: () => void }>
}
type GatedWindow = Window & { __sceneweaveGenerationEscapeGate: WorkerGate }

/** Hold delivery of real native Worker messages; computation and payload stay intact. */
async function installWorkerGate(page: Page) {
  await page.addInitScript(() => {
    const gate: WorkerGate = { posts: 0, deliveries: 0, pending: [] }
    Object.defineProperty(window, '__sceneweaveGenerationEscapeGate', { value: gate })
    const NativeWorker = window.Worker
    let descriptor: PropertyDescriptor | undefined
    for (let prototype: object | null = NativeWorker.prototype; prototype && !descriptor; prototype = Object.getPrototypeOf(prototype)) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, 'onmessage')
    }
    if (!descriptor?.set) throw new Error('Expected native Worker.onmessage setter.')
    Object.defineProperty(window, 'Worker', {
      configurable: true, writable: true,
      value: new Proxy(NativeWorker, {
        construct(target, args, newTarget) {
          const worker = Reflect.construct(target, args, newTarget) as Worker
          if ((args[1] as WorkerOptions | undefined)?.name !== 'sceneweave-base-map') return worker
          const post = worker.postMessage.bind(worker)
          worker.postMessage = (request: unknown) => { gate.posts++; post(request) }
          let current: typeof worker.onmessage = null
          Object.defineProperty(worker, 'onmessage', {
            configurable: true, get: () => current,
            set: (handler: typeof current) => {
              current = handler
              descriptor!.set!.call(worker, handler ? (event: MessageEvent) => {
                let delivered = false
                gate.pending.push({
                  failed: !!event.data && event.data.type === 'error',
                  deliver: () => {
                    if (delivered) throw new Error('The held native response was already delivered.')
                    delivered = true; gate.deliveries++; handler.call(worker, event)
                  },
                })
              } : null)
            },
          })
          return worker
        },
      }),
    })
  })
}

async function gateFacts(page: Page) {
  return page.evaluate(() => {
    const gate = (window as unknown as GatedWindow).__sceneweaveGenerationEscapeGate
    return { posts: gate.posts, deliveries: gate.deliveries, pending: gate.pending.length, failures: gate.pending.filter(row => row.failed).length }
  })
}

for (const scenario of [
  { task: '自然地形', width: 1512, height: 982 },
  { task: '组合地貌', width: 1512, height: 982 },
  { task: '组合地貌', width: 390, height: 844 },
] as const) test(`production ${scenario.task} Escape cancels a running real Worker and permits explicit retry at ${scenario.width}px`, async ({ page }, info) => {
  test.setTimeout(300000)
  await page.setViewportSize({ width: scenario.width, height: scenario.height })
  await installWorkerGate(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const title = `取消保全 ${scenario.task} ${scenario.width}`
  await createKeyboardProject(page, title, { widthMeters: 60, heightMeters: 48 })
  await placeKeyboardLamp(page)
  await closeWorkspaceDrawers(page)
  const original = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  const undo = page.getByRole('button', { name: '撤销编辑', exact: true })
  const undoDisabled = await undo.isDisabled()
  const expectOriginal = async (running = false) => {
    await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible()
    await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
    // The normal build has no DEV workspace handle. Check the disabled control
    // while running, then exercise the retained undo stack after cancellation.
    if (undoDisabled || running) await expect(undo).toBeDisabled()
    else await expect(undo).toBeEnabled()
    await expect(page.locator('.asset-save')).toHaveText('本地已保存')
  }

  await openGenerationTask(page, scenario.task)
  const composition = scenario.task === '组合地貌'
  const settings = page.getByRole('dialog', { name: scenario.task, exact: true })
  await settings.getByLabel('左上 X（米）').fill('8')
  await settings.getByLabel('左上 Y（米）').fill('8')
  const panel = settings.getByRole('region', { name: composition ? '通用地貌组合' : '生成自然地形', exact: true })
  const seed = panel.getByLabel(composition ? '组合种子' : '地形方案种子', { exact: true })
  const seedValue = composition ? 'terrain-compose-0' : 'terrain-v1-0'
  await seed.fill(seedValue)
  if (composition) await panel.getByLabel('组合岛屿数量', { exact: true }).selectOption('2')
  const preview = panel.getByRole('button', { name: composition ? '预览地貌组合' : '生成地形预览', exact: true })
  const progress = panel.getByRole('status').filter({ hasText: composition ? '正在生成地貌组合预览' : '正在生成地形预览' })
  const cancelRunning = panel.getByRole('button', { name: composition ? '取消地貌组合生成' : '取消地形生成', exact: true })
  const candidate = page.getByTestId('workspace-inspector').getByRole('article', { name: composition ? '地貌组合候选' : '当前地形候选', exact: true })

  await preview.click()
  await expect(progress).toBeVisible()
  await expect.poll(async () => (await gateFacts(page)).pending, { timeout: 120000 }).toBe(1)
  expect(await gateFacts(page)).toEqual({ posts: 1, deliveries: 0, pending: 1, failures: 0 })
  await cancelRunning.scrollIntoViewIfNeeded()
  await expect(cancelRunning).toBeInViewport({ ratio: 1 })
  await cancelRunning.focus()
  await expect(cancelRunning).toBeFocused()
  await page.screenshot({ path: info.outputPath('running-before-escape.png') })
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expect(candidate).toHaveCount(0)
  await expectOriginal()

  // Release the exact result captured before Escape, even though its native
  // worker has now been terminated. The client's settled/epoch guards must win.
  await page.evaluate(() => (window as unknown as GatedWindow).__sceneweaveGenerationEscapeGate.pending[0].deliver())
  await expect(candidate).toHaveCount(0)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  await expectOriginal()
  await page.screenshot({ path: info.outputPath('cancelled-after-late-result.png') })
  await closeWorkspaceDrawers(page)
  expect((await keyboardProjectBackup(page, info.outputPath('after-late-result.sceneweave'))).hashes).toEqual(original.hashes)
  expect(await gateFacts(page)).toEqual({ posts: 1, deliveries: 1, pending: 1, failures: 0 })

  // A second real computation starts only after this click. Hold it too, so an
  // old candidate cannot masquerade as a successful retry while awaiting it.
  await openGenerationTask(page, scenario.task)
  await expect(progress).toHaveCount(0)
  await expect(cancelRunning).toHaveCount(0)
  await expect(preview).toBeEnabled()
  await expect(seed).toHaveValue(seedValue)
  await expect(settings.getByLabel('左上 X（米）')).toHaveValue('8')
  if (composition) await expect(panel.getByLabel('组合岛屿数量', { exact: true })).toHaveValue('2')
  await preview.click()
  await expect(progress).toBeVisible()
  await expect.poll(async () => (await gateFacts(page)).pending, { timeout: 120000 }).toBe(2)
  await expect(candidate).toHaveCount(0)
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  await expect(undo).toBeDisabled()
  expect(await gateFacts(page)).toEqual({ posts: 2, deliveries: 1, pending: 2, failures: 0 })
  await page.evaluate(() => (window as unknown as GatedWindow).__sceneweaveGenerationEscapeGate.pending[1].deliver())
  const review = page.getByRole('group', { name: '当前画布生成预览' })
  await expect(review).toBeVisible({ timeout: 120000 })
  await expect(review.getByRole('button', { name: '加入当前画布' })).toBeEnabled()
  await review.getByRole('button', { name: '候选详情', exact: true }).click()
  await expect(candidate).toBeVisible({ timeout: 120000 })
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await closeWorkspaceDrawers(page)
  await openWorkspaceModule(page, '场景')
  await page.locator('.workspace-session-feedback').getByRole('button', { name: '返回候选审阅', exact: true }).click()
  await expect(candidate).toBeVisible()
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(original.document.revision))
  await page.screenshot({ path: info.outputPath('explicit-retry-candidate.png') })
  await candidate.getByRole('button', { name: composition ? '取消组合预览' : '取消当前地形候选', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await keyboardWorkspaceSaved(page)
  await expectOriginal()
  await closeWorkspaceDrawers(page)
  expect((await keyboardProjectBackup(page, info.outputPath('after-retry-cancel.sceneweave'))).hashes).toEqual(original.hashes)
  expect(await gateFacts(page)).toEqual({ posts: 2, deliveries: 2, pending: 2, failures: 0 })
  expect(undoDisabled).toBe(false)
  await undo.click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('retained-undo.sceneweave'))
  expect(Object.keys(undone.document.props)).toHaveLength(Object.keys(original.document.props).length - 1)
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const redone = await keyboardProjectBackup(page, info.outputPath('retained-redo.sceneweave'))
  expect(redone.document.props).toEqual(original.document.props)
  expect(redone.document.revision).toBe(original.document.revision + 2)
  expect(errors).toEqual([])
})
