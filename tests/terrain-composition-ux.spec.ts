import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { openGenerationTask } from './workspace-navigation-helpers'

type WorkerGate = { hold: boolean; posts: number; pending: Array<{ deliver: () => void; fail: () => void }> }
type GatedWindow = Window & { __sceneweaveCompositionWorkerGate: WorkerGate }

async function installWorkerGate(page: Page) {
  await page.addInitScript(() => {
    const gate: WorkerGate = { hold: true, posts: 0, pending: [] }
    Object.defineProperty(window, '__sceneweaveCompositionWorkerGate', { value: gate })
    const NativeWorker = window.Worker
    let descriptor: PropertyDescriptor | undefined
    for (let prototype: object | null = NativeWorker.prototype; prototype && !descriptor; prototype = Object.getPrototypeOf(prototype)) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, 'onmessage')
    }
    if (!descriptor?.set) throw new Error('Worker.onmessage cannot be controlled in this browser.')
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
                if (!gate.hold) { handler.call(worker, event); return }
                const error = worker.onmessageerror
                gate.pending.push({
                  deliver: () => handler.call(worker, event),
                  fail: () => {
                    if (!error) throw new Error('Expected the real messageerror handler.')
                    error.call(worker, new MessageEvent('messageerror'))
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

async function backupHashes(page: Page) {
  const menu = page.locator('.workspace-export-menu')
  await menu.locator('summary').click()
  const downloaded = page.waitForEvent('download')
  await menu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
  const filename = await (await downloaded).path()
  if (!filename) throw new Error('Expected the complete project download.')
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  await menu.locator('summary').click()
  const files = unzipSync(new Uint8Array(await readFile(filename)))
  return Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]))
}

async function openComposition(page: Page) {
  await installWorkerGate(page)
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('组合体验原工程')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
  const original = await backupHashes(page)
  const revision = await page.locator('.workspace-unified').getAttribute('data-revision')
  await openGenerationTask(page, '组合地貌')
  const panel = page.getByRole('region', { name: '通用地貌组合', exact: true })
  await panel.getByLabel('组合岛屿数量', { exact: true }).selectOption('2')
  return { original, revision, panel, progress: panel.getByRole('status', { name: '地貌组合处理状态', exact: true }),
    candidate: panel.getByRole('article', { name: '地貌组合候选', exact: true }) }
}

async function expectOriginal(page: Page, revision: string | null) {
  await expect(page.getByRole('heading', { name: '组合体验原工程', level: 1, exact: true })).toBeVisible()
  await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', revision ?? '')
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存')
}

test('composition running cancel keeps parameters and the complete project and ignores a late real Worker result', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { original, revision, panel, progress, candidate } = await openComposition(page)
  await panel.getByRole('button', { name: '预览地貌组合', exact: true }).click()
  await expect(progress).toContainText('正在生成地貌组合预览')
  await page.waitForFunction(() => (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.pending.length === 1)
  await page.screenshot({ path: info.outputPath('composition-running.png') })
  await progress.getByRole('button', { name: '取消地貌组合生成', exact: true }).click()
  await expect(progress).toHaveCount(0)
  await expect(panel.getByRole('status', { name: '地貌组合操作结果', exact: true })).toHaveText('已取消地貌组合生成，当前工程未改变。')
  await page.evaluate(() => { (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.pending[0].deliver() })
  await expect(candidate).toHaveCount(0)
  await expect(panel.getByLabel('组合种子', { exact: true })).toHaveValue('terrain-compose-0')
  await expect(panel.getByLabel('组合岛屿数量', { exact: true })).toHaveValue('2')
  await expect(panel.getByRole('button', { name: '预览地貌组合', exact: true })).toBeEnabled()
  await expectOriginal(page, revision)
  await page.screenshot({ path: info.outputPath('composition-cancelled.png') })
  expect(await backupHashes(page)).toEqual(original)
  expect(await page.evaluate(() => (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.posts)).toBe(1)
  expect(errors).toEqual([])
})

test('composition failure keeps the project and only retries after an explicit click with a real successful candidate', async ({ page }, info) => {
  test.setTimeout(300000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { original, revision, panel, progress, candidate } = await openComposition(page)
  await panel.getByRole('button', { name: '预览地貌组合', exact: true }).click()
  await page.waitForFunction(() => (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.pending.length === 1)
  await page.evaluate(() => { (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.pending[0].fail() })
  await expect(progress).toHaveCount(0)
  await expect(panel.getByRole('alert')).toContainText('程序底图响应格式或身份校验失败')
  await expect(panel.getByRole('alert')).toBeInViewport({ ratio: 1 })
  await expect(panel).toContainText('未自动重试')
  await expect(panel.getByRole('button', { name: '重新预览地貌组合', exact: true })).toBeEnabled()
  await expect(panel.getByRole('button', { name: '重新预览地貌组合', exact: true })).toBeInViewport({ ratio: 1 })
  await expectOriginal(page, revision)
  await page.evaluate(() => { (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.pending[0].deliver() })
  await expect(candidate).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('composition-failed.png') })
  expect(await backupHashes(page)).toEqual(original)
  expect(await page.evaluate(() => (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.posts)).toBe(1)

  await page.evaluate(() => { (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.hold = false })
  await panel.getByRole('button', { name: '重新预览地貌组合', exact: true }).click()
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await expect(candidate).toBeVisible({ timeout: 120000 })
  await expect(candidate.getByRole('button', { name: '采用地貌组合', exact: true })).toBeEnabled()
  await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 })
  await expect(panel.getByLabel('组合岛屿数量', { exact: true })).toHaveValue('2')
  expect(await page.evaluate(() => (window as unknown as GatedWindow).__sceneweaveCompositionWorkerGate.posts)).toBe(2)
  await page.screenshot({ path: info.outputPath('composition-retried.png') })
  await candidate.getByRole('button', { name: '取消组合预览', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await expect(panel.getByRole('status', { name: '地貌组合操作结果', exact: true })).toHaveText('已取消组合预览，当前工程未改变。')
  await expectOriginal(page, revision)
  expect(await backupHashes(page)).toEqual(original)
  expect(errors).toEqual([])
})
