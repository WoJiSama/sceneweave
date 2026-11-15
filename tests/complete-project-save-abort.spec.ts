// Preserved full works, ordinary UI and a late native IDB abort in test-owned pages.
// Read-only native snapshots hash actual bytes; no application modules or record edits.
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, selectKeyboardProp } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers, openWorkspaceModule } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

type Backup = Awaited<ReturnType<typeof keyboardProjectBackup>>
type Input = { input: string; target: string; props: number; recovery: 'retry' | 'copy' }
const inputs: Record<string, Input> = process.env.SCENEWEAVE_SAVE_ABORT_CASES
  ? JSON.parse(readFileSync(process.env.SCENEWEAVE_SAVE_ABORT_CASES, 'utf8')) : {}
const { PNG } = createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const content = (document: Backup['document']) => {
  const { revision: _revision, updatedAt: _updated, ...rest } = document
  return rest
}
const copyContent = (document: Backup['document']) => {
  const { sceneId: _scene, createdAt: _created, ...rest } = content(document)
  return rest
}
const moved = (document: Backup['document'], id: string, delta: number) => ({ ...document,
  props: { ...document.props, [id]: { ...document.props[id], positionMm: { ...document.props[id].positionMm, x: document.props[id].positionMm.x + delta } } } })

async function move(page: Page, id: string, xMm: number) {
  await selectKeyboardProp(page, id)
  const field = (await openKeyboardPanel(page, 'inspector')).getByLabel('物件 X', { exact: true })
  await field.fill(String(xMm / 1000)); await field.press('Tab')
  await closeWorkspaceDrawers(page)
}
async function coldOpen(page: Page, id: string) {
  await page.goto('./#home'); await page.reload()
  await page.getByTestId('workspace-home').locator(`[data-project-key="native:${id}"]`).getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page); await closeWorkspaceDrawers(page)
}
async function history(page: Page) {
  const panel = (await openWorkspaceModule(page, '历史')).getByRole('region', { name: '命名历史', exact: true })
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  await expect(panel.getByLabel('完整保存版本', { exact: true })).toBeEnabled()
  return panel
}
async function failed(page: Page) {
  await expect(page.locator('.asset-save')).toHaveText('保存失败')
  const recovery = page.getByRole('alert', { name: '保存恢复选项', exact: true })
  await expect(recovery).toContainText('当前编辑仍保留在此页面')
  await expect(recovery.getByRole('button', { name: '重试保存', exact: true })).toBeEnabled()
  await expect(page.locator('.asset-busy')).toHaveCount(0)
  return recovery
}

/** Abort only after an actual ready-head native write succeeds, after prior writes. */
async function installAbort(page: Page) {
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add, put = IDBObjectStore.prototype.put
    const state = { enabled: true, aborted: 0, transactions: [] as { stores: string[]; success: { store: string; method: string; owner: string | null; revision: number | null }[]; terminal: string }[] }
    const tracked = new WeakMap<IDBTransaction, typeof state.transactions[number]>()
    const observe = (store: IDBObjectStore, method: string, value: unknown, request: IDBRequest) => {
      if (!state.enabled || !/^sceneweave-projects-dev-v1(?:-[a-f0-9]{64})?$/.test(store.transaction.db.name)) return request
      const transaction = store.transaction
      let facts = tracked.get(transaction)
      if (!facts) {
        facts = { stores: Array.from(transaction.objectStoreNames), success: [], terminal: 'active' }
        tracked.set(transaction, facts); state.transactions.push(facts)
        transaction.addEventListener('abort', () => { facts!.terminal = 'abort' })
        transaction.addEventListener('complete', () => { facts!.terminal = 'complete' })
      }
      const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      request.addEventListener('success', () => {
        facts!.success.push({ store: store.name, method, owner: typeof row.ownerSceneId === 'string' ? row.ownerSceneId : typeof row.sceneId === 'string' ? row.sceneId : null,
          revision: typeof row.revision === 'number' ? row.revision : typeof row.savedRevision === 'number' ? row.savedRevision : null })
        if (state.enabled && store.name === 'historyHeads' && row.status === 'ready') {
          state.aborted++; transaction.abort()
        }
      })
      return request
    }
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      return observe(this, 'add', value, key === undefined ? add.call(this, value) : add.call(this, value, key))
    }
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      return observe(this, 'put', value, key === undefined ? put.call(this, value) : put.call(this, value, key))
    }
    Reflect.set(window, '__completeSaveAbort', { state, restore: () => {
      state.enabled = false; IDBObjectStore.prototype.add = add; IDBObjectStore.prototype.put = put
    } })
  })
}
const faultFacts = (page: Page) => page.evaluate(() => Reflect.get(window, '__completeSaveAbort').state as {
  enabled: boolean; aborted: number; transactions: { stores: string[]; success: { store: string; method: string; owner: string | null; revision: number | null }[]; terminal: string }[]
})
const clearAbort = (page: Page) => page.evaluate(() => Reflect.get(window, '__completeSaveAbort')?.restore())

/** Native readonly transaction, then independent hashes of actual rows and binary bytes. */
async function nativeSnapshot(page: Page) {
  return page.evaluate(async () => {
    const available = (await indexedDB.databases()).filter(row => /^sceneweave-projects-dev-v1(?:-[a-f0-9]{64})?$/.test(row.name ?? ''))
    if (available.length !== 1 || !available[0].name) throw Error('Expected the sole test-owned current database')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(available[0].name!)
      request.onupgradeneeded = () => { request.transaction!.abort(); reject(Error('Readonly inspection must not create a database')) }
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      const names = Array.from(db.objectStoreNames).sort()
      const rows = await new Promise<Record<string, { keys: IDBValidKey[]; values: any[] }>>((resolve, reject) => {
        const result: Record<string, { keys: IDBValidKey[]; values: any[] }> = {}, transaction = db.transaction(names, 'readonly')
        transaction.oncomplete = () => resolve(result); transaction.onabort = () => reject(transaction.error ?? Error('Readonly snapshot aborted'))
        for (const name of names) {
          result[name] = { keys: [], values: [] }
          const keys = transaction.objectStore(name).getAllKeys(), values = transaction.objectStore(name).getAll()
          keys.onsuccess = () => { result[name].keys = keys.result }
          values.onsuccess = () => { result[name].values = values.result }
        }
      })
      const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(value => value.toString(16).padStart(2, '0')).join('')
      const binary = async (value: any): Promise<any> => {
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
          const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          return { nativeBinaryType: value.constructor.name, byteLength: bytes.length, actualSha256: await hash(bytes) }
        }
        if (value instanceof Blob) { const bytes = new Uint8Array(await value.arrayBuffer()); return { nativeBlobType: value.type, byteLength: bytes.length, actualSha256: await hash(bytes) } }
        if (Array.isArray(value)) return Promise.all(value.map(binary))
        if (value && typeof value === 'object') {
          const result: Record<string, unknown> = {}
          for (const key of Object.keys(value).sort()) result[key] = await binary(value[key])
          return result
        }
        return value
      }
      const stores: Record<string, { count: number; sha256: string }> = {}, owners: Record<string, Record<string, string[]>> = {}
      for (const name of names) {
        const actual = []
        for (let i = 0; i < rows[name].keys.length; i++) {
          const row = rows[name].values[i], encoded = JSON.stringify({ key: await binary(rows[name].keys[i]), value: await binary(row) })
          const digest = await hash(new TextEncoder().encode(encoded)); actual.push(digest)
          const owner = row?.ownerSceneId ?? row?.sceneId
          if (typeof owner === 'string') { owners[owner] ??= {}; (owners[owner][name] ??= []).push(digest) }
        }
        stores[name] = { count: actual.length, sha256: await hash(new TextEncoder().encode(JSON.stringify(actual))) }
      }
      const revisions: Record<string, number[]> = {}
      for (const row of rows.historyVersions.values) (revisions[row.ownerSceneId] ??= []).push(row.revision)
      for (const values of Object.values(revisions)) values.sort((a, b) => a - b)
      return { database: db.name, version: db.version, stores, owners, revisions }
    } finally { db.close() }
  })
}

for (const [key, width] of [['ruins', 1512], ['coast', 390]] as const) test(`complete ${key} project rolls back a late native save abort and recovers at ${width}px`, async ({ page, context, browser }, info) => {
  test.skip(!inputs[key], 'Requires explicit preserved full-project inputs')
  test.setTimeout(300000)
  const input = inputs[key], events: object[] = [], snapshots: Record<string, Awaited<ReturnType<typeof nativeSnapshot>>> = {}, images: Record<string, unknown> = {}, errors: string[] = []
  let stage = 'import', injected: Awaited<ReturnType<typeof faultFacts>> | null = null
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width, height: width === 390 ? 844 : 982 })
  const backup = async (target: Page, label: string) => {
    await closeWorkspaceDrawers(target)
    const result = await keyboardProjectBackup(target, info.outputPath(label + '.sceneweave'))
    events.push({ label, sceneId: result.document.sceneId, revision: result.document.revision, hashes: result.hashes }); return result
  }
  const maps = async (target: Page, label: string) => {
    await closeWorkspaceDrawers(target)
    const result: Record<string, { width: number; height: number; rgbaSha256: string }> = {}
    for (const audience of ['gm', 'player'] as const) {
      const pending = target.waitForEvent('download'); await (await mapExportButton(target, audience)).click()
      const file = info.outputPath(label + '-' + audience + '.png'); await (await pending).saveAs(file)
      await expect(target.locator('.asset-busy')).toHaveCount(0); await target.locator('.workspace-export-menu > summary').click()
      const image = PNG.sync.read(await readFile(file)); expect(Math.max(image.width, image.height)).toBe(4096)
      result[audience] = { width: image.width, height: image.height, rgbaSha256: sha(image.data) }
    }
    images[label] = result; return result
  }
  const sameResources = (actual: Backup, baseline: Backup) => {
    expect(actual.identity).toEqual(baseline.identity); expect(actual.appearance).toEqual(baseline.appearance)
    expect(keyboardResourceHashes(actual.hashes)).toEqual(keyboardResourceHashes(baseline.hashes))
  }
  try {
    const response = await page.goto('./#home'); expect(response?.ok()).toBe(true)
    expect(await response!.text()).not.toContain('/@vite/client')
    await page.getByTestId('native-project-file').setInputFiles(input.input); await keyboardWorkspaceSaved(page)
    const initial = await backup(page, 'initial'); expect(Object.keys(initial.document.props)).toHaveLength(input.props)
    await move(page, input.target, initial.document.props[input.target].positionMm.x + 25); await keyboardWorkspaceSaved(page)
    const baseline = await backup(page, 'baseline')
    const panel = await history(page)
    await panel.getByRole('button', { name: '新建命名快照', exact: true }).click()
    await panel.getByLabel('命名快照名称', { exact: true }).fill('事务中断前保全')
    await panel.getByRole('button', { name: '保存快照', exact: true }).click()
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    await expect((await history(page)).getByRole('button', { name: '查看快照 事务中断前保全', exact: true })).toBeVisible()
    await closeWorkspaceDrawers(page)
    snapshots.before = await nativeSnapshot(page)
    expect(snapshots.before.revisions[baseline.document.sceneId]).toEqual([0, 1])
    const baselineMaps = await maps(page, 'baseline')

    stage = 'late-abort'
    await installAbort(page)
    await move(page, input.target, baseline.document.props[input.target].positionMm.x + 50)
    let recovery = await failed(page)
    await expect.poll(async () => (await faultFacts(page)).aborted).toBe(1)
    const memory = await backup(page, 'memory')
    expect(memory.document.revision).toBe(2); expect(content(memory.document)).toEqual(content(moved(baseline.document, input.target, 50)))
    sameResources(memory, baseline)
    const direct = page.waitForEvent('download'); await recovery.getByRole('button', { name: '下载当前工程备份', exact: true }).click()
    const directPath = info.outputPath('direct-recovery.sceneweave'); await (await direct).saveAs(directPath)
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    expect(Object.fromEntries(Object.entries(unzipSync(await readFile(directPath))).map(([name, bytes]) => [name, sha(bytes)]))).toEqual(memory.hashes)
    snapshots.afterAbort = await nativeSnapshot(page); expect(snapshots.afterAbort).toEqual(snapshots.before)
    await page.waitForTimeout(400); expect((await faultFacts(page)).aborted).toBe(1)

    stage = 'persistent-failure'
    await recovery.getByRole('button', { name: '重试保存', exact: true }).click(); await failed(page)
    await expect.poll(async () => (await faultFacts(page)).aborted).toBe(2)
    expect((await backup(page, 'retry-failed-memory')).hashes).toEqual(memory.hashes)
    await recovery.getByRole('button', { name: '另存副本', exact: true }).click(); await failed(page)
    await expect.poll(async () => (await faultFacts(page)).aborted).toBe(3)
    expect((await backup(page, 'copy-failed-memory')).hashes).toEqual(memory.hashes)
    snapshots.afterRetryAndCopy = await nativeSnapshot(page); expect(snapshots.afterRetryAndCopy).toEqual(snapshots.before)
    const observer = await context.newPage(); observer.on('pageerror', error => errors.push(error.message))
    await observer.setViewportSize({ width, height: width === 390 ? 844 : 982 })
    await coldOpen(observer, baseline.document.sceneId)
    expect((await backup(observer, 'saved-during-failure')).hashes).toEqual(baseline.hashes)

    stage = 'memory-continuation'
    await move(page, input.target, memory.document.props[input.target].positionMm.x + 25); await failed(page)
    const continued = await backup(page, 'memory-continued'); expect(continued.document.revision).toBe(3)
    expect(content(continued.document)).toEqual(content(moved(memory.document, input.target, 25)))
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await failed(page)
    const undone = await backup(page, 'memory-undone'); expect(undone.document.revision).toBe(4)
    expect(content(undone.document)).toEqual(content(memory.document))
    await page.getByRole('button', { name: '重做编辑', exact: true }).click(); recovery = await failed(page)
    const redone = await backup(page, 'memory-redone'); expect(redone.document.revision).toBe(5)
    expect(content(redone.document)).toEqual(content(continued.document)); sameResources(redone, baseline)
    snapshots.afterLocalEdits = await nativeSnapshot(page); expect(snapshots.afterLocalEdits).toEqual(snapshots.before)
    injected = await faultFacts(page); expect(injected.aborted).toBe(3)
    expect(injected.transactions).toHaveLength(3)
    for (const transaction of injected.transactions) {
      expect(transaction.terminal).toBe('abort')
      for (const name of ['projectContentBlocks', 'projects', 'resourceBindings', 'historyVersions', 'historyHeads']) expect(transaction.success.some(hit => hit.store === name)).toBe(true)
    }
    const memoryMaps = await maps(page, 'memory'); expect(memoryMaps.gm.rgbaSha256).not.toBe(baselineMaps.gm.rgbaSha256)
    await page.screenshot({ path: info.outputPath('save-aborted.png') })

    stage = 'recovery'
    await clearAbort(page)
    await recovery.getByRole('button', { name: input.recovery === 'retry' ? '重试保存' : '另存副本', exact: true }).click()
    await keyboardWorkspaceSaved(page)
    const recovered = await backup(page, 'recovered'); sameResources(recovered, redone)
    if (input.recovery === 'retry') {
      expect(recovered.hashes).toEqual(redone.hashes)
    } else {
      expect(recovered.document.sceneId).not.toBe(baseline.document.sceneId); expect(recovered.document.revision).toBe(0)
      expect(copyContent(recovered.document)).toEqual(copyContent({ ...redone.document, title: redone.document.title + ' · 副本' }))
    }
    expect(await maps(page, 'recovered')).toEqual(memoryMaps)
    snapshots.recovered = await nativeSnapshot(page)
    expect(snapshots.recovered.revisions[baseline.document.sceneId]).toEqual(input.recovery === 'retry' ? [0, 1, 5] : [0, 1])
    if (input.recovery === 'copy') {
      expect(snapshots.recovered.owners[baseline.document.sceneId]).toEqual(snapshots.before.owners[baseline.document.sceneId])
      expect(snapshots.recovered.revisions[recovered.document.sceneId]).toEqual([0])
    }
    await coldOpen(observer, baseline.document.sceneId)
    expect((await backup(observer, 'original-after-recovery')).hashes).toEqual(input.recovery === 'retry' ? recovered.hashes : baseline.hashes)
    await expect((await history(observer)).getByRole('button', { name: '查看快照 事务中断前保全', exact: true })).toBeVisible()
    await coldOpen(page, recovered.document.sceneId)
    expect((await backup(page, 'recovered-cold')).hashes).toEqual(recovered.hashes)
    expect(await maps(page, 'cold')).toEqual(memoryMaps)
    await move(page, input.target, recovered.document.props[input.target].positionMm.x + 25); await keyboardWorkspaceSaved(page)
    const next = await backup(page, 'recovered-continued')
    expect(next.document.revision).toBe(recovered.document.revision + 1)
    expect(content(next.document)).toEqual(content(moved(recovered.document, input.target, 25)))
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click(); await keyboardWorkspaceSaved(page)
    const final = await backup(page, 'recovered-undone'); expect(final.document.revision).toBe(next.document.revision + 1)
    expect(content(final.document)).toEqual(content(recovered.document)); sameResources(final, recovered)
    await coldOpen(observer, recovered.document.sceneId)
    expect((await backup(observer, 'final-cold')).hashes).toEqual(final.hashes)
    snapshots.final = await nativeSnapshot(observer)
    await observer.goto('./#home'); await observer.reload()
    await expect(observer.getByTestId('workspace-home').locator('[data-project-key^="native:"]')).toHaveCount(input.recovery === 'retry' ? 1 : 2)
    expect(errors).toEqual([]); stage = 'complete'
  } finally {
    await clearAbort(page)
    await writeFile(info.outputPath('facts.json'), JSON.stringify({ key, width, stage, recovery: input.recovery, browserVersion: browser.version(),
      method: 'Late native historyHeads ready-write success abort; readonly actual row/byte hashes; ordinary UI edits, backups and recovery',
      events, snapshots, injected, images, errors }, null, 2) + '\n')
  }
})
