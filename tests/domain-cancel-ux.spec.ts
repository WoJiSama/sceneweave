import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel, placeKeyboardLamp } from './keyboard-ux-helpers'

type Domain = 'interior' | 'forest' | 'volcano' | 'mixed'
type DeliveryFact = { domain: string | null; requestId: string | null; hasResult: boolean; type: string | null; trusted: boolean; delivered: number }
type DomainGate = {
  hold: boolean
  posts: { domain: string | null; requestId: string | null }[]
  pending: { fact: DeliveryFact; deliver: () => void }[]
  terminations: number
  restore: () => void
}

/** Gate only delivery of messages actually calculated by the native domain Worker. */
async function installDomainGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    let messageDescriptor: PropertyDescriptor | undefined
    for (let prototype: object | null = NativeWorker.prototype; prototype && !messageDescriptor; prototype = Object.getPrototypeOf(prototype)) {
      messageDescriptor = Object.getOwnPropertyDescriptor(prototype, 'onmessage')
    }
    if (!messageDescriptor?.set) throw new Error('Native Worker.onmessage cannot be controlled in this browser.')
    const gate: DomainGate = { hold: true, posts: [], pending: [], terminations: 0,
      restore: () => { window.Worker = NativeWorker } }
    Reflect.set(window, '__domainCancelGate', gate)
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker
        if ((args[1] as WorkerOptions | undefined)?.name !== 'sceneweave-domain-generation') return worker
        const nativePost = worker.postMessage.bind(worker), nativeTerminate = worker.terminate.bind(worker)
        Object.defineProperty(worker, 'postMessage', { configurable: true, value: (...postArgs: Parameters<Worker['postMessage']>) => {
          const message = postArgs[0] as { domain?: unknown; requestId?: unknown }
          gate.posts.push({ domain: typeof message?.domain === 'string' ? message.domain : null,
            requestId: typeof message?.requestId === 'string' ? message.requestId : null })
          nativePost(...postArgs)
        } })
        Object.defineProperty(worker, 'terminate', { configurable: true, value: () => {
          gate.terminations++; nativeTerminate()
        } })
        let current: typeof worker.onmessage = null
        Object.defineProperty(worker, 'onmessage', {
          configurable: true, get: () => current,
          set: (handler: typeof current) => {
            current = handler
            const receive = handler ? (event: MessageEvent<unknown>) => {
              if (!gate.hold) { handler.call(worker, event); return }
              const data = event.data as Record<string, unknown> | null
              const fact: DeliveryFact = {
                domain: typeof data?.domain === 'string' ? data.domain : null,
                requestId: typeof data?.requestId === 'string' ? data.requestId : null,
                hasResult: !!data && Object.hasOwn(data, 'result'),
                type: typeof data?.type === 'string' ? data.type : null,
                trusted: event.isTrusted, delivered: 0,
              }
              gate.pending.push({ fact, deliver: () => { fact.delivered++; handler.call(worker, event) } })
            } : null
            messageDescriptor!.set!.call(worker, receive)
          },
        })
        return worker
      },
    })
  })
}

async function gateFacts(page: Page) {
  return page.evaluate(() => {
    const gate = Reflect.get(window, '__domainCancelGate') as DomainGate
    return { hold: gate.hold, posts: gate.posts, pending: gate.pending.map(item => item.fact), terminations: gate.terminations }
  })
}

async function deliver(page: Page, index: number): Promise<void> {
  await page.evaluate(value => {
    const gate = Reflect.get(window, '__domainCancelGate') as DomainGate
    const pending = gate.pending[value]
    if (!pending) throw new Error('A real domain Worker result was not captured before delivery.')
    pending.deliver()
  }, index)
}

async function closeDrawers(page: Page): Promise<void> {
  if (await page.getByTestId('workspace-layout').getAttribute('data-narrow') !== 'true') return
  for (const [id, name] of [['resources', '资源面板'], ['inspector', '属性面板'], ['navigation', '场景导航']] as const) {
    const panel = page.getByTestId(`workspace-${id}`)
    if (await panel.getAttribute('data-open') !== 'true') continue
    await panel.getByRole('button', { name: `关闭${name}`, exact: true }).click()
    await expect(panel).toHaveAttribute('data-open', 'false')
  }
}

async function coldOpen(page: Page, id: string): Promise<void> {
  await page.goto('./#home'); await page.reload()
  const row = page.getByTestId('workspace-home').locator(`[data-project-key="native:${id}"]`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  await closeDrawers(page)
}

const scenarios = [
  { domain: 'interior', task: '室内布局', panel: '室内布局生成', preview: '预览室内布局', candidate: '室内布局候选摘要', status: '室内布局候选状态', cancel: '取消室内布局', seed: '室内生成种子', seedValue: 'interior-1', size: { width: 1512, height: 982 } },
  { domain: 'forest', task: '森林与营地', panel: '森林与营地生成', preview: '预览森林与营地', candidate: '森林与营地候选摘要', status: '森林与营地候选状态', cancel: '取消森林与营地', seed: '森林生成种子', seedValue: 'forest-1', size: { width: 1512, height: 982 } },
  { domain: 'volcano', task: '火山', panel: '火山生成', preview: '预览火山', candidate: '火山候选摘要', status: '火山候选状态', cancel: '取消火山', seed: '火山生成种子', seedValue: 'volcano-1', size: { width: 1512, height: 982 } },
  { domain: 'mixed', task: '混合场景', panel: '混合场景生成', preview: '预览混合场景', candidate: '混合候选摘要', status: '混合场景候选状态', cancel: '取消混合场景', seed: '混合生成种子', seedValue: 'mixed-1', size: { width: 390, height: 844 } },
] as const satisfies readonly { domain: Domain; task: string; panel: string; preview: string; candidate: string; status: string; cancel: string; seed: string; seedValue: string; size: { width: number; height: number } }[]

for (const scenario of scenarios) test(`production ${scenario.domain} running Escape ignores a real late Worker result and explicitly retries at ${scenario.size.width}px`, async ({ page, browser }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = [], networkGenerationRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/v1\/(?:generation|tasks)(?:[/?]|$)/.test(request.url())) networkGenerationRequests.push(request.url()) })
  await page.setViewportSize({ width: 1512, height: 982 })
  await createKeyboardProject(page, `生成取消原工程 ${scenario.domain}`)
  await placeKeyboardLamp(page)
  const original = await keyboardProjectBackup(page, info.outputPath('domain-original.sceneweave'))
  expect(Object.keys(original.document.props)).toHaveLength(1)
  // Reopen through the normal persisted entry so the baseline has an empty undo stack.
  await coldOpen(page, original.document.sceneId)
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
  await page.setViewportSize(scenario.size)
  await closeDrawers(page)
  await installDomainGate(page)
  const resources = await openKeyboardPanel(page, 'resources')
  await resources.getByRole('tab', { name: '生成', exact: true }).click()
  await resources.getByRole('group', { name: '生成场景类型', exact: true }).getByRole('button', { name: new RegExp(`^${scenario.task}`) }).click()
  const panel = page.getByRole('region', { name: scenario.panel, exact: true })
  const status = page.getByRole('status', { name: scenario.status, exact: true })
  const candidate = panel.getByLabel(scenario.candidate, { exact: true })
  const revision = page.locator('.workspace-unified')
  try {
    await expect(panel.getByLabel(scenario.seed, { exact: true })).toHaveValue(scenario.seedValue)
    await panel.getByRole('button', { name: scenario.preview, exact: true }).click()
    await expect(status).toContainText(`正在准备${scenario.task}`)
    await page.waitForFunction(() => (Reflect.get(window, '__domainCancelGate') as DomainGate).pending.length === 1, undefined, { timeout: 90_000 })
    const calculated = await gateFacts(page)
    expect(calculated.posts).toHaveLength(1)
    expect(calculated.posts[0].domain).toBe(scenario.domain)
    expect(calculated.pending[0]).toMatchObject({ domain: scenario.domain, hasResult: true, type: null, trusted: true, delivered: 0 })
    await closeDrawers(page)
    const viewport = page.getByRole('group', { name: '地图视口', exact: true })
    await viewport.focus()
    await page.screenshot({ path: info.outputPath('domain-running.png') })
    await page.keyboard.press('Escape')
    await expect(status).toHaveCount(0)
    await expect(candidate).toHaveCount(0)
    await expect(revision).toHaveAttribute('data-revision', String(original.document.revision))
    await expect(page.getByRole('heading', { name: original.document.title, level: 1, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
    expect((await gateFacts(page)).terminations).toBe(1)
    await keyboardWorkspaceSaved(page)
    expect((await keyboardProjectBackup(page, info.outputPath('domain-escaped.sceneweave'))).hashes).toEqual(original.hashes)
    // No subsequent request is made until the explicit preview button below.
    expect((await gateFacts(page)).posts).toHaveLength(1)

    await openKeyboardPanel(page, 'resources')
    await expect(panel.getByLabel(scenario.seed, { exact: true })).toHaveValue(scenario.seedValue)
    await panel.getByRole('button', { name: scenario.preview, exact: true }).click()
    await expect(status).toContainText(`正在准备${scenario.task}`)
    await page.waitForFunction(() => (Reflect.get(window, '__domainCancelGate') as DomainGate).pending.length === 2, undefined, { timeout: 90_000 })
    const second = await gateFacts(page)
    expect(second.posts).toHaveLength(2)
    expect(second.posts[1].domain).toBe(scenario.domain)
    expect(second.posts[1].requestId).not.toBe(second.posts[0].requestId)
    expect(second.pending[1]).toMatchObject({ domain: scenario.domain, hasResult: true, trusted: true, delivered: 0 })

    // Deliver the old, fully calculated native response while the new request is
    // active. The captured client callback must reject it without replacing UI.
    await deliver(page, 0)
    await expect(status).toContainText(`正在准备${scenario.task}`)
    await expect(candidate).toHaveCount(0)
    await expect(revision).toHaveAttribute('data-revision', String(original.document.revision))
    expect((await gateFacts(page)).terminations).toBe(1)
    await deliver(page, 1)
    await expect(candidate).toBeVisible({ timeout: 90_000 })
    await expect(status).toContainText('候选')
    await expect(status).not.toContainText('正在准备')
    await expect(panel.locator('.asset-error')).toHaveCount(0)
    await expect(revision).toHaveAttribute('data-revision', String(original.document.revision))
    expect((await gateFacts(page)).terminations).toBe(2)
    await candidate.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('domain-retry-candidate.png') })
    const candidateSemantics = await candidate.ariaSnapshot()
    await panel.getByRole('button', { name: scenario.cancel, exact: true }).click()
    await expect(candidate).toHaveCount(0)
    await expect(status).toHaveCount(0)
    await closeDrawers(page)
    await keyboardWorkspaceSaved(page)
    await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeDisabled()
    expect((await keyboardProjectBackup(page, info.outputPath('domain-retry-cancelled.sceneweave'))).hashes).toEqual(original.hashes)
    const finalGateFacts = await gateFacts(page)
    expect(finalGateFacts.posts).toHaveLength(2)
    expect(finalGateFacts.pending.map(item => item.delivered)).toEqual([1, 1])
    expect(networkGenerationRequests).toEqual([])
    await coldOpen(page, original.document.sceneId)
    expect((await keyboardProjectBackup(page, info.outputPath('domain-cold.sceneweave'))).hashes).toEqual(original.hashes)
    expect(errors).toEqual([])
    await writeFile(info.outputPath('domain-cancel-facts.json'), JSON.stringify({ scenario, browserVersion: browser.version(), gate: finalGateFacts,
      candidateSemantics, originalSceneId: original.document.sceneId, originalRevision: original.document.revision,
      originalHashes: original.hashes, networkGenerationRequests, errors,
      method: 'Native domain Worker executes normally; hold and replay only its actual MessageEvent callback, with original unmodified payload',
      excluded: ['server transport', 'server cancel propagation', 'real model calls', 'successful adoption or generation failure matrix', 'all input and focus combinations', 'visual P3'] }, null, 2))
  } finally {
    await page.evaluate(() => (Reflect.get(window, '__domainCancelGate') as DomainGate | undefined)?.restore())
  }
})
