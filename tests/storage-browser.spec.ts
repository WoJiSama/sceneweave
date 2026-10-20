import { expect, test, type Page } from '@playwright/test'

async function deleteDatabase(page: Page, name: string): Promise<void> {
  await page.evaluate(async databaseName => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Test database cleanup was blocked by an open connection.'))
    })
  }, name)
}

test('real IndexedDB survives connection close and a page reload with the full document', async ({ page }, testInfo) => {
  const databaseName = `sceneweave-browser-roundtrip-${crypto.randomUUID()}`
  await page.goto('/')
  try {
    const original = await page.evaluate(async name => {
      const storagePath = '/src/io/storage.ts', seedPath = '/src/core/seed.ts'
      const [{ SceneRepository }, { createHouse }] = await Promise.all([import(storagePath), import(seedPath)])
      const document = createHouse()
      document.revision = 9
      document.notes['n-d4'].text = '浏览器持久化的主持人私密线索。'
      const repository = new SceneRepository(name)
      try { await repository.save(document, null) } finally { repository.close() }
      return document
    }, databaseName)
    await page.reload()
    const restored = await page.evaluate(async ({ name, sceneId }) => {
      const storagePath = '/src/io/storage.ts'
      const { SceneRepository } = await import(storagePath)
      const repository = new SceneRepository(name)
      try {
        return { document: await repository.load(sceneId), latest: await repository.latest(), snapshots: await repository.listSnapshots(sceneId), userAgent: navigator.userAgent }
      } finally { repository.close() }
    }, { name: databaseName, sceneId: original.sceneId })
    expect(restored.document).toEqual(original)
    expect(restored.latest).toEqual(original)
    expect(restored.snapshots).toEqual([original])
    await testInfo.attach('indexeddb-roundtrip.json', { body: JSON.stringify({ revision: restored.document.revision, secretNotePreserved: true, fullDocumentEqual: true, userAgent: restored.userAgent }, null, 2), contentType: 'application/json' })
  } finally { await deleteDatabase(page, databaseName) }
})

test('two browser tabs cannot overwrite one another using a stale CAS baseline', async ({ page, context }, testInfo) => {
  const databaseName = `sceneweave-browser-cas-${crypto.randomUUID()}`
  const secondPage = await context.newPage()
  await Promise.all([page.goto('/'), secondPage.goto('/')])
  try {
    const sceneId = await page.evaluate(async name => {
      const storagePath = '/src/io/storage.ts', seedPath = '/src/core/seed.ts'
      const [{ SceneRepository }, { createHouse }] = await Promise.all([import(storagePath), import(seedPath)])
      const document = createHouse()
      const repository = new SceneRepository(name)
      await repository.save(document, null)
      Reflect.set(window, '__sceneweaveStorageTest', { repository, document })
      return document.sceneId
    }, databaseName)
    await secondPage.evaluate(async ({ name, id }) => {
      const storagePath = '/src/io/storage.ts'
      const { SceneRepository } = await import(storagePath)
      const repository = new SceneRepository(name)
      const document = await repository.load(id)
      Reflect.set(window, '__sceneweaveStorageTest', { repository, document })
    }, { name: databaseName, id: sceneId })
    await page.evaluate(async () => {
      const branch = Reflect.get(window, '__sceneweaveStorageTest')
      branch.document = structuredClone(branch.document)
      branch.document.revision = 1
      branch.document.title = '标签 A 已保存的修改'
      await branch.repository.save(branch.document, 0)
    })
    const conflict = await secondPage.evaluate(async () => {
      const branch = Reflect.get(window, '__sceneweaveStorageTest')
      branch.document = structuredClone(branch.document)
      branch.document.revision = 2
      branch.document.title = '标签 B 仍在内存中的修改'
      let rejected: { name: string; currentRevision: number | null; message: string } | null = null
      try { await branch.repository.save(branch.document, 0) }
      catch (error) {
        const failure = error as Error & { currentRevision: number | null }
        rejected = { name: failure.name, currentRevision: failure.currentRevision, message: failure.message }
      }
      return { rejected, local: branch.document, persisted: await branch.repository.load(branch.document.sceneId), snapshots: await branch.repository.listSnapshots(branch.document.sceneId) }
    })
    expect(conflict.rejected).toMatchObject({ name: 'ConflictError', currentRevision: 1 })
    expect(conflict.local.title).toBe('标签 B 仍在内存中的修改')
    expect(conflict.local.revision).toBe(2)
    expect(conflict.persisted.title).toBe('标签 A 已保存的修改')
    expect(conflict.persisted.revision).toBe(1)
    expect(conflict.snapshots.map((document: { revision: number }) => document.revision)).toEqual([1, 0])
    await testInfo.attach('cross-tab-cas.json', { body: JSON.stringify({ conflict: conflict.rejected, localRevisionRetained: conflict.local.revision, persistedRevision: conflict.persisted.revision, snapshotRevisions: [1, 0] }, null, 2), contentType: 'application/json' })
  } finally {
    await Promise.all([page, secondPage].map(tab => tab.evaluate(() => {
      Reflect.get(window, '__sceneweaveStorageTest')?.repository.close()
      Reflect.deleteProperty(window, '__sceneweaveStorageTest')
    })))
    await deleteDatabase(page, databaseName)
    await secondPage.close()
  }
})

test('browser auto-save coalesces revisions and retains the newest 20 snapshots', async ({ page }, testInfo) => {
  const databaseName = `sceneweave-browser-save-queue-${crypto.randomUUID()}`
  await page.goto('/')
  try {
    const result = await page.evaluate(async name => {
      const storagePath = '/src/io/storage.ts', seedPath = '/src/core/seed.ts'
      const [{ SceneRepository, SaveCoordinator }, { createHouse }] = await Promise.all([import(storagePath), import(seedPath)])
      const repository = new SceneRepository(name)
      const original = createHouse()
      const states: { status: string; persistedRevision: number | null }[] = []
      const coordinator = new SaveCoordinator(repository, original, null, (state: { status: string; persistedRevision: number | null }) => states.push(state))
      try {
        coordinator.enqueue({ ...structuredClone(original), revision: 1 })
        coordinator.enqueue({ ...structuredClone(original), revision: 2 })
        coordinator.enqueue({ ...structuredClone(original), revision: 3 })
        await coordinator.flush()
        const afterCoalescing = await repository.listSnapshots(original.sceneId)
        for (let revision = 4; revision < 28; revision++) {
          coordinator.enqueue({ ...structuredClone(original), revision })
          await coordinator.flush()
        }
        return { afterCoalescing: afterCoalescing.map((document: { revision: number }) => document.revision), retained: (await repository.listSnapshots(original.sceneId)).map((document: { revision: number }) => document.revision), persisted: await repository.load(original.sceneId), finalState: states.at(-1) }
      } finally { coordinator.stop(); repository.close() }
    }, databaseName)
    expect(result.afterCoalescing).toEqual([3])
    expect(result.retained).toEqual(Array.from({ length: 20 }, (_, index) => 27 - index))
    expect(result.persisted.revision).toBe(27)
    expect(result.finalState).toEqual({ status: 'saved', persistedRevision: 27 })
    await testInfo.attach('save-queue.json', { body: JSON.stringify({ coalesced: result.afterCoalescing, retainedRevisions: result.retained, finalState: result.finalState }, null, 2), contentType: 'application/json' })
  } finally { await deleteDatabase(page, databaseName) }
})

test('browser ZIP roundtrip preserves secrets and damaged import leaves the open project intact', async ({ page }, testInfo) => {
  const databaseName = `sceneweave-browser-zip-${crypto.randomUUID()}`
  await page.goto('/')
  try {
    const result = await page.evaluate(async name => {
      const storagePath = '/src/io/storage.ts', seedPath = '/src/core/seed.ts', projectPath = '/src/io/project-file.ts'
      const [{ SceneRepository }, { createHouse }, { exportProject, importProject }] = await Promise.all([import(storagePath), import(seedPath), import(projectPath)])
      const document = createHouse()
      document.revision = 11
      document.notes['n-d4'].text = '保密注记必须完整往返，不能进入玩家图片。'
      const before = JSON.stringify(document)
      const repository = new SceneRepository(name)
      try {
        await repository.save(document, null)
        const file = await exportProject(document)
        const imported = await importProject(file)
        const bytes = new Uint8Array(await file.arrayBuffer())
        const magic = Array.from(bytes.slice(0, 4))
        const view = new DataView(bytes.buffer)
        const firstPayload = 30 + view.getUint16(26, true) + view.getUint16(28, true)
        bytes[firstPayload] ^= 255
        let error = ''
        try { await importProject(new Blob([bytes.buffer])) }
        catch (failure) { error = failure instanceof Error ? failure.message : String(failure) }
        return { original: document, imported, memoryUnchanged: JSON.stringify(document) === before, persistedUnchanged: JSON.stringify(await repository.load(document.sceneId)) === before, damagedImportError: error, bytes: file.size, mimeType: file.type, magic }
      } finally { repository.close() }
    }, databaseName)
    expect(result.magic).toEqual([80, 75, 3, 4])
    expect(result.mimeType).toBe('application/x-sceneweave')
    expect(result.bytes).toBeGreaterThan(100)
    expect(result.imported.sceneId).not.toBe(result.original.sceneId)
    expect(result.imported.revision).toBe(0)
    expect(result.imported).toEqual({ ...result.original, sceneId: result.imported.sceneId, revision: 0, createdAt: result.imported.createdAt, updatedAt: result.imported.updatedAt })
    expect(result.memoryUnchanged).toBe(true)
    expect(result.persistedUnchanged).toBe(true)
    expect(result.damagedImportError).toBeTruthy()
    await testInfo.attach('project-zip.json', { body: JSON.stringify({ bytes: result.bytes, mimeType: result.mimeType, fullDocumentRoundtrip: true, importedAsNewScene: true, damagedImportError: result.damagedImportError, memoryUnchanged: result.memoryUnchanged, persistedUnchanged: result.persistedUnchanged }, null, 2), contentType: 'application/json' })
  } finally { await deleteDatabase(page, databaseName) }
})
