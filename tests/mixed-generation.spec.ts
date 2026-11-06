import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

type GenerationWorkerGate = { hold: boolean; pending: Array<() => void> }
type WindowWithGenerationWorkerGate = Window & { __sceneweaveGenerationWorkerGate: GenerationWorkerGate }

test('mixed forest delivery preserves the original, supports local undo and cold-open', async ({ page }, info) => {
  test.setTimeout(480_000)
  const errors: string[] = [], workers: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('worker', worker => workers.push(worker.url()))
  page.on('request', request => { if (/\/v1\/(?:generation|tasks)/.test(request.url())) requests.push(request.url()) })
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('E原工程')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await page.getByRole('tab', { name: '生成', exact: true }).click()
  await page.getByText('生成设置 · 执行位置与画面细节', { exact: true }).click()
  await expect(page.getByLabel('参数地图生成位置', { exact: true })).toHaveValue('worker')
  await page.getByRole('group', { name: '生成场景类型' }).getByRole('button', { name: /混合场景/ }).click()
  const mixed = page.getByRole('region', { name: '混合场景生成', exact: true })
  await mixed.getByLabel('混合工程名称', { exact: true }).fill('E林中建筑')
  await mixed.getByLabel('混合建筑房间数量', { exact: true }).fill('2')
  await mixed.getByRole('button', { name: '预览混合场景', exact: true }).click()
  await expect(mixed.getByLabel('混合候选摘要', { exact: true })).toBeVisible({ timeout: 90000 })
  await expect(mixed.getByLabel('混合实际生成结果', { exact: true })).toContainText('2 个房间')
  expect(workers.some(url => /\/worker-[^/]+\.js(?:\?|$)/.test(url))).toBe(true)
  await page.getByRole('tab', { name: '工程', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建空白场景', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: '生成', exact: true }).click()
  // Parameter changes revoke the old private candidate before another preview.
  await mixed.getByLabel('混合建筑房间用途', { exact: true }).fill('驿站卧室')
  await expect(mixed.getByLabel('混合候选摘要', { exact: true })).toHaveCount(0)
  await mixed.getByRole('button', { name: '预览混合场景', exact: true }).click()
  await expect(mixed.getByLabel('混合候选摘要', { exact: true })).toBeVisible({ timeout: 90000 })
  await mixed.getByRole('button', { name: '保存混合场景为新工程', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '混合场景已完整保存并打开' })).toBeVisible({ timeout: 90000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await page.getByRole('tab', { name: '地形', exact: true }).click()
  await page.getByRole('group', { name: '地形任务' }).getByRole('button', { name: /局部重生成/ }).click()
  const local = page.getByRole('region', { name: '受限局部重生成', exact: true })
  await expect(local.getByLabel('局部生成配方').locator('option')).toHaveCount(2)
  const forestRecipe = await local.getByLabel('局部生成配方').locator('option').filter({ hasText: /^森林/ }).getAttribute('value')
  await local.getByLabel('局部生成配方').selectOption(forestRecipe!)
  await expect(local.getByLabel('局部植被覆盖百分比', { exact: true })).toBeEnabled()
  await local.getByLabel('局部植被覆盖百分比', { exact: true }).fill('4')
  await local.getByRole('button', { name: '预览局部重生成', exact: true }).click()
  await expect(local.getByLabel('局部重生成候选摘要', { exact: true })).toBeVisible({ timeout: 90000 })
  await expect(local.getByLabel('局部重生成候选摘要', { exact: true })).toContainText('surfaceRules')
  await local.getByRole('button', { name: '保护并采用局部修改', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '采用局部重生成' })).toBeVisible({ timeout: 90000 })
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await page.getByRole('button', { name: '重做编辑', exact: true }).click()
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 90000 })
  await page.goto('./#home'); await page.reload()
  const home = page.getByTestId('workspace-home')
  await expect(home.locator('.home-project-row').filter({ hasText: 'E原工程' })).toHaveCount(1, { timeout: 90000 })
  const row = home.locator('.home-project-row').filter({ hasText: 'E林中建筑' })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible({ timeout: 90000 })
  await page.getByRole('tab', { name: '地形', exact: true }).click()
  await page.getByRole('group', { name: '地形任务' }).getByRole('button', { name: /局部重生成/ }).click()
  await expect(local.getByLabel('局部生成配方').locator('option')).toHaveCount(2)
  await page.screenshot({ path: info.outputPath('forest-building-cold-open.png') })
  expect(errors).toEqual([]); expect(requests).toEqual([])
  await info.attach('mixed-worker-proof.json', { body: JSON.stringify({ workers, errors, generationHttpRequests: requests }, null, 2), contentType: 'application/json' })
})

test('mixed volcano preview renders a real supported building through the Worker and cancellation preserves the current project', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = [], workers: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('worker', worker => workers.push(worker.url()))
  page.on('request', request => { if (/\/v1\/(?:generation|tasks)/.test(request.url())) requests.push(request.url()) })
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('E火山原工程')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
  await page.getByRole('tab', { name: '生成', exact: true }).click()
  await page.getByRole('group', { name: '生成场景类型' }).getByRole('button', { name: /混合场景/ }).click()
  const mixed = page.getByRole('region', { name: '混合场景生成', exact: true })
  await mixed.getByLabel('混合工程名称', { exact: true }).fill('E火山建筑')
  await mixed.getByLabel('混合场景环境', { exact: true }).selectOption('volcano')
  await mixed.getByRole('button', { name: '预览混合场景', exact: true }).click()
  await expect(mixed.getByLabel('混合候选摘要', { exact: true })).toBeVisible({ timeout: 90000 })
  await expect(mixed.getByLabel('混合实际生成结果', { exact: true })).toContainText('1 个房间')
  await expect(page.getByLabel('材质场景主持人预览', { exact: true })).toBeVisible({ timeout: 30000 })
  await page.screenshot({ path: info.outputPath('volcano-building-preview.png') })
  await mixed.getByRole('button', { name: '取消混合场景', exact: true }).click()
  await expect(mixed.getByLabel('混合候选摘要', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'E火山原工程', exact: true })).toBeVisible()
  expect(workers.some(url => /\/worker-[^/]+\.js(?:\?|$)/.test(url))).toBe(true)
  expect(errors).toEqual([]); expect(requests).toEqual([])
  await info.attach('mixed-worker-proof.json', { body: JSON.stringify({ workers, errors, generationHttpRequests: requests }, null, 2), contentType: 'application/json' })
})

test('running mixed generation can be cancelled from each visible control and ignores its late Worker response', async ({ page }, info) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const gate: GenerationWorkerGate = { hold: false, pending: [] }
    Object.defineProperty(window, '__sceneweaveGenerationWorkerGate', { value: gate })
    const NativeWorker = window.Worker
    let messageDescriptor: PropertyDescriptor | undefined
    for (let prototype: object | null = NativeWorker.prototype; prototype && !messageDescriptor; prototype = Object.getPrototypeOf(prototype)) {
      messageDescriptor = Object.getOwnPropertyDescriptor(prototype, 'onmessage')
    }
    if (!messageDescriptor?.set) throw new Error('Worker.onmessage cannot be controlled in this browser.')
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      writable: true,
      value: new Proxy(NativeWorker, {
        construct(target, args, newTarget) {
          const worker = Reflect.construct(target, args, newTarget) as Worker
          if ((args[1] as WorkerOptions | undefined)?.name !== 'sceneweave-domain-generation') return worker
          let current: typeof worker.onmessage = null
          Object.defineProperty(worker, 'onmessage', {
            configurable: true,
            get: () => current,
            set: (handler: typeof current) => {
              current = handler
              const deliver = handler ? (event: MessageEvent) => {
                if (gate.hold) gate.pending.push(() => handler.call(worker, event))
                else handler.call(worker, event)
              } : null
              messageDescriptor!.set!.call(worker, deliver)
            },
          })
          return worker
        },
      }),
    })
  })
  await page.goto('./#home')
  await page.getByTestId('workspace-home').getByRole('button', { name: '新建场景', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建空白场景', exact: true })
  await dialog.getByLabel('场景名称', { exact: true }).fill('E取消原工程')
  await dialog.getByRole('button', { name: '创建空白场景', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 30000 })
  const backup = async () => {
    const menu = page.locator('.workspace-export-menu')
    await menu.locator('summary').click()
    const downloaded = page.waitForEvent('download')
    await menu.getByRole('button', { name: '备份可编辑工程 · 含秘密', exact: true }).click()
    const filename = await (await downloaded).path()
    if (!filename) throw new Error('Expected a complete project download.')
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    await menu.locator('summary').click()
    const files = unzipSync(new Uint8Array(await readFile(filename)))
    return Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]))
  }
  const original = await backup()
  await page.getByRole('tab', { name: '生成', exact: true }).click()
  await page.getByRole('group', { name: '生成场景类型' }).getByRole('button', { name: /混合场景/ }).click()
  const mixed = page.getByRole('region', { name: '混合场景生成', exact: true })
  const status = page.getByLabel('混合场景候选状态', { exact: true })
  const revision = await page.locator('.workspace-unified').getAttribute('data-revision')
  const gate = () => page.evaluate(() => (window as unknown as WindowWithGenerationWorkerGate).__sceneweaveGenerationWorkerGate.pending.length)

  for (const control of ['panel', 'canvas', 'escape'] as const) {
    await test.step(`cancel from ${control}`, async () => {
      const firstPending = await gate()
      await page.evaluate(() => { (window as unknown as WindowWithGenerationWorkerGate).__sceneweaveGenerationWorkerGate.hold = true })
      await mixed.getByRole('button', { name: '预览混合场景', exact: true }).click()
      await expect(status).toBeVisible()
      await expect(status).toContainText('正在准备混合场景')
      await expect(page.getByRole('alert').filter({ hasText: '已取消混合场景生成' })).toHaveCount(0)
      await page.waitForFunction(index => (window as unknown as WindowWithGenerationWorkerGate).__sceneweaveGenerationWorkerGate.pending.length > index, firstPending)
      if (control === 'panel') await page.screenshot({ path: info.outputPath('mixed-generation-running.png') })

      if (control === 'panel') await mixed.getByRole('button', { name: '取消混合场景', exact: true }).click()
      else if (control === 'canvas') await status.getByRole('button', { name: '取消混合场景预览', exact: true }).click()
      else await page.keyboard.press('Escape')

      await expect(page.getByRole('alert').filter({ hasText: '已取消混合场景生成，当前工程未改变。' })).toBeVisible()
      await expect(status).toHaveCount(0)
      await expect(mixed.getByLabel('混合候选摘要', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'E取消原工程', level: 1, exact: true })).toBeVisible()
      await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', revision ?? '')

      await page.evaluate(index => {
        const workerGate = (window as unknown as WindowWithGenerationWorkerGate).__sceneweaveGenerationWorkerGate
        const deliver = workerGate.pending[index]
        if (!deliver) throw new Error('The held Worker result was lost before release.')
        workerGate.hold = false
        deliver()
      }, firstPending)
      await expect(status).toHaveCount(0)
      await expect(mixed.getByLabel('混合候选摘要', { exact: true })).toHaveCount(0)
      await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', revision ?? '')
      await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
      await expect(page.locator('.asset-save')).toHaveText('本地已保存')
    })
  }
  await page.screenshot({ path: info.outputPath('mixed-generation-cancelled.png') })
  expect(await backup()).toEqual(original)
  expect(errors).toEqual([])
})
