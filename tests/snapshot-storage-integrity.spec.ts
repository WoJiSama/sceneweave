// Normal production UI with real native IndexedDB faults in a fresh, test-owned context.
import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, openKeyboardPanel, placeKeyboardLamp, selectKeyboardProp } from './keyboard-ux-helpers'

type Fault = 'corrupt' | 'missing'
type BlockState = {
  database: string; databaseVersion: number; projectCount: number; sceneId: string; revision: number; status: string
  currentContentHash: string; manifestContentHash: string; manifestFormat: string; manifestVersion: number
  rowSha256: string; fieldPath: string[]; blockHash: string; referenceByteLength: number
  present: boolean; declaredHash: string | null; actualHash: string | null; actualByteLength: number | null
}
type NativeReadHit = { database: string; store: string; key: string; mode: IDBTransactionMode }

/** Enumerate only this isolated context, then mutate one block referenced by its sole current project. */
async function contentBlock(page: Page, sceneId: string, propId: string, fault: Fault | null = null): Promise<{ fault: Fault | null; before: BlockState; after: BlockState }> {
  return page.evaluate(async ({ owner, entity, mutation }) => {
    type Manifest = { format: string; version: number; contentHash: string; fields: { path: string[]; blocks: { sha256: string; byteLength: number }[] }[] }
    type Row = { sceneId: string; revision: number; status: string; contentHash: string; project: Manifest }
    type Block = { sha256: string; bytes: Uint8Array }
    const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const databases = (await indexedDB.databases()).filter(row => /^sceneweave-projects-dev-v1(?:-[a-f0-9]{64})?$/.test(row.name ?? ''))
    if (databases.length !== 1 || !databases[0].name) throw new Error('Expected exactly one test-owned current project database.')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databases[0].name!)
      request.onupgradeneeded = () => { request.transaction!.abort(); reject(new Error('Test inspection must never create a database.')) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Test-owned native database is blocked.'))
    })
    try {
      const read = () => new Promise<{ row: Row; block: Block | undefined; count: number; ref: { sha256: string; byteLength: number } }>((resolve, reject) => {
        const transaction = db.transaction(['projects', 'projectContentBlocks'], 'readonly')
        let row: Row, block: Block | undefined, count = -1, ref: { sha256: string; byteLength: number }, failure: unknown
        const fail = (error: unknown) => { failure = error; transaction.abort() }
        transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Native integrity read aborted.'))
        transaction.oncomplete = () => resolve({ row, block, count, ref })
        const counted = transaction.objectStore('projects').count(); counted.onsuccess = () => { count = counted.result }
        const current = transaction.objectStore('projects').get(owner)
        current.onsuccess = () => {
          try {
            row = current.result as Row
            if (!row || row.sceneId !== owner || row.status !== 'ready' || row.project?.format !== 'sceneweave-project-content-blocks' || row.project.version !== 1) throw new Error('Expected the test project current content-block manifest.')
            const field = row.project.fields.find(field => JSON.stringify(field.path) === JSON.stringify(['document', 'props']))
            if (!field || field.blocks.length !== 1) throw new Error('Expected one actual props block for the one-prop test project.')
            ref = field.blocks[0]
            const request = transaction.objectStore('projectContentBlocks').get(ref.sha256)
            request.onsuccess = () => { block = request.result as Block | undefined }
          } catch (error) { fail(error) }
        }
      })
      const state = async (value: Awaited<ReturnType<typeof read>>): Promise<BlockState> => ({
        database: db.name, databaseVersion: db.version, projectCount: value.count, sceneId: value.row.sceneId, revision: value.row.revision, status: value.row.status,
        currentContentHash: value.row.contentHash, manifestContentHash: value.row.project.contentHash, manifestFormat: value.row.project.format, manifestVersion: value.row.project.version,
        rowSha256: await digest(new TextEncoder().encode(JSON.stringify(value.row))), fieldPath: ['document', 'props'], blockHash: value.ref.sha256, referenceByteLength: value.ref.byteLength,
        present: value.block !== undefined, declaredHash: value.block?.sha256 ?? null, actualHash: value.block ? await digest(value.block.bytes) : null, actualByteLength: value.block?.bytes.length ?? null,
      })
      const original = await read(), before = await state(original)
      if (original.count !== 1) throw new Error('Faults may only target this context sole project.')
      if (mutation) {
        const block = original.block
        if (!block || !(block.bytes instanceof Uint8Array) || before.actualHash !== before.blockHash || block.sha256 !== before.blockHash || block.bytes.length !== before.referenceByteLength) throw new Error('Fault target must initially have valid actual bytes and its referenced hash.')
        const props = JSON.parse(new TextDecoder().decode(block.bytes)) as Record<string, unknown>
        if (!Object.hasOwn(props, entity)) throw new Error('Fault target does not contain the UI-created test prop.')
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(['projects', 'projectContentBlocks'], 'readwrite')
          let failure: unknown
          const fail = (error: unknown) => { failure = error; transaction.abort() }
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Native integrity fault aborted.'))
          transaction.oncomplete = () => resolve()
          const current = transaction.objectStore('projects').get(owner)
          current.onsuccess = () => {
            try {
              if (JSON.stringify(current.result) !== JSON.stringify(original.row)) throw new Error('Test current manifest changed before its fault transaction.')
              const blocks = transaction.objectStore('projectContentBlocks'), request = blocks.get(before.blockHash)
              request.onsuccess = () => {
                try {
                  const actual = request.result as Block | undefined
                  if (!actual || actual.sha256 !== block.sha256 || actual.bytes.length !== block.bytes.length || !actual.bytes.every((value, index) => value === block.bytes[index])) throw new Error('Test block changed before its fault transaction.')
                  if (mutation === 'missing') blocks.delete(before.blockHash)
                  else { const bytes = actual.bytes.slice(); bytes[0] ^= 1; blocks.put({ sha256: actual.sha256, bytes }) }
                } catch (error) { fail(error) }
              }
            } catch (error) { fail(error) }
          }
        })
      }
      return { fault: mutation, before, after: await state(await read()) }
    } finally { db.close() }
  }, { owner: sceneId, entity: propId, mutation: fault })
}

/** Passive observation only: return each original native request unchanged. */
async function observeBlockReads(page: Page, target: BlockState): Promise<void> {
  await page.evaluate(({ database, hash }) => {
    const original = IDBObjectStore.prototype.get, hits: NativeReadHit[] = []
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey) {
      if (this.transaction.db.name === database && this.name === 'projectContentBlocks' && key === hash) hits.push({ database, store: this.name, key: hash, mode: this.transaction.mode })
      return original.call(this, key)
    }
    Reflect.set(window, '__snapshotIntegrityReadObserver', { hits, restore: () => { IDBObjectStore.prototype.get = original } })
  }, { database: target.database, hash: target.blockHash })
}

async function observedBlockReads(page: Page): Promise<NativeReadHit[]> {
  return page.evaluate(() => {
    const observer = Reflect.get(window, '__snapshotIntegrityReadObserver') as { hits: NativeReadHit[]; restore: () => void }
    observer.restore(); Reflect.deleteProperty(window, '__snapshotIntegrityReadObserver')
    return observer.hits
  })
}

for (const fault of ['corrupt', 'missing'] as const) test(`production ${fault} current content block rejects warm auto-save and cold open`, async ({ browser, baseURL }, info) => {
  test.setTimeout(180_000)
  // This is a new temporary browser context, never the user's browser profile.
  const context = await browser.newContext({ baseURL, viewport: { width: 1512, height: 982 } })
  const errors: string[] = []
  try {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
    await createKeyboardProject(page, `快照持久化完整性 ${fault}`)
    await placeKeyboardLamp(page)
    const placed = await keyboardProjectBackup(page, info.outputPath('placed.sceneweave'))
    const [propId] = Object.keys(placed.document.props)
    expect(Object.keys(placed.document.props)).toHaveLength(1)
    await selectKeyboardProp(page, propId)
    const inspector = await openKeyboardPanel(page, 'inspector')
    const rotation = inspector.getByLabel('物件旋转', { exact: true })
    await rotation.fill('15'); await rotation.press('Tab'); await keyboardWorkspaceSaved(page)
    const before = await keyboardProjectBackup(page, info.outputPath('warm-saved-before.sceneweave'))
    expect(before.document.props[propId].rotationDeg).toBe(15)
    expect(Object.keys(keyboardResourceHashes(before.hashes)).length).toBeGreaterThan(0)

    // A separate page has only read the home listing, never installed an editor
    // project. Its cached row provides the normal Open action after corruption.
    const cold = await context.newPage(); cold.on('pageerror', error => errors.push(error.message))
    await cold.goto('./#home')
    const homeRow = cold.getByTestId('workspace-home').locator(`[data-project-key="native:${before.document.sceneId}"]`)
    await expect(homeRow).toBeVisible()
    await expect(cold.locator('.workspace-unified')).toHaveCount(0)
    const injected = await contentBlock(page, before.document.sceneId, propId, fault)
    expect(injected.before.databaseVersion).toBe(40)
    expect(injected.before.projectCount).toBe(1)
    expect(injected.before.revision).toBe(before.document.revision)
    expect(injected.before.actualHash).toBe(injected.before.blockHash)
    expect(injected.before.currentContentHash).toBe(injected.before.manifestContentHash)
    expect(injected.after.rowSha256).toBe(injected.before.rowSha256)
    if (fault === 'corrupt') {
      expect(injected.after.present).toBe(true)
      expect(injected.after.declaredHash).toBe(injected.before.blockHash)
      expect(injected.after.actualByteLength).toBe(injected.before.referenceByteLength)
      expect(injected.after.actualHash).not.toBe(injected.before.blockHash)
    } else {
      expect(injected.after.present).toBe(false)
      expect(injected.after.actualHash).toBeNull()
    }

    await observeBlockReads(page, injected.before)
    await rotation.fill('30'); await rotation.press('Tab')
    const recovery = page.getByRole('alert', { name: '保存恢复选项', exact: true })
    await expect(page.locator('.asset-save')).toHaveText('保存失败')
    await expect(recovery).toContainText('当前编辑仍保留在此页面')
    await recovery.getByText('查看具体原因', { exact: true }).click()
    await expect(recovery).toContainText(/工程内容块.*损坏/)
    await expect(page.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
    await expect(page.locator('.asset-busy')).toHaveCount(0)
    const warmReads = await observedBlockReads(page)
    expect(warmReads.length).toBeGreaterThan(0)
    const memory = await keyboardProjectBackup(page, info.outputPath('failed-save-memory.sceneweave'))
    expect(memory.document).toEqual({ ...before.document, revision: before.document.revision + 1, updatedAt: memory.document.updatedAt,
      props: { ...before.document.props, [propId]: { ...before.document.props[propId], rotationDeg: 30 } } })
    expect(memory.identity).toEqual(before.identity); expect(memory.appearance).toEqual(before.appearance)
    expect(keyboardResourceHashes(memory.hashes)).toEqual(keyboardResourceHashes(before.hashes))
    await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
    await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(before.document.revision + 2))
    await expect(page.getByRole('button', { name: '重做编辑', exact: true })).toBeEnabled()
    await expect(page.locator('.asset-save')).toHaveText('保存失败')
    await expect(recovery).toContainText(/工程内容块.*损坏/)
    const undone = await keyboardProjectBackup(page, info.outputPath('failed-save-undone.sceneweave'))
    expect(undone.document).toEqual({ ...before.document, revision: before.document.revision + 2, updatedAt: undone.document.updatedAt })
    expect(undone.identity).toEqual(before.identity); expect(undone.appearance).toEqual(before.appearance)
    expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(before.hashes))
    const afterWarm = await contentBlock(page, before.document.sceneId, propId)
    expect(afterWarm.after).toEqual(injected.after)

    await observeBlockReads(cold, injected.before)
    await homeRow.getByRole('button', { name: '打开', exact: true }).click()
    await expect(cold.locator('.asset-notice')).toContainText(/工程内容块.*损坏/)
    await expect(cold.locator('.asset-busy')).toHaveCount(0)
    await expect(cold.locator('.asset-save')).toHaveText('尚未打开工程')
    await expect(cold.locator('.workspace-unified')).not.toHaveAttribute('data-revision', /.+/)
    await expect(cold.locator('.asset-map-wrap')).toHaveCount(0)
    const coldReads = await observedBlockReads(cold)
    expect(coldReads.length).toBeGreaterThan(0)
    await cold.screenshot({ path: info.outputPath('cold-open-refused.png') })
    // A fresh directory reads its own envelope/title only. It must retain the
    // record, disclose unchecked content, and still reject an actual Open.
    await cold.goto('./#home'); await cold.reload()
    const home = cold.getByTestId('workspace-home')
    await expect(home.getByText('当前完整工程仓库。打开工程时会检查完整内容；目录中的未读取内容尚未检查。', { exact: true })).toBeVisible()
    const refreshedRow = home.locator(`[data-project-key="native:${before.document.sceneId}"]`)
    await expect(refreshedRow).toBeVisible()
    await expect(home.locator('.home-project-row')).toHaveCount(1)
    await expect(home.locator('.home-diagnostic')).toHaveCount(0)
    await expect(home.locator('.home-empty')).toHaveCount(0)
    await expect(home.locator('.home-continue')).toHaveCount(0)
    await expect(cold.locator('.workspace-unified')).toHaveCount(0)
    await observeBlockReads(cold, injected.before)
    await refreshedRow.getByRole('button', { name: '打开', exact: true }).click()
    await expect(cold.locator('.asset-notice')).toContainText(/工程内容块.*损坏/)
    await expect(cold.locator('.asset-busy')).toHaveCount(0)
    await expect(cold.locator('.asset-save')).toHaveText('尚未打开工程')
    await expect(cold.locator('.workspace-unified')).not.toHaveAttribute('data-revision', /.+/)
    await expect(cold.locator('.asset-map-wrap')).toHaveCount(0)
    const refreshedColdReads = await observedBlockReads(cold)
    expect(refreshedColdReads.length).toBeGreaterThan(0)
    const afterCold = await contentBlock(cold, before.document.sceneId, propId)
    expect(afterCold.after).toEqual(injected.after)
    expect(errors).toEqual([])
    const facts = { fault, browserVersion: browser.version(), scope: 'temporary Playwright context; UI-created sole project; native current-manifest props block only',
      injected, warmReads, coldReads, refreshedColdReads, afterWarm: afterWarm.after, afterCold: afterCold.after,
      memory: { sceneId: memory.document.sceneId, revision: memory.document.revision, rotationDeg: memory.document.props[propId].rotationDeg, hashes: memory.hashes },
      undo: { revision: undone.document.revision, rotationDeg: undone.document.props[propId].rotationDeg, hashes: undone.hashes }, errors }
    const factsPath = info.outputPath('snapshot-storage-integrity-facts.json')
    await writeFile(factsPath, JSON.stringify(facts, null, 2))
    await info.attach('snapshot-storage-integrity-facts.json', { path: factsPath, contentType: 'application/json' })
  } finally { await context.close() }
})

test('production warm encoding cannot bypass cross-tab CAS or replace either branch', async ({ browser, baseURL }, info) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({ baseURL, viewport: { width: 1512, height: 982 } })
  const errors: string[] = []
  try {
    const first = await context.newPage(); first.on('pageerror', error => errors.push(error.message))
    await createKeyboardProject(first, '保存编码双标签 CAS')
    await placeKeyboardLamp(first)
    const placed = await keyboardProjectBackup(first, info.outputPath('cas-placed.sceneweave'))
    const [propId] = Object.keys(placed.document.props)
    await selectKeyboardProp(first, propId)
    const rotation = (await openKeyboardPanel(first, 'inspector')).getByLabel('物件旋转', { exact: true })
    await rotation.fill('15'); await rotation.press('Tab'); await keyboardWorkspaceSaved(first)
    const baseline = await keyboardProjectBackup(first, info.outputPath('cas-warm-baseline.sceneweave'))

    const second = await context.newPage(); second.on('pageerror', error => errors.push(error.message))
    await second.goto('./#home')
    await second.getByTestId('workspace-home').locator(`[data-project-key="native:${baseline.document.sceneId}"]`)
      .getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(second); await selectKeyboardProp(second, propId)
    const otherRotation = (await openKeyboardPanel(second, 'inspector')).getByLabel('物件旋转', { exact: true })
    await otherRotation.fill('30'); await otherRotation.press('Tab'); await keyboardWorkspaceSaved(second)
    const committed = await keyboardProjectBackup(second, info.outputPath('cas-winner.sceneweave'))

    await rotation.fill('45'); await rotation.press('Tab')
    await expect(first.locator('.asset-save')).toHaveText('版本冲突')
    await expect(first.getByRole('button', { name: '撤销编辑', exact: true })).toBeEnabled()
    const memory = await keyboardProjectBackup(first, info.outputPath('cas-loser-memory.sceneweave'))
    expect(memory.document).toEqual({ ...baseline.document, revision: baseline.document.revision + 1,
      updatedAt: memory.document.updatedAt, props: { ...baseline.document.props, [propId]: { ...baseline.document.props[propId], rotationDeg: 45 } } })
    expect(committed.document).toEqual({ ...baseline.document, revision: baseline.document.revision + 1,
      updatedAt: committed.document.updatedAt, props: { ...baseline.document.props, [propId]: { ...baseline.document.props[propId], rotationDeg: 30 } } })
    expect(memory.identity).toEqual(baseline.identity); expect(memory.appearance).toEqual(baseline.appearance)
    expect(keyboardResourceHashes(memory.hashes)).toEqual(keyboardResourceHashes(baseline.hashes))
    await first.getByRole('button', { name: '撤销编辑', exact: true }).click()
    await expect(first.locator('.asset-save')).toHaveText('版本冲突')
    const undone = await keyboardProjectBackup(first, info.outputPath('cas-loser-undone.sceneweave'))
    expect(undone.document).toEqual({ ...baseline.document, revision: baseline.document.revision + 2, updatedAt: undone.document.updatedAt })

    const cold = await context.newPage(); cold.on('pageerror', error => errors.push(error.message))
    await cold.goto('./#home')
    await cold.getByTestId('workspace-home').locator(`[data-project-key="native:${baseline.document.sceneId}"]`)
      .getByRole('button', { name: '打开', exact: true }).click()
    await keyboardWorkspaceSaved(cold)
    const persisted = await keyboardProjectBackup(cold, info.outputPath('cas-cold-winner.sceneweave'))
    expect(persisted.hashes).toEqual(committed.hashes)
    expect(errors).toEqual([])
    await writeFile(info.outputPath('cross-tab-cas-facts.json'), JSON.stringify({ method: 'normal production UI; real shared native IDB; no state or fault injection',
      browserVersion: browser.version(), sceneId: baseline.document.sceneId,
      baseline: { revision: baseline.document.revision, rotation: 15 }, committed: { revision: committed.document.revision, rotation: 30 },
      memory: { revision: memory.document.revision, rotation: 45 }, undone: { revision: undone.document.revision, rotation: 15 },
      coldEntryHashesEqual: true, errors }, null, 2))
  } finally { await context.close() }
})
