import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type Dexie from 'dexie'
import type { SceneCommandV2 } from '../src/core/v2/commands'
import type { CompleteProjectV2 } from '../src/io/v2/types'
import type { SceneRepositoryV2 } from '../src/io/v2/storage'
import type { WorkspaceV2 } from '../src/editor/v2/workspace'

interface Runtime {
  io: typeof import('../src/io/v2/project-file')
  storage: typeof import('../src/io/v2/storage')
  editor: typeof import('../src/editor/v2/workspace')
}
interface Branch { repository: SceneRepositoryV2; workspace: WorkspaceV2 }

async function evidence(testInfo: TestInfo, name: string, result: unknown) {
  const path = testInfo.outputPath(name)
  await writeFile(path, JSON.stringify(result, null, 2))
  await testInfo.attach(name, { path, contentType: 'application/json' })
}
async function runtime(page: Page) {
  await page.evaluate(async () => {
    const ioPath = '/src/io/v2/project-file.ts', storagePath = '/src/io/v2/storage.ts', workspacePath = '/src/editor/v2/workspace.ts'
    const [io, storage, editor] = await Promise.all([import(ioPath), import(storagePath), import(workspacePath)])
    Reflect.set(window, '__b4StorageRuntime', { io, storage, editor })
  })
}
async function cleanup(page: Page, name: string) {
  if (page.isClosed()) return
  await page.evaluate(async databaseName => {
    const branch = Reflect.get(window, '__b4StorageBranch') as Branch | undefined
    if (branch) { await branch.workspace.flush().catch(() => {}); branch.repository.close() }
    Reflect.deleteProperty(window, '__b4StorageBranch')
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('B4 storage cleanup was blocked by an owned connection.'))
    })
  }, name)
}

for (const sample of ['VIS-01', 'VIS-02'] as const) {
  test(`${sample} edited complete project opens, saves and resumes offline in fresh storage without catalog or model`, async ({ page, browser }, testInfo) => {
    test.slow()
    await page.goto('/')
    const initial = await page.evaluate(async kind => {
      const samplePath = kind === 'VIS-01' ? '/src/editor/v2/study-sample.ts' : '/src/editor/v2/island-sample.ts'
      const ioPath = '/src/io/v2/project-file.ts', workspacePath = '/src/editor/v2/workspace.ts'
      const [{ exportProjectV2 }, { WorkspaceV2 }, fixture] = await Promise.all([import(ioPath) as Promise<Runtime['io']>, import(workspacePath) as Promise<Runtime['editor']>, import(samplePath)])
      const project = await (kind === 'VIS-01' ? fixture.createStudyProject() : fixture.createIslandProject()) as CompleteProjectV2
      const room = kind === 'VIS-01', surfaceId = room ? 'study-room' : 'island-high'
      const style = room ? project.document.rooms[surfaceId].floorStyle! : project.document.terrainAreas[surfaceId].surfaceStyle!
      // Exercise every persisted MaterialPaint field, including values not exposed by the finite sample UI.
      Object.assign(style.base, { tileSizeMm: { width: 1733, height: 2177 }, rotationDeg: 23, alignment: room ? 'surface' : 'world', originMm: { x: -317, y: 509 }, tint: '#819A77', opacity: 1 })
      if (room) style.overlays.push({ id: 'b4-study-overlay', boundaryMm: [{ x: 4200, y: 3200 }, { x: 6100, y: 3200 }, { x: 6100, y: 4700 }, { x: 4200, y: 4700 }], paint: { ...structuredClone(style.base), rotationDeg: 71, alignment: 'world', originMm: { x: 29, y: -71 }, tint: '#C4AA83', opacity: .61 }, blendWidthMm: 130, renderOrder: 4 })
      else Object.assign(style.overlays[0].paint, { tileSizeMm: { width: 1973, height: 2377 }, rotationDeg: 37, alignment: 'surface', originMm: { x: 113, y: -227 }, tint: '#B1A78C', opacity: .69 })
      project.document.notes['b4-storage-private-note'] = { id: 'b4-storage-private-note', floorId: Object.keys(project.document.floors)[0], editLocked: false, visibility: 'gm', kind: 'clue', text: 'B4 complete project preserves the actual private clue', anchor: { type: 'point', positionMm: { x: 2000, y: 2000 } } }
      const saves: number[] = [], workspace = new WorkspaceV2({ save: async value => { saves.push(value.document.revision) } })
      await workspace.openPersisted(project)
      const commands: SceneCommandV2[] = [{ type: 'setSurfacePaint', kind: room ? 'room' : 'terrainArea', id: surfaceId, changes: { rotationDeg: 41 } }]
      let scatterCases: Record<string, string> | null = null
      if (room) commands.push(
        { type: 'updateProp', id: 'study-chair', changes: { rotationDeg: 17 } },
        { type: 'deleteProp', id: 'study-books-left' },
        { type: 'unpackPrefab', id: 'terrace-group' },
        { type: 'updateProp', id: 'terrace-chair-north', changes: { rotationDeg: 191 } },
      )
      else {
        const live = (id: string) => Object.entries(project.document.scatterGroups[id].members).filter(([, item]) => item.propId !== null)
        const trees = live('island-trees'), shrubs = live('island-shrubs'), rocks = live('island-rocks')
        scatterCases = { manual: trees[0][1].propId!, locked: trees[1][1].propId!, deletedKey: shrubs[0][0], detachedKey: rocks[0][0], detachedProp: rocks[0][1].propId! }
        commands.push(
          { type: 'setTerrainElevation', id: 'island-high', groundElevationMm: 4000 },
          { type: 'updateProp', id: scatterCases.manual, changes: { rotationDeg: (project.document.props[scatterCases.manual].rotationDeg + 13) % 360 } },
          { type: 'setEditLock', kind: 'prop', id: scatterCases.locked, locked: true },
          { type: 'deleteProp', id: shrubs[0][1].propId! },
          { type: 'detachScatterMember', groupId: 'island-rocks', propId: scatterCases.detachedProp },
        )
      }
      const beforePreview = workspace.getState(), checkpoint = workspace.checkpoint()
      workspace.preview(commands)
      if (workspace.getState() !== beforePreview || workspace.checkpoint() !== checkpoint) throw new Error('Candidate preview consumed current state or revision.')
      workspace.execute(commands); await workspace.flush()
      const adopted = workspace.getState().project!, packed = await exportProjectV2(adopted)
      return { bytes: Array.from(new Uint8Array(await packed.arrayBuffer())), expectedDocument: adopted.document, bindings: adopted.licenseBindings, licenses: adopted.licenses,
        hashes: Object.keys(adopted.assets).sort(), packageBytes: packed.size, scatterCases, surfaceId, saves, previewCancelledWithoutChange: true }
    }, sample)
    expect(initial.saves).toEqual([1])
    expect(initial.expectedDocument.revision).toBe(1)
    if (sample === 'VIS-01') {
      expect(initial.expectedDocument.prefabInstances['study-group'].members.chair.overrideFields).toEqual(['rotationDeg'])
      expect(initial.expectedDocument.prefabInstances['study-group'].members['books-left'].propId).toBeNull()
      expect(initial.expectedDocument.prefabInstances['terrace-group']).toBeUndefined()
      expect(initial.expectedDocument.props['terrace-chair-north'].rotationDeg).toBe(191)
    } else {
      const cases = initial.scatterCases!
      expect(Object.values(initial.expectedDocument.scatterGroups['island-trees'].members).find(member => member.propId === cases.manual)?.state).toBe('manual')
      expect(initial.expectedDocument.props[cases.locked].editLocked).toBe(true)
      expect(initial.expectedDocument.scatterGroups['island-shrubs'].members[cases.deletedKey].state).toBe('deleted')
      expect(initial.expectedDocument.scatterGroups['island-rocks'].members[cases.detachedKey].state).toBe('detached')
      expect(initial.expectedDocument.props[cases.detachedProp]).toBeTruthy()
      expect(initial.expectedDocument.terrainConnections['island-stairs'].widthMm).toBe(2000)
    }
    const freshContext = await browser.newContext(), name = `sceneweave-b4-fresh-${crypto.randomUUID()}`
    const forbiddenRequests: string[] = []
    await freshContext.route(/\/(?:assets\/sceneweave-handdrawn|src\/editor\/v2\/(?:study|island)-sample)|(?:openai|anthropic)\.com/, route => { forbiddenRequests.push(route.request().url()); return route.abort() })
    const fresh = await freshContext.newPage()
    try {
      await fresh.goto('/'); await runtime(fresh); await freshContext.setOffline(true)
      const imported = await fresh.evaluate(async ({ bytes, databaseName, kind, surfaceId }) => {
        const { io, editor, storage } = Reflect.get(window, '__b4StorageRuntime') as Runtime
        const repository = new storage.SceneRepositoryV2(databaseName), workspace = new editor.WorkspaceV2(repository)
        Reflect.set(window, '__b4StorageBranch', { repository, workspace })
        const initiallyEmpty = (await repository.list()).length === 0, cacheKeysBefore = await caches.keys()
        const candidate = await io.importProjectV2(new Blob([Uint8Array.from(bytes)]))
        const parsedDocument = structuredClone(candidate.document), forked = editor.forkProjectV2(candidate)
        await workspace.adoptNew(forked)
        const adopted = structuredClone(workspace.getState().project!.document)
        workspace.execute([{ type: 'setSurfacePaint', kind: kind === 'VIS-01' ? 'room' : 'terrainArea', id: surfaceId, changes: { rotationDeg: 52 } }])
        await workspace.flush()
        const editedDocument = workspace.getState().project!.document
        const snapshotRevisions = (await repository.listSnapshots(editedDocument.sceneId)).map(item => item.revision)
        repository.close(); Reflect.deleteProperty(window, '__b4StorageBranch')
        return { initiallyEmpty, cacheKeysBefore, parsedDocument, adopted, editedDocument, snapshotRevisions, offline: !navigator.onLine }
      }, { bytes: initial.bytes, databaseName: name, kind: sample, surfaceId: initial.surfaceId })
      expect(imported.initiallyEmpty).toBe(true); expect(imported.cacheKeysBefore).toEqual([]); expect(imported.offline).toBe(true)
      expect(imported.parsedDocument).toEqual(initial.expectedDocument)
      expect(imported.adopted.sceneId).not.toBe(initial.expectedDocument.sceneId)
      expect(imported.adopted.revision).toBe(0)
      expect(imported.adopted).toEqual({ ...initial.expectedDocument, sceneId: imported.adopted.sceneId, revision: 0, title: imported.adopted.title, createdAt: imported.adopted.createdAt, updatedAt: imported.adopted.updatedAt })
      expect(imported.snapshotRevisions).toEqual([1, 0])
      // Reload the application runtime online, with sample/catalog/model routes blocked.
      // The data reopen and subsequent save run offline again; this is not a PWA cold-start claim.
      await freshContext.setOffline(false); await fresh.reload(); await runtime(fresh); await freshContext.setOffline(true)
      const reopened = await fresh.evaluate(async ({ databaseName, sceneId, kind, surfaceId }) => {
        const { io, editor, storage } = Reflect.get(window, '__b4StorageRuntime') as Runtime
        const repository = new storage.SceneRepositoryV2(databaseName), workspace = new editor.WorkspaceV2(repository)
        Reflect.set(window, '__b4StorageBranch', { repository, workspace })
        const saved = await repository.load(sceneId)
        if (!saved) throw new Error('Complete project missing after page reload.')
        const beforeResume = structuredClone(saved.document), resources = []
        for (const [hash, item] of Object.entries(saved.assets)) {
          const digest = await crypto.subtle.digest('SHA-256', await item.blob.arrayBuffer())
          const actualHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
          const bitmap = await createImageBitmap(item.blob)
          resources.push({ hash, actualHash, bytes: item.blob.size, width: bitmap.width, height: bitmap.height }); bitmap.close()
        }
        await workspace.openPersisted(saved)
        const continuedEdits: SceneCommandV2[] = [{ type: 'setSurfacePaint', kind: kind === 'VIS-01' ? 'room' : 'terrainArea', id: surfaceId, changes: { rotationDeg: 63 } }]
        if (kind === 'VIS-01') continuedEdits.push({ type: 'transformPrefab', id: 'study-group', anchorMm: { x: 3020, y: 2500 } })
        else for (const id of ['island-trees', 'island-shrubs', 'island-rocks']) continuedEdits.push({ type: 'regenerateScatter', id, densityFactor: 1 })
        workspace.execute(continuedEdits)
        await workspace.flush()
        const final = workspace.getState().project!, backup = await io.exportProjectV2(final), backupDocument = (await io.importProjectV2(backup)).document
        return { beforeResume, finalDocument: final.document, backupDocument, bindings: final.licenseBindings, licenses: final.licenses, resources,
          snapshotRevisions: (await repository.listSnapshots(sceneId)).map(item => item.revision), status: workspace.getState().status, offline: !navigator.onLine }
      }, { databaseName: name, sceneId: imported.adopted.sceneId, kind: sample, surfaceId: initial.surfaceId })
      expect(reopened.beforeResume).toEqual(imported.editedDocument)
      expect(reopened.backupDocument).toEqual(reopened.finalDocument)
      expect(reopened.finalDocument.revision).toBe(2)
      expect(reopened.bindings).toEqual(initial.bindings); expect(reopened.licenses).toEqual(initial.licenses)
      expect(reopened.resources.map(item => item.hash).sort()).toEqual(initial.hashes)
      expect(reopened.resources.every(item => item.hash === item.actualHash && item.width > 0 && item.height > 0)).toBe(true)
      if (sample === 'VIS-01') {
        expect(reopened.finalDocument.prefabInstances['study-group'].members.chair.overrideFields).toEqual(['rotationDeg'])
        expect(reopened.finalDocument.prefabInstances['study-group'].members['books-left'].propId).toBeNull()
        expect(reopened.finalDocument.props['study-chair'].rotationDeg).toBe(17)
        expect(reopened.finalDocument.props['study-chair'].positionMm.x).toBe(initial.expectedDocument.props['study-chair'].positionMm.x + 20)
      } else {
        const cases = initial.scatterCases!
        for (const id of [cases.manual, cases.locked, cases.detachedProp]) expect(reopened.finalDocument.props[id]).toEqual(initial.expectedDocument.props[id])
        expect(reopened.finalDocument.scatterGroups['island-shrubs'].members[cases.deletedKey]).toEqual(initial.expectedDocument.scatterGroups['island-shrubs'].members[cases.deletedKey])
        expect(reopened.finalDocument.scatterGroups['island-rocks'].members[cases.detachedKey]).toEqual(initial.expectedDocument.scatterGroups['island-rocks'].members[cases.detachedKey])
        expect(reopened.finalDocument.terrainConnections).toEqual(initial.expectedDocument.terrainConnections)
      }
      expect(reopened.snapshotRevisions).toEqual([2, 1, 0]); expect(reopened.status).toBe('saved'); expect(reopened.offline).toBe(true)
      expect(forbiddenRequests).toEqual([])
      await evidence(testInfo, `${sample.toLowerCase()}-fresh-complete-storage.json`, { sample, browserVersion: browser.version(), packageBytes: initial.packageBytes,
        originalDocument: initial.expectedDocument, forkedDocument: imported.adopted, reopenedDocument: reopened.beforeResume, continuedDocument: reopened.finalDocument,
        resources: reopened.resources, licenseBindings: reopened.bindings, sourceDocumentExact: true, newStorageInitiallyEmpty: true, cacheStorageInitiallyEmpty: true,
        importSaveAndReopenOffline: true, applicationRuntimeReloadedOnline: true, pwaColdStartTested: false, catalogOrModelRequests: forbiddenRequests,
        sourceCandidateCancelledWithoutChange: initial.previewCancelledWithoutChange, sourceSaveRevisions: initial.saves, snapshotRevisions: reopened.snapshotRevisions, scatterCases: initial.scatterCases })
    } finally { await cleanup(fresh, name); await freshContext.close() }
  })

  test(`${sample} two actual browser tabs preserve CAS branches, conflict copy and historical recovery copy`, async ({ page, context, browser }, testInfo) => {
    test.slow()
    const name = `sceneweave-b4-cas-${crypto.randomUUID()}`, second = await context.newPage()
    await Promise.all([page.goto('/'), second.goto('/')]); await Promise.all([runtime(page), runtime(second)])
    try {
      const source = await page.evaluate(async ({ databaseName, kind }) => {
        const samplePath = kind === 'VIS-01' ? '/src/editor/v2/study-sample.ts' : '/src/editor/v2/island-sample.ts', fixture = await import(samplePath)
        const input = await (kind === 'VIS-01' ? fixture.createStudyProject() : fixture.createIslandProject()) as CompleteProjectV2
        const { editor, storage } = Reflect.get(window, '__b4StorageRuntime') as Runtime
        const repository = new storage.SceneRepositoryV2(databaseName), workspace = new editor.WorkspaceV2(repository)
        Reflect.set(window, '__b4StorageBranch', { repository, workspace }); await workspace.adoptNew(input)
        return input.document
      }, { databaseName: name, kind: sample })
      await second.evaluate(async ({ databaseName, id }) => {
        const { editor, storage } = Reflect.get(window, '__b4StorageRuntime') as Runtime
        const repository = new storage.SceneRepositoryV2(databaseName), workspace = new editor.WorkspaceV2(repository), input = await repository.load(id)
        if (!input) throw new Error('Second tab could not read saved sample.')
        Reflect.set(window, '__b4StorageBranch', { repository, workspace }); await workspace.openPersisted(input)
      }, { databaseName: name, id: source.sceneId })
      const winner = await page.evaluate(async kind => {
        const { workspace } = Reflect.get(window, '__b4StorageBranch') as Branch
        workspace.execute([{ type: 'setSurfacePaint', kind: kind === 'VIS-01' ? 'room' : 'terrainArea', id: kind === 'VIS-01' ? 'study-room' : 'island-high', changes: { rotationDeg: 19 } }]); await workspace.flush()
        return workspace.getState().project!.document
      }, sample)
      const savedBranches = await second.evaluate(async kind => {
        const { repository, workspace } = Reflect.get(window, '__b4StorageBranch') as Branch, { editor } = Reflect.get(window, '__b4StorageRuntime') as Runtime
        const surface = { kind: kind === 'VIS-01' ? 'room' as const : 'terrainArea' as const, id: kind === 'VIS-01' ? 'study-room' : 'island-high' }
        workspace.execute([{ type: 'setSurfacePaint', ...surface, changes: { rotationDeg: 29 } }])
        let conflict: { name: string; revision: number | null } | null = null
        try { await workspace.flush() } catch (error) { const failure = error as Error & { currentRevision: number | null }; conflict = { name: failure.name, revision: failure.currentRevision } }
        const status = workspace.getState().status
        workspace.execute([{ type: 'setSurfacePaint', ...surface, changes: { rotationDeg: 39 } }])
        const losingBranch = workspace.getState().project!.document, originalId = losingBranch.sceneId
        await workspace.saveAsCopy()
        const copy = workspace.getState().project!.document, original = (await repository.load(originalId))!.document
        const snapshot = await repository.loadSnapshot(originalId, 0)
        if (!snapshot) throw new Error('Original complete snapshot is missing.')
        // This is the same explicit fork -> atomic adopt route used by the snapshot UI.
        await workspace.adoptNew(editor.forkProjectV2(snapshot))
        const recovered = workspace.getState().project!.document
        const storedCopy = (await repository.load(copy.sceneId))!.document, storedOriginal = (await repository.load(originalId))!.document
        const db = (repository as unknown as { db: Dexie }).db
        return { conflict, status, losingBranch, copy, original, recovered, storedCopy, storedOriginal,
          sceneCount: (await repository.list()).length, uniqueAssets: await db.table('assetBlobs').count(),
          originalSnapshots: (await repository.listSnapshots(originalId)).map(item => item.revision), copySnapshots: (await repository.listSnapshots(copy.sceneId)).map(item => item.revision),
          recoveredSnapshots: (await repository.listSnapshots(recovered.sceneId)).map(item => item.revision) }
      }, sample)
      expect(savedBranches.conflict).toEqual({ name: 'ConflictErrorV2', revision: 1 }); expect(savedBranches.status).toBe('conflict')
      expect(savedBranches.losingBranch.revision).toBe(2); expect(savedBranches.original).toEqual(winner); expect(savedBranches.storedOriginal).toEqual(winner)
      expect(savedBranches.copy.sceneId).not.toBe(source.sceneId); expect(savedBranches.copy.revision).toBe(0); expect(savedBranches.storedCopy).toEqual(savedBranches.copy)
      expect(savedBranches.copy).toEqual({ ...savedBranches.losingBranch, sceneId: savedBranches.copy.sceneId, revision: 0, title: savedBranches.copy.title, createdAt: savedBranches.copy.createdAt, updatedAt: savedBranches.copy.updatedAt })
      expect(savedBranches.recovered).toEqual({ ...source, sceneId: savedBranches.recovered.sceneId, revision: 0, title: savedBranches.recovered.title, createdAt: savedBranches.recovered.createdAt, updatedAt: savedBranches.recovered.updatedAt })
      expect(new Set([source.sceneId, savedBranches.copy.sceneId, savedBranches.recovered.sceneId]).size).toBe(3)
      expect(savedBranches.sceneCount).toBe(3); expect(savedBranches.uniqueAssets).toBe(sample === 'VIS-01' ? 15 : 13)
      expect(savedBranches.originalSnapshots).toEqual([1, 0]); expect(savedBranches.copySnapshots).toEqual([0]); expect(savedBranches.recoveredSnapshots).toEqual([0])
      await evidence(testInfo, `${sample.toLowerCase()}-cross-tab-recovery.json`, { sample, browserVersion: browser.version(), ...savedBranches })
    } finally {
      await Promise.all([page, second].map(tab => tab.evaluate(async () => { const branch = Reflect.get(window, '__b4StorageBranch') as Branch | undefined; if (branch) { await branch.workspace.flush().catch(() => {}); branch.repository.close() }; Reflect.deleteProperty(window, '__b4StorageBranch') })))
      await cleanup(page, name); await second.close()
    }
  })

  test(`${sample} cancellation, decoding and injected transaction failures preserve the current complete editable project`, async ({ page, browser }, testInfo) => {
    test.slow()
    const name = `sceneweave-b4-failures-${crypto.randomUUID()}`
    await page.goto('/'); await runtime(page)
    try {
      const result = await page.evaluate(async ({ databaseName, kind }) => {
        const samplePath = '/src/editor/v2/study-sample.ts', islandPath = '/src/editor/v2/island-sample.ts'
        const [{ createStudyProject }, { createIslandProject }] = await Promise.all([import(samplePath), import(islandPath)])
        const [study, island] = await Promise.all([createStudyProject(), createIslandProject()]) as CompleteProjectV2[]
        const input = kind === 'VIS-01' ? study : island, other = kind === 'VIS-01' ? island : study
        const { io, editor, storage } = Reflect.get(window, '__b4StorageRuntime') as Runtime
        const repository = new storage.SceneRepositoryV2(databaseName), workspace = new editor.WorkspaceV2(repository)
        Reflect.set(window, '__b4StorageBranch', { repository, workspace })
        await workspace.adoptNew(input)
        const command = (rotationDeg: number): SceneCommandV2 => ({ type: 'setSurfacePaint', kind: kind === 'VIS-01' ? 'room' : 'terrainArea', id: kind === 'VIS-01' ? 'study-room' : 'island-high', changes: { rotationDeg } })
        workspace.execute([command(17)]); workspace.undo(); await workspace.flush()
        const stateBefore = workspace.getState(), checkpointBefore = workspace.checkpoint(), current = stateBefore.project!, originalId = current.document.sceneId
        const db = (repository as unknown as { db: Dexie }).db, snapshots = db.table('snapshots'), assets = db.table('assetBlobs')
        const count = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.count()])))
        const countsBefore = await count(), errors: { case: string; name: string; message: string }[] = [], unchanged: string[] = []
        const reject = async (label: string, operation: () => Promise<unknown>) => {
          try { await operation(); throw new Error(`Expected ${label} to reject.`) } catch (error) {
            const failure = error as Error
            if (failure.message.startsWith('Expected ')) throw error
            errors.push({ case: label, name: failure.name, message: failure.message })
          }
          if (workspace.getState() !== stateBefore || workspace.checkpoint() !== checkpointBefore) throw new Error(`${label} consumed the current project or history.`)
          if (JSON.stringify(await count()) !== JSON.stringify(countsBefore)) throw new Error(`${label} left partial persistent writes.`)
          unchanged.push(label)
        }
        const packed = await io.exportProjectV2(current), cancelled = new AbortController(); cancelled.abort()
        await reject('cancel complete import', () => io.importProjectV2(packed, { signal: cancelled.signal }))
        await reject('cancel full save', () => repository.save(editor.forkProjectV2(other), null, { signal: cancelled.signal }))
        const bytes = new Uint8Array(await packed.arrayBuffer()), view = new DataView(bytes.buffer), payload = 30 + view.getUint16(26, true) + view.getUint16(28, true)
        bytes[payload] ^= 255
        await reject('damaged complete import', () => io.importProjectV2(new Blob([bytes])))
        const realDecode = window.createImageBitmap
        try {
          window.createImageBitmap = (async () => { throw new DOMException('B4 injected image decode fault', 'InvalidStateError') }) as typeof createImageBitmap
          await reject('image decode fault', () => io.importProjectV2(packed))
          await reject('stored project image decode fault', async () => { const loaded = await repository.load(originalId); if (loaded) await workspace.openPersisted(loaded) })
        } finally { window.createImageBitmap = realDecode }
        await reject('stored project missing bitmap', async () => {
          const hash = Object.keys(current.assets)[0], original = await assets.get(hash)
          await assets.delete(hash)
          try { const loaded = await repository.load(originalId); if (loaded) await workspace.openPersisted(loaded) }
          finally { await assets.put(original) }
        })
        const realSnapshotAdd = snapshots.add, realAssetAdd = assets.add
        try {
          snapshots.add = (async () => { throw new DOMException('B4 simulated quota transaction failure', 'QuotaExceededError') }) as unknown as typeof snapshots.add
          await reject('new project quota transaction rollback', () => workspace.adoptNew(editor.forkProjectV2(other)))
        } finally { snapshots.add = realSnapshotAdd }
        try {
          assets.add = (async () => { throw new Error('B4 injected resource write failure') }) as unknown as typeof assets.add
          await reject('new project resource write rollback', () => workspace.adoptNew(editor.forkProjectV2(other)))
        } finally { assets.add = realAssetAdd }
        const controller = new AbortController()
        try {
          assets.add = ((...args: Parameters<typeof realAssetAdd>) => realAssetAdd.apply(assets, args).then(value => { controller.abort(); return value })) as typeof assets.add
          await reject('cancel after first actual resource write', () => repository.save(editor.forkProjectV2(other), null, { signal: controller.signal }))
        } finally { assets.add = realAssetAdd }
        const storedBeforeFailure = (await repository.load(originalId))!.document
        workspace.execute([command(31)])
        const editBeforeFailure = workspace.getState().project!, revisionBeforeFailure = editBeforeFailure.document.revision, checkpointAtFailure = workspace.checkpoint()
        try {
          snapshots.add = (async () => { throw new DOMException('B4 simulated quota current save failure', 'QuotaExceededError') }) as unknown as typeof snapshots.add
          try { await workspace.flush(); throw new Error('Expected current save to reject.') } catch (error) { if ((error as Error).message.startsWith('Expected ')) throw error; errors.push({ case: 'current edited project quota save failure', name: (error as Error).name, message: (error as Error).message }) }
        } finally { snapshots.add = realSnapshotAdd }
        const failedStatus = workspace.getState().status
        const retainedAfterFailure = workspace.getState().project === editBeforeFailure && workspace.getState().project!.document.revision === revisionBeforeFailure && workspace.checkpoint() === checkpointAtFailure && workspace.getState().canUndo
        const storedAfterFailure = (await repository.load(originalId))!.document
        workspace.execute([command(43)])
        const continued = workspace.getState().project!, statusWhileEditing = workspace.getState().status
        const backup = await io.exportProjectV2(continued), restoredBackup = await io.importProjectV2(backup)
        const revisionBeforeRetry = continued.document.revision
        await workspace.retry()
        return { errors, unchanged, countsBefore, countsAfterRecovery: await count(), preservedUndoBeforeFailures: stateBefore.canUndo, preservedRedoBeforeFailures: stateBefore.canRedo,
          initialRevision: stateBefore.project!.document.revision, revisionBeforeFailure, retainedAfterFailure, failedStatus, storedBeforeFailure, storedAfterFailure,
          statusWhileEditing, backupBytes: backup.size, backupDocument: restoredBackup.document, continuedDocument: continued.document, retryRevisionUnchanged: workspace.getState().project!.document.revision === revisionBeforeRetry,
          storedAfterRetry: (await repository.load(originalId))!.document, finalStatus: workspace.getState().status, snapshotRevisions: (await repository.listSnapshots(originalId)).map(item => item.revision),
          simulatedQuotaFailure: true, actualQuotaExhaustionTested: false }
      }, { databaseName: name, kind: sample })
      expect(result.errors).toHaveLength(10)
      expect(result.errors.find(item => item.case === 'cancel complete import')?.name).toBe('AbortError')
      expect(result.errors.find(item => item.case === 'image decode fault')?.message).toContain('解码')
      expect(result.unchanged).toHaveLength(9); expect(result.preservedUndoBeforeFailures).toBe(false); expect(result.preservedRedoBeforeFailures).toBe(true)
      expect(result.initialRevision).toBe(2); expect(result.retainedAfterFailure).toBe(true); expect(result.failedStatus).toBe('error')
      expect(result.storedAfterFailure).toEqual(result.storedBeforeFailure); expect(result.storedAfterFailure.revision).toBe(2)
      expect(result.statusWhileEditing).toBe('error'); expect(result.backupDocument).toEqual(result.continuedDocument)
      expect(result.continuedDocument.revision).toBe(4); expect(result.retryRevisionUnchanged).toBe(true); expect(result.storedAfterRetry).toEqual(result.continuedDocument)
      expect(result.finalStatus).toBe('saved'); expect(result.snapshotRevisions).toEqual([4, 2, 0]); expect(result.actualQuotaExhaustionTested).toBe(false)
      await evidence(testInfo, `${sample.toLowerCase()}-failure-preservation.json`, { sample, browserVersion: browser.version(), ...result })
    } finally { await cleanup(page, name) }
  })
}
