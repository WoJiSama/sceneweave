import { expect, test, type Page } from '@playwright/test'
import { createKeyboardProject, keyboardProjectBackup, keyboardWorkspaceSaved, openKeyboardPanel, placeKeyboardLamp, selectKeyboardProp } from './keyboard-ux-helpers'

async function storedState(page: Page, owner: string) {
  return page.evaluate(async owner => {
    const names = (await indexedDB.databases()).filter(row => /^sceneweave-projects-dev-v1(?:-[a-f0-9]{64})?$/.test(row.name ?? ''))
    if (names.length !== 1) throw new Error('Expected exactly one test-owned project database')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(names[0].name!)
      request.onupgradeneeded = () => { request.transaction!.abort(); reject(new Error('Must not create test data during inspection')) }
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<{ revision: number; versions: number; blocks: number; epoch: number }>((resolve, reject) => {
        const tx = db.transaction(['projects', 'historyVersions', 'projectContentBlocks', 'storageState'], 'readonly')
        const current = tx.objectStore('projects').get(owner), versions = tx.objectStore('historyVersions').count()
        const blocks = tx.objectStore('projectContentBlocks').count(), epoch = tx.objectStore('storageState').get('epoch')
        tx.oncomplete = () => resolve({ revision: current.result.revision, versions: versions.result, blocks: blocks.result, epoch: epoch.result.epoch })
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }, owner)
}

for (const fault of ['native-abort', 'unknown-result', 'pagehide'] as const) test(`production history audit ${fault} rolls back and releases its actual worker`, async ({ page }, info) => {
  await createKeyboardProject(page, `历史后台故障 ${fault}`)
  await placeKeyboardLamp(page)
  const baseline = await keyboardProjectBackup(page, info.outputPath('baseline.sceneweave'))
  const owner = baseline.document.sceneId, [prop] = Object.keys(baseline.document.props), before = await storedState(page, owner)
  await page.addInitScript(fault => {
    const NativeWorker = Worker, transact = IDBDatabase.prototype.transaction
    let abortFinalWrite = false
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const tx = transact.apply(this, args)
      if (abortFinalWrite && args[1] === 'readwrite' && tx.objectStoreNames.contains('historyVersions')) {
        abortFinalWrite = false
        setTimeout(() => { try { tx.abort() } catch { /* the assertion below detects a missed abort */ } }, 0)
      }
      return tx
    }
    Reflect.set(window, '__historyFaultStarts', 0)
    Reflect.set(window, '__historyFaultTerminations', 0)
    window.Worker = class extends NativeWorker {
      private readonly history: boolean
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.history = String(url).includes('history-audit-worker')
        if (this.history) Reflect.set(window, '__historyFaultStarts', Reflect.get(window, '__historyFaultStarts') + 1)
      }
      override postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
        if (!this.history) { super.postMessage(message, transferOrOptions as StructuredSerializeOptions); return }
        if (fault === 'native-abort') {
          // Preflight now has no active native transaction. Let the real
          // worker complete, then abort the final byte-confirmation write tx.
          abortFinalWrite = true
          super.postMessage(message, transferOrOptions as StructuredSerializeOptions)
          return
        }
        setTimeout(() => {
          if (fault === 'unknown-result') this.dispatchEvent(new MessageEvent('message', { data: { ok: true, documentBytes: -1 } }))
          if (fault === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide'))
        }, 30)
      }
      override terminate(): void {
        if (this.history) Reflect.set(window, '__historyFaultTerminations', Reflect.get(window, '__historyFaultTerminations') + 1)
        super.terminate()
      }
    }
  }, fault)
  await page.goto('./?history-audit-fault=1#home')
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${owner}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page); await selectKeyboardProp(page, prop)
  const rotation = (await openKeyboardPanel(page, 'inspector')).getByLabel('物件旋转', { exact: true })
  await rotation.fill('15'); await rotation.press('Tab')
  await expect(page.locator('.asset-save')).toHaveText('保存失败', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__historyFaultStarts'))).toBe(1)
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__historyFaultTerminations'))).toBe(1)
  expect(await storedState(page, owner)).toEqual(before)
})

test('production preflight permits an independent native write transaction before final confirmation', async ({ page }, info) => {
  await createKeyboardProject(page, '后台核账不占写锁')
  await placeKeyboardLamp(page)
  const baseline = await keyboardProjectBackup(page, info.outputPath('baseline.sceneweave'))
  const owner = baseline.document.sceneId, [prop] = Object.keys(baseline.document.props), before = await storedState(page, owner)
  await page.addInitScript(() => {
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      private readonly history: boolean
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.history = String(url).includes('history-audit-worker') }
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
        if (this.history) {
          Reflect.set(window, '__releaseHistoryPreflight', () => super.postMessage(message, options as StructuredSerializeOptions))
          return
        }
        super.postMessage(message, options as StructuredSerializeOptions)
      }
    }
  })
  await page.goto('./?history-audit-lock=1#home')
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${owner}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page); await selectKeyboardProp(page, prop)
  const rotation = (await openKeyboardPanel(page, 'inspector')).getByLabel('物件旋转', { exact: true })
  await rotation.fill('15'); await rotation.press('Tab')
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, '__releaseHistoryPreflight'))).toBe('function')
  const probe = await page.evaluate(async owner => {
    const name = (await indexedDB.databases()).find(row => /^sceneweave-projects-dev-v1(?:-[a-f0-9]{64})?$/.test(row.name ?? ''))!.name!
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    try {
      return await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(['projects'], 'readwrite'), request = tx.objectStore('projects').get(owner)
        tx.oncomplete = () => resolve(request.result.revision); tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }, owner)
  expect(probe).toBe(before.revision)
  expect((await storedState(page, owner)).versions).toBe(before.versions)
  await page.evaluate(() => Reflect.get(window, '__releaseHistoryPreflight')())
  await keyboardWorkspaceSaved(page)
  const after = await storedState(page, owner)
  expect(after.revision).toBe(before.revision + 1); expect(after.versions).toBe(before.versions + 1)
})
