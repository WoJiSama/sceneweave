import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type Dexie from 'dexie'
import type { CompleteProjectV2 } from '../src/io/v2/types'
import type { CompleteProjectV3 } from '../src/io/v3/types'
import type { SceneRepositoryV3 } from '../src/io/v3/storage'
import type { WorkspaceV3 } from '../src/editor/v3/workspace'

type Sample = 'VIS-01' | 'VIS-02'
interface Runtime {
  io1: typeof import('../src/io/project-file')
  io2: typeof import('../src/io/v2/project-file')
  io: typeof import('../src/io/v3/project-file')
  storage2: typeof import('../src/io/v2/storage')
  storage: typeof import('../src/io/v3/storage')
  migration: typeof import('../src/io/v3/migration')
  editor: typeof import('../src/editor/v3/workspace')
  layers: typeof import('../src/core/v3/layers')
  resources: typeof import('../src/io/v3/resources')
  zip: typeof import('../src/io/v3/zip')
  fflate: typeof import('fflate')
}
interface Branch { repository: SceneRepositoryV3; workspace: WorkspaceV3 }

async function evidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name)
  await writeFile(path, JSON.stringify(value, null, 2))
  await info.attach(name, { path, contentType: 'application/json' })
}

/** Preload only runtime modules, so subsequent complete-package work needs no catalog. */
async function runtime(page: Page) {
  await page.evaluate(async () => {
    const paths = ['/src/io/project-file.ts', '/src/io/v2/project-file.ts', '/src/io/v3/project-file.ts', '/src/io/v2/storage.ts',
      '/src/io/v3/storage.ts', '/src/io/v3/migration.ts', '/src/editor/v3/workspace.ts', '/src/core/v3/layers.ts',
      '/src/io/v3/resources.ts', '/src/io/v3/zip.ts', '/node_modules/.vite/deps/fflate.js']
    const [io1, io2, io, storage2, storage, migration, editor, layers, resources, zip, fflate] = await Promise.all(paths.map(path => import(path)))
    Reflect.set(window, '__c1cStorageRuntime', { io1, io2, io, storage2, storage, migration, editor, layers, resources, zip, fflate })
  })
}

async function closeBranch(page: Page) {
  if (page.isClosed()) return
  await page.evaluate(async () => {
    const branch = Reflect.get(window, '__c1cStorageBranch') as Branch | undefined
    if (branch) { await branch.workspace.flush().catch(() => {}); branch.repository.close() }
    Reflect.deleteProperty(window, '__c1cStorageBranch')
  })
}

async function deleteDatabases(page: Page, names: string[]) {
  if (page.isClosed()) return
  await closeBranch(page)
  await page.evaluate(async names => {
    for (const name of names) await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('C1c cleanup was blocked by an owned connection.'))
    })
  }, names)
}

for (const sample of ['VIS-01', 'VIS-02'] as const) {
  test(`${sample} strict v3 copy keeps exact v2 originals and reopens its complete layer package offline`, async ({ page, browser }, info) => {
    test.slow()
    const originalName = `c1c-v2-original-${crypto.randomUUID()}`, localName = `c1c-native-layers-${crypto.randomUUID()}`
    const freshName = `c1c-offline-layers-${crypto.randomUUID()}`
    await page.goto('/'); await runtime(page)
    let fresh: Page | undefined
    const freshContext = await browser.newContext(), blockedRequests: string[] = []
    try {
      const initial = await page.evaluate(async ({ kind, originalName, localName }) => {
        const h = Reflect.get(window, '__c1cStorageRuntime') as Runtime
        const samplePath = kind === 'VIS-01' ? '/src/editor/v2/study-sample.ts' : '/src/editor/v2/island-sample.ts'
        const fixture = await import(samplePath), source = await (kind === 'VIS-01' ? fixture.createStudyProject() : fixture.createIslandProject()) as CompleteProjectV2
        const sourceRepository = new h.storage2.SceneRepositoryV2(originalName), repository = new h.storage.SceneRepositoryV3(localName)
        try {
          await sourceRepository.save(source, null)
          source.document.revision = 4; source.document.title += ' · v2 retained revision'; await sourceRepository.save(source, 0)
          const before = structuredClone(source.document), generated = await h.io2.exportProjectV2(source)
          // Retain the supplied source encoding, not merely a new ZIP with equivalent JSON.
          const original = new Blob([h.fflate.zipSync(h.fflate.unzipSync(new Uint8Array(await generated.arrayBuffer())), { level: 0 }).slice().buffer])
          const originalBytes = new Uint8Array(await original.arrayBuffer()), originalHash = await h.resources.sha256Bytes(originalBytes)
          const project = await h.migration.createLayerProject(source, { original, now: '2026-10-21T12:00:00.000Z' })
          const migratedDocument = structuredClone(project.document), workspace = new h.editor.WorkspaceV3(repository)
          await workspace.adoptNew(project)
          const floorId = Object.keys(project.document.floors)[0], defaultLayer = Object.keys(project.document.userLayers)[0], layerId = 'c1c-storage-props'
          workspace.execute([{ type: 'createLayer', id: layerId, floorId, name: '道具与组合' }]); await workspace.flush()
          const groupId = kind === 'VIS-01' ? 'study-group' : 'island-trees'
          const move = h.layers.previewLayerMoveV3(workspace.getState().project!.document, [groupId], layerId)
          if (move.reason) throw new Error(move.reason)
          workspace.execute([{ type: 'moveEntitiesToLayer', ids: [groupId], layerId }]); await workspace.flush()
          workspace.execute([{ type: 'renameLayer', id: defaultLayer, name: '建筑与地形' }]); await workspace.flush()
          const current = workspace.getState().project!, loaded = (await repository.load(current.document.sceneId))!
          const oldSnapshot = (await repository.loadSnapshot(current.document.sceneId, 0))!, downloaded = (await h.migration.migrationOriginalV3(loaded))!
          const downloadedBytes = new Uint8Array(await downloaded.arrayBuffer())
          const decoded = []
          for (const [hash, asset] of Object.entries(loaded.assets)) {
            const bitmap = await createImageBitmap(asset.blob)
            decoded.push({ hash, actualHash: await h.resources.sha256Bytes(new Uint8Array(await asset.blob.arrayBuffer())), bytes: asset.blob.size, width: bitmap.width, height: bitmap.height })
            bitmap.close()
          }
          const packed = await h.io.exportProjectV3(loaded), zip = await h.zip.inspectZipV3(packed)
          const manifest = JSON.parse(new TextDecoder().decode(await zip.read('manifest.json'))), sceneText = new TextDecoder().decode(await zip.read('scene.json'))
          const reject = async (operation: () => Promise<unknown>) => { try { await operation() } catch (error) { return { name: (error as Error).name, message: (error as Error).message } }; throw new Error('A strict cross-version reader accepted the wrong container.') }
          const oldV1 = await reject(() => h.io1.readProjectV1(packed)), oldV2 = await reject(() => h.io2.importProjectV2(packed)), v3RejectV2 = await reject(() => h.io.importProjectV3(original))
          const changedSource = structuredClone(source); changedSource.document.title += ' mismatched complete content'
          const mismatchedCompleteSource = await reject(() => h.migration.createLayerProject(changedSource, { original }))
          const originalAfter = (await sourceRepository.load(source.document.sceneId))!.document
          const db = (repository as unknown as { db: Dexie }).db
          return { bytes: Array.from(new Uint8Array(await packed.arrayBuffer())), sourceDocument: before, originalAfter, migratedDocument,
            expectedDocument: loaded.document, bindings: loaded.licenseBindings, licenses: loaded.licenses, decoded, groupId, movedIds: move.ids, layerId,
            sourceUnchanged: JSON.stringify(source.document) === JSON.stringify(before), oldSnapshot: oldSnapshot.document,
            exactSourceBytes: downloadedBytes.length === originalBytes.length && downloadedBytes.every((value, index) => value === originalBytes[index]),
            snapshotOriginalHash: await h.resources.sha256Bytes(new Uint8Array(await oldSnapshot.migrationSource!.original.arrayBuffer())),
            originalHash, retainedSource: { ...loaded.migrationSource!, original: { size: downloaded.size, type: downloaded.type } },
            sourceSnapshots: (await sourceRepository.listSnapshots(source.document.sceneId)).map(value => value.revision),
            layerSnapshots: (await repository.listSnapshots(loaded.document.sceneId)).map(value => value.revision),
            databaseVersion: db.verno, tables: db.tables.map(table => table.name).sort(), packageBytes: packed.size,
            manifest, paths: [...zip.entries.keys()].sort(), packageOmitsLocalProvenance: !sceneText.includes('migrationSource') && !sceneText.includes('sourceHash'),
            oldV1, oldV2, v3RejectV2, mismatchedCompleteSource }
        } finally { sourceRepository.close(); repository.close() }
      }, { kind: sample, originalName, localName })
      expect(initial.originalAfter).toEqual(initial.sourceDocument); expect(initial.sourceUnchanged).toBe(true)
      expect(initial.migratedDocument.schemaVersion).toBe(3); expect(initial.migratedDocument.sceneId).not.toBe(initial.sourceDocument.sceneId); expect(initial.migratedDocument.revision).toBe(0)
      for (const key of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes', 'props', 'rooms', 'walls', 'openings', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'scatterGroups'] as const) expect(initial.migratedDocument[key]).toEqual(initial.sourceDocument[key])
      expect(initial.exactSourceBytes).toBe(true); expect(initial.snapshotOriginalHash).toBe(initial.originalHash)
      expect(initial.retainedSource).toMatchObject({ sourceSchemaVersion: 2, sourceSceneId: initial.sourceDocument.sceneId, sourceRevision: 4, sourceHash: initial.originalHash, migratorVersion: 'sceneweave-v2-v3@1', migratedAt: '2026-10-21T12:00:00.000Z' })
      expect(initial.sourceSnapshots).toEqual([4, 0]); expect(initial.layerSnapshots).toEqual([3, 2, 1, 0]); expect(initial.oldSnapshot).toEqual(initial.migratedDocument)
      expect(initial.movedIds.length).toBeGreaterThan(1)
      for (const id of initial.movedIds) expect(initial.expectedDocument.entityLayers[id]).toBe(initial.layerId)
      expect(initial.databaseVersion).toBe(1)
      expect(initial.tables).toEqual(['assetBlobs', 'licenseTexts', 'migrationSources', 'resourceBindings', 'scenes', 'snapshots'])
      expect(initial.decoded.length).toBe(sample === 'VIS-01' ? 15 : 13)
      expect(initial.decoded.every(asset => asset.hash === asset.actualHash && asset.width > 0 && asset.height > 0)).toBe(true)
      expect(initial.manifest).toMatchObject({ containerVersion: 3, documentSchemaVersion: 3, profile: 'm1-layers', packageMode: 'complete' })
      expect(initial.paths.every(path => path === 'manifest.json' || path === 'scene.json' || /^(?:assets|licenses)\//.test(path))).toBe(true)
      expect(initial.packageOmitsLocalProvenance).toBe(true); expect(initial.oldV1.message).toContain('工程文件无效'); expect(initial.oldV2.name).toBe('ProjectValidationErrorV2'); expect(initial.v3RejectV2.name).toBe('ProjectValidationErrorV3')
      expect(initial.mismatchedCompleteSource.message).toContain('完整工程内容不匹配')

      await freshContext.route(/\/(?:assets\/sceneweave-handdrawn|src\/editor\/v2\/(?:study|island)-sample)|(?:openai|anthropic)\.com/, route => { blockedRequests.push(route.request().url()); return route.abort() })
      fresh = await freshContext.newPage(); await fresh.goto('/'); await runtime(fresh); await freshContext.setOffline(true)
      const imported = await fresh.evaluate(async ({ bytes, databaseName }) => {
        const h = Reflect.get(window, '__c1cStorageRuntime') as Runtime, repository = new h.storage.SceneRepositoryV3(databaseName), workspace = new h.editor.WorkspaceV3(repository)
        Reflect.set(window, '__c1cStorageBranch', { repository, workspace })
        const initiallyEmpty = (await repository.list()).length === 0, candidate = await h.io.importProjectV3(new Blob([Uint8Array.from(bytes)]))
        const parsed = structuredClone(candidate.document), noLocalSourceInPackage = candidate.migrationSource === undefined
        await workspace.adoptNew(candidate)
        workspace.execute([{ type: 'renameLayer', id: Object.keys(parsed.userLayers)[0], name: '离线继续编辑' }]); await workspace.flush()
        return { initiallyEmpty, parsed, noLocalSourceInPackage, edited: workspace.getState().project!.document, offline: !navigator.onLine }
      }, { bytes: initial.bytes, databaseName: freshName })
      expect(imported.initiallyEmpty).toBe(true); expect(imported.parsed).toEqual(initial.expectedDocument); expect(imported.noLocalSourceInPackage).toBe(true); expect(imported.offline).toBe(true)
      await closeBranch(fresh)
      // Reload runtime online, then reopen only stored data offline. This does not assert PWA cold start.
      await freshContext.setOffline(false); await fresh.reload(); await runtime(fresh); await freshContext.setOffline(true)
      const reopened = await fresh.evaluate(async ({ databaseName, sceneId }) => {
        const h = Reflect.get(window, '__c1cStorageRuntime') as Runtime, repository = new h.storage.SceneRepositoryV3(databaseName), workspace = new h.editor.WorkspaceV3(repository)
        Reflect.set(window, '__c1cStorageBranch', { repository, workspace })
        const loaded = (await repository.load(sceneId))!, documentBefore = structuredClone(loaded.document)
        await workspace.openPersisted(loaded)
        workspace.execute([{ type: 'renameLayer', id: Object.keys(loaded.document.userLayers)[0], name: '离线重开后继续' }]); await workspace.flush()
        const current = workspace.getState().project!, packed = await h.io.exportProjectV3(current), checked = await h.io.importProjectV3(packed)
        const resources = []
        for (const [hash, asset] of Object.entries(loaded.assets)) { const bitmap = await createImageBitmap(asset.blob); resources.push({ hash, actualHash: await h.resources.sha256Bytes(new Uint8Array(await asset.blob.arrayBuffer())), width: bitmap.width, height: bitmap.height }); bitmap.close() }
        return { documentBefore, finalDocument: current.document, backupDocument: checked.document, resources, bindings: checked.licenseBindings, licenses: checked.licenses,
          sourceAbsent: loaded.migrationSource === undefined, snapshots: (await repository.listSnapshots(sceneId)).map(value => value.revision), offline: !navigator.onLine, status: workspace.getState().status }
      }, { databaseName: freshName, sceneId: initial.expectedDocument.sceneId })
      expect(reopened.documentBefore).toEqual(imported.edited); expect(reopened.finalDocument.revision).toBe(5); expect(reopened.backupDocument).toEqual(reopened.finalDocument)
      expect(reopened.bindings).toEqual(initial.bindings); expect(reopened.licenses).toEqual(initial.licenses); expect(reopened.sourceAbsent).toBe(true)
      expect(reopened.resources.map(value => value.hash).sort()).toEqual(initial.decoded.map(value => value.hash).sort())
      expect(reopened.resources.every(value => value.hash === value.actualHash && value.width > 0 && value.height > 0)).toBe(true)
      expect(reopened.snapshots).toEqual([5, 4, 3]); expect(reopened.status).toBe('saved'); expect(reopened.offline).toBe(true); expect(blockedRequests).toEqual([])
      const { bytes: _bytes, ...initialEvidence } = initial
      await evidence(info, `${sample.toLowerCase()}-native-v3-complete-migration-offline.json`, { browserVersion: browser.version(), sample, ...initialEvidence, imported, reopened,
        blockedCatalogOrModelRequests: blockedRequests, applicationRuntimeReloadedOnline: true, pwaColdStartTested: false })
    } finally {
      await freshContext.setOffline(false)
      if (fresh) await deleteDatabases(fresh, [freshName])
      await freshContext.close(); await deleteDatabases(page, [originalName, localName])
    }
  })

  test(`${sample} actual browser tabs preserve v3 layer CAS branches, conflict copies and complete recovery copies`, async ({ page, context, browser }, info) => {
    test.slow()
    const name = `c1c-layer-cas-${crypto.randomUUID()}`, second = await context.newPage()
    await page.goto('/'); await second.goto('/'); await runtime(page); await runtime(second)
    try {
      const initial = await page.evaluate(async ({ kind, databaseName }) => {
        const h = Reflect.get(window, '__c1cStorageRuntime') as Runtime, samplePath = kind === 'VIS-01' ? '/src/editor/v2/study-sample.ts' : '/src/editor/v2/island-sample.ts'
        const fixture = await import(samplePath), source = await (kind === 'VIS-01' ? fixture.createStudyProject() : fixture.createIslandProject()) as CompleteProjectV2
        const candidate = await h.migration.createLayerProject(source), repository = new h.storage.SceneRepositoryV3(databaseName), workspace = new h.editor.WorkspaceV3(repository)
        Reflect.set(window, '__c1cStorageBranch', { repository, workspace }); await workspace.adoptNew(candidate)
        return { document: candidate.document, sourceHash: candidate.migrationSource!.sourceHash, sourceSceneId: source.document.sceneId }
      }, { kind: sample, databaseName: name })
      await second.evaluate(async ({ databaseName, sceneId }) => {
        const h = Reflect.get(window, '__c1cStorageRuntime') as Runtime, repository = new h.storage.SceneRepositoryV3(databaseName), workspace = new h.editor.WorkspaceV3(repository)
        const project = await repository.load(sceneId); if (!project) throw new Error('Second tab could not load native v3 project.')
        Reflect.set(window, '__c1cStorageBranch', { repository, workspace }); await workspace.openPersisted(project)
      }, { databaseName: name, sceneId: initial.document.sceneId })
      const winner = await page.evaluate(async () => {
        const { workspace } = Reflect.get(window, '__c1cStorageBranch') as Branch, layerId = Object.keys(workspace.getState().project!.document.userLayers)[0]
        workspace.execute([{ type: 'renameLayer', id: layerId, name: '第一标签保存' }]); await workspace.flush()
        return workspace.getState().project!.document
      })
      const result = await second.evaluate(async () => {
        const h = Reflect.get(window, '__c1cStorageRuntime') as Runtime, { repository, workspace } = Reflect.get(window, '__c1cStorageBranch') as Branch
        const originalId = workspace.getState().project!.document.sceneId, floorId = Object.keys(workspace.getState().project!.document.floors)[0]
        workspace.execute([{ type: 'createLayer', id: 'c1c-losing-layer', floorId, name: '第二标签分支' }])
        let conflict: { name: string; revision: number | null } | null = null
        try { await workspace.flush() } catch (error) { const failure = error as Error & { currentRevision: number | null }; conflict = { name: failure.name, revision: failure.currentRevision } }
        const conflictedStatus = workspace.getState().status
        workspace.execute([{ type: 'renameLayer', id: 'c1c-losing-layer', name: '冲突后继续编辑' }])
        const branch = structuredClone(workspace.getState().project!.document)
        await workspace.saveAsCopy()
        const copy = workspace.getState().project!, storedCopy = (await repository.load(copy.document.sceneId))!
        const original = (await repository.load(originalId))!, historical = (await repository.loadSnapshot(originalId, 0))!
        await workspace.adoptNew(h.editor.forkProjectV3(historical))
        const recovery = workspace.getState().project!, db = (repository as unknown as { db: Dexie }).db
        const hashes = []
        for (const candidate of [original, storedCopy, recovery]) hashes.push({ sceneId: candidate.document.sceneId, sourceHash: candidate.migrationSource!.sourceHash,
          actualOriginalHash: await h.resources.sha256Bytes(new Uint8Array(await (await h.migration.migrationOriginalV3(candidate))!.arrayBuffer())) })
        return { conflict, conflictedStatus, branch, copy: copy.document, storedCopy: storedCopy.document, original: original.document, recovery: recovery.document,
          storedOriginal: (await repository.load(originalId))!.document, hashes, count: (await repository.list()).length, uniqueAssets: await db.table('assetBlobs').count(),
          originalSnapshots: (await repository.listSnapshots(originalId)).map(value => value.revision), copySnapshots: (await repository.listSnapshots(copy.document.sceneId)).map(value => value.revision), recoverySnapshots: (await repository.listSnapshots(recovery.document.sceneId)).map(value => value.revision) }
      })
      expect(result.conflict).toEqual({ name: 'ConflictErrorV3', revision: 1 }); expect(result.conflictedStatus).toBe('conflict'); expect(result.branch.revision).toBe(2)
      expect(result.original).toEqual(winner); expect(result.storedOriginal).toEqual(winner); expect(result.copy.revision).toBe(0); expect(result.storedCopy).toEqual(result.copy)
      expect(result.copy).toEqual({ ...result.branch, sceneId: result.copy.sceneId, revision: 0, title: result.copy.title, createdAt: result.copy.createdAt, updatedAt: result.copy.updatedAt })
      expect(result.recovery).toEqual({ ...initial.document, sceneId: result.recovery.sceneId, revision: 0, title: result.recovery.title, createdAt: result.recovery.createdAt, updatedAt: result.recovery.updatedAt })
      expect(new Set([initial.sourceSceneId, initial.document.sceneId, result.copy.sceneId, result.recovery.sceneId]).size).toBe(4)
      expect(result.hashes.every(value => value.sourceHash === initial.sourceHash && value.actualOriginalHash === initial.sourceHash)).toBe(true)
      expect(result.count).toBe(3); expect(result.uniqueAssets).toBe(sample === 'VIS-01' ? 15 : 13)
      expect(result.originalSnapshots).toEqual([1, 0]); expect(result.copySnapshots).toEqual([0]); expect(result.recoverySnapshots).toEqual([0])
      await evidence(info, `${sample.toLowerCase()}-native-v3-cross-tab-cas.json`, { sample, browserVersion: browser.version(), initial, winner, ...result })
    } finally { await closeBranch(page); await closeBranch(second); await deleteDatabases(page, [name]); await second.close() }
  })
}

test('native v3 migration chain preserves independently downloadable M0 and v2 original bytes', async ({ page, browser }, info) => {
  const name = `c1c-migration-chain-${crypto.randomUUID()}`
  await page.goto('/'); await runtime(page)
  try {
    const result = await page.evaluate(async databaseName => {
      const h = Reflect.get(window, '__c1cStorageRuntime') as Runtime, seedPath = '/src/core/seed.ts', migrationPath = '/src/core/v2/migration.ts'
      const [seed, v2Migration] = await Promise.all([import(seedPath), import(migrationPath)])
      const originalDocument = seed.createHouse('c1c-original-m0'), originalV1 = await h.io1.exportProject(originalDocument), originalV1Bytes = new Uint8Array(await originalV1.arrayBuffer())
      const source: CompleteProjectV2 = { document: v2Migration.migrateSceneV1(originalDocument, { sceneId: 'c1c-intermediate-v2', now: '2026-10-20T12:00:00.000Z' }), assets: {}, licenses: {}, licenseBindings: [],
        migrationSource: { sourceSchemaVersion: 1, sourceSceneId: originalDocument.sceneId, sourceRevision: originalDocument.revision, sourceHash: await h.resources.sha256Bytes(originalV1Bytes), migratorVersion: 'sceneweave-v1-v2@1', migratedAt: '2026-10-20T12:00:00.000Z', original: originalV1 } }
      const originalV2 = await h.io2.exportProjectV2(source), originalV2Bytes = new Uint8Array(await originalV2.arrayBuffer()), candidate = await h.migration.createLayerProject(source, { original: originalV2 })
      const repository = new h.storage.SceneRepositoryV3(databaseName)
      try {
        await repository.save(candidate, null); const loaded = (await repository.load(candidate.document.sceneId))!, localV1 = (await h.migration.migrationOriginalV3(loaded, 1))!, localV2 = (await h.migration.migrationOriginalV3(loaded, 2))!
        const v1 = new Uint8Array(await localV1.arrayBuffer()), v2 = new Uint8Array(await localV2.arrayBuffer()), packed = await h.io.exportProjectV3(loaded)
        const zip = await h.zip.inspectZipV3(packed), roundtrip = await h.io.importProjectV3(packed)
        return { originalSceneId: originalDocument.sceneId, sourceSceneId: source.document.sceneId, targetSceneId: loaded.document.sceneId,
          exactV1: v1.length === originalV1Bytes.length && v1.every((value, index) => value === originalV1Bytes[index]), exactV2: v2.length === originalV2Bytes.length && v2.every((value, index) => value === originalV2Bytes[index]),
          localV1Hash: await h.resources.sha256Bytes(v1), expectedV1Hash: source.migrationSource!.sourceHash, localV2Hash: await h.resources.sha256Bytes(v2), expectedV2Hash: candidate.migrationSource!.sourceHash,
          sourceMetadata: { ...loaded.migrationSource!, original: { size: localV2.size }, previousSource: { ...loaded.migrationSource!.previousSource!, original: { size: localV1.size } } },
          exportedPaths: [...zip.entries.keys()].sort(), packageSourceAbsent: roundtrip.migrationSource === undefined, documentExact: JSON.stringify(roundtrip.document) === JSON.stringify(loaded.document) }
      } finally { repository.close() }
    }, name)
    expect(new Set([result.originalSceneId, result.sourceSceneId, result.targetSceneId]).size).toBe(3); expect(result.exactV1).toBe(true); expect(result.exactV2).toBe(true)
    expect(result.localV1Hash).toBe(result.expectedV1Hash); expect(result.localV2Hash).toBe(result.expectedV2Hash); expect(result.sourceMetadata.previousSource.sourceSceneId).toBe(result.originalSceneId)
    expect(result.exportedPaths).toEqual(['manifest.json', 'scene.json']); expect(result.packageSourceAbsent).toBe(true); expect(result.documentExact).toBe(true)
    await evidence(info, 'native-v3-m0-v2-original-chain.json', { browserVersion: browser.version(), ...result })
  } finally { await deleteDatabases(page, [name]) }
})

test('native v3 failures retain current layer edits, exact sources and every atomic storage table', async ({ page, browser }, info) => {
  test.slow()
  const name = `c1c-native-failures-${crypto.randomUUID()}`
  await page.goto('/'); await runtime(page)
  try {
    const result = await page.evaluate(async databaseName => {
      const h = Reflect.get(window, '__c1cStorageRuntime') as Runtime, studyPath = '/src/editor/v2/study-sample.ts', islandPath = '/src/editor/v2/island-sample.ts'
      const [study, island] = await Promise.all([import(studyPath), import(islandPath)])
      const source = await study.createStudyProject() as CompleteProjectV2, candidate = await h.migration.createLayerProject(source)
      const other = await h.migration.createLayerProject(await island.createIslandProject() as CompleteProjectV2), repository = new h.storage.SceneRepositoryV3(databaseName), workspace = new h.editor.WorkspaceV3(repository)
      Reflect.set(window, '__c1cStorageBranch', { repository, workspace }); await workspace.adoptNew(candidate)
      const layerId = Object.keys(candidate.document.userLayers)[0]
      workspace.execute([{ type: 'renameLayer', id: layerId, name: '可撤销的图层修改' }]); workspace.undo(); await workspace.flush()
      const before = workspace.getState(), checkpoint = workspace.checkpoint(), originalId = before.project!.document.sceneId
      const db = (repository as unknown as { db: Dexie }).db, snapshots = db.table('snapshots'), assets = db.table('assetBlobs'), sources = db.table('migrationSources')
      const counts = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.count()])))
      const countsBefore = await counts(), errors: { case: string; name: string; message: string }[] = [], unchanged: string[] = []
      const reject = async (label: string, operation: () => Promise<unknown>) => {
        try { await operation(); throw new Error(`Expected ${label} to reject.`) } catch (error) {
          const failure = error as Error; if (failure.message.startsWith('Expected ')) throw error
          errors.push({ case: label, name: failure.name, message: failure.message })
        }
        if (workspace.getState() !== before || workspace.checkpoint() !== checkpoint) throw new Error(`${label} consumed the current project or history.`)
        if (JSON.stringify(await counts()) !== JSON.stringify(countsBefore)) throw new Error(`${label} left partial persistent writes.`)
        unchanged.push(label)
      }
      const packed = await h.io.exportProjectV3(before.project!), cancelled = new AbortController(); cancelled.abort()
      await reject('cancel complete v3 import', () => h.io.importProjectV3(packed, { signal: cancelled.signal }))
      await reject('cancel native v3 save', () => repository.save(other, null, { signal: cancelled.signal }))
      const damaged = new Uint8Array(await packed.arrayBuffer()), view = new DataView(damaged.buffer), payload = 30 + view.getUint16(26, true) + view.getUint16(28, true)
      damaged[payload] ^= 255
      await reject('damaged complete v3 ZIP', () => h.io.importProjectV3(new Blob([damaged])))
      const nativeDecode = window.createImageBitmap
      try {
        window.createImageBitmap = (async () => { throw new DOMException('C1c injected decoder fault', 'InvalidStateError') }) as typeof createImageBitmap
        await reject('actual v3 decoder rejection', () => h.io.importProjectV3(packed))
        await reject('stored native v3 decoder rejection', async () => { const loaded = await repository.load(originalId); if (loaded) await workspace.openPersisted(loaded) })
      } finally { window.createImageBitmap = nativeDecode }
      const sourceRecord = await sources.get(originalId)
      await reject('missing exact migration original', async () => {
        await sources.delete(originalId)
        try { await repository.load(originalId) } finally { await sources.put(sourceRecord) }
      })
      await reject('corrupt retained original cannot be omitted from save', async () => {
        await sources.update(originalId, { sourceRevision: 999 })
        const next = structuredClone(before.project!) as CompleteProjectV3; next.document.revision++; delete next.migrationSource
        try { await repository.save(next, before.project!.document.revision) } finally { await sources.put(sourceRecord) }
      })
      const realSnapshotAdd = snapshots.add, realAssetAdd = assets.add
      try {
        snapshots.add = (async () => { throw new DOMException('C1c injected final snapshot write failure', 'QuotaExceededError') }) as unknown as typeof snapshots.add
        await reject('final native write rolls back new resources and original', () => workspace.adoptNew(h.editor.forkProjectV3(other)))
      } finally { snapshots.add = realSnapshotAdd }
      const abortDuringWrite = new AbortController()
      try {
        assets.add = ((...args: Parameters<typeof realAssetAdd>) => realAssetAdd.apply(assets, args).then(value => { abortDuringWrite.abort(); return value })) as typeof assets.add
        await reject('cancel after actual native resource write', () => repository.save(h.editor.forkProjectV3(other), null, { signal: abortDuringWrite.signal }))
      } finally { assets.add = realAssetAdd }
      const countsAfterFailures = await counts(), persistedBefore = (await repository.load(originalId))!.document
      workspace.execute([{ type: 'renameLayer', id: layerId, name: '保存失败仍保留编辑' }])
      const edited = workspace.getState().project!, editedCheckpoint = workspace.checkpoint()
      try {
        snapshots.add = (async () => { throw new DOMException('C1c injected edited save failure', 'QuotaExceededError') }) as unknown as typeof snapshots.add
        try { await workspace.flush(); throw new Error('Expected current save to reject.') } catch (error) {
          const failure = error as Error; if (failure.message.startsWith('Expected ')) throw error
          errors.push({ case: 'current layer save failure', name: failure.name, message: failure.message })
        }
      } finally { snapshots.add = realSnapshotAdd }
      const failedStatus = workspace.getState().status, keptEditing = workspace.getState().project === edited && workspace.checkpoint() === editedCheckpoint && workspace.getState().canUndo
      const persistedAfter = (await repository.load(originalId))!.document
      workspace.execute([{ type: 'renameLayer', id: layerId, name: '失败后继续的图层修改' }])
      const continued = workspace.getState().project!, statusWhileEditing = workspace.getState().status, backup = await h.io.exportProjectV3(continued), restoredBackup = await h.io.importProjectV3(backup)
      await workspace.retry()
      const final = (await repository.load(originalId))!, original = (await h.migration.migrationOriginalV3(final))!
      return { errors, unchanged, countsBefore, countsAfterFailures, countsAfterRetry: await counts(), redoPreservedBeforeFailures: before.canRedo, initialRevision: before.project!.document.revision,
        persistedBefore, persistedAfter, editedRevision: edited.document.revision, keptEditing, failedStatus, statusWhileEditing, continuedDocument: continued.document, backupDocument: restoredBackup.document,
        finalDocument: final.document, finalStatus: workspace.getState().status, snapshots: (await repository.listSnapshots(originalId)).map(value => value.revision), sourceHash: final.migrationSource!.sourceHash,
        actualOriginalHash: await h.resources.sha256Bytes(new Uint8Array(await original.arrayBuffer())), expectedOriginalHash: candidate.migrationSource!.sourceHash,
        simulatedQuotaFailure: true, actualQuotaExhaustionTested: false }
    }, name)
    expect(result.errors).toHaveLength(10); expect(result.unchanged).toHaveLength(9); expect(result.redoPreservedBeforeFailures).toBe(true)
    expect(result.errors.find(value => value.case === 'cancel complete v3 import')?.name).toBe('AbortError')
    expect(result.errors.find(value => value.case === 'actual v3 decoder rejection')?.name).toBe('ProjectValidationErrorV3')
    expect(result.errors.find(value => value.case === 'missing exact migration original')?.message).toContain('迁移原件缺失')
    expect(result.errors.find(value => value.case.startsWith('corrupt retained'))?.message).toContain('完整原件不匹配')
    expect(result.countsAfterFailures).toEqual(result.countsBefore)
    expect(result.countsAfterRetry).toEqual({ ...result.countsBefore, snapshots: 3, resourceBindings: 3 })
    expect(result.initialRevision).toBe(2); expect(result.editedRevision).toBe(3)
    expect(result.persistedAfter).toEqual(result.persistedBefore); expect(result.keptEditing).toBe(true); expect(result.failedStatus).toBe('error'); expect(result.statusWhileEditing).toBe('error')
    expect(result.continuedDocument.revision).toBe(4); expect(result.backupDocument).toEqual(result.continuedDocument); expect(result.finalDocument).toEqual(result.continuedDocument)
    expect(result.finalStatus).toBe('saved'); expect(result.snapshots).toEqual([4, 2, 0]); expect(result.sourceHash).toBe(result.expectedOriginalHash); expect(result.actualOriginalHash).toBe(result.expectedOriginalHash)
    expect(result.actualQuotaExhaustionTested).toBe(false)
    await evidence(info, 'native-v3-failure-preservation.json', { browserVersion: browser.version(), ...result })
  } finally { await deleteDatabases(page, [name]) }
})
