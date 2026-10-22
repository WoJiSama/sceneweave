import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { CompleteProjectV2 } from '../src/io/v2/types'
import type { CompleteProjectV3 } from '../src/io/v3/types'
import type { CompleteProjectV4 } from '../src/io/v4/types'
import type { SceneRepositoryV4 } from '../src/io/v4/storage'
import type { WorkspaceV4 } from '../src/editor/v4/workspace'

interface Runtime {
  io: typeof import('../src/io/v4/project-file')
  io3: typeof import('../src/io/v3/project-file')
  migration: typeof import('../src/io/v4/migration')
  migration3: typeof import('../src/io/v3/migration')
  storage: typeof import('../src/io/v4/storage')
  editor: typeof import('../src/editor/v4/workspace')
  hash: typeof import('../src/io/v3/resources')
  render: typeof import('../src/render/v3/renderer')
  fixtures: typeof import('../src/core/v3/test-fixtures')
  identity: typeof import('../src/core/v4/identity')
}
interface Branch { repository: SceneRepositoryV4; workspace: WorkspaceV4 }
async function runtime(page: Page) {
  await page.evaluate(async () => {
    const paths = ['/src/io/v4/project-file.ts', '/src/io/v3/project-file.ts', '/src/io/v4/migration.ts', '/src/io/v3/migration.ts',
      '/src/io/v4/storage.ts', '/src/editor/v4/workspace.ts', '/src/io/v3/resources.ts', '/src/render/v3/renderer.ts',
      '/src/core/v3/test-fixtures.ts', '/src/core/v4/identity.ts']
    const [io, io3, migration, migration3, storage, editor, hash, render, fixtures, identity] = await Promise.all(paths.map(path => import(path)))
    Reflect.set(window, '__c1dStorageRuntime', { io, io3, migration, migration3, storage, editor, hash, render, fixtures, identity })
  })
}
async function evidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name)
  await writeFile(path, JSON.stringify(value, null, 2))
  await info.attach(name, { path, contentType: 'application/json' })
}
async function close(page: Page) {
  if (page.isClosed()) return
  await page.evaluate(async () => {
    const branch = Reflect.get(window, '__c1dBranch') as Branch | undefined
    if (branch) { await branch.workspace.flush().catch(() => {}); branch.repository.close() }
    Reflect.deleteProperty(window, '__c1dBranch')
  })
}

for (const kind of ['study', 'island'] as const) {
  test(`${kind} complete named history reopens offline and restores a deleted prop without replacing later edits`, async ({ page, browser }, info) => {
    test.slow()
    await page.goto('/'); await runtime(page)
    const databaseName = `c1d-${kind}-${crypto.randomUUID()}`, freshName = `c1d-offline-${kind}-${crypto.randomUUID()}`
    const initial = await page.evaluate(async ({ kind, databaseName }) => {
      const h = Reflect.get(window, '__c1dStorageRuntime') as Runtime
      const fixture = await import(kind === 'study' ? '/src/editor/v2/study-sample.ts' : '/src/editor/v2/island-sample.ts')
      const source = await (kind === 'study' ? fixture.createStudyProject() : fixture.createIslandProject()) as CompleteProjectV2
      const v3 = await h.migration3.createLayerProject(source) as CompleteProjectV3
      const originalDocument = JSON.stringify(v3.document)
      const original = await h.io3.exportProjectV3(v3), originalBytes = new Uint8Array(await original.arrayBuffer())
      const candidate = await h.migration.migrateProjectV3ToV4(v3, { original }) as CompleteProjectV4
      const repository = new h.storage.SceneRepositoryV4(databaseName), workspace = new h.editor.WorkspaceV4(repository)
      Reflect.set(window, '__c1dBranch', { repository, workspace }); await workspace.adoptNew(candidate)
      const id = kind === 'study' ? 'study-shelf' : 'island-rock-1'
      // Select a real independent prop from the persisted fixture rather than using an unsupported group member.
      const grouped = new Set([...Object.values(candidate.document.prefabInstances), ...Object.values(candidate.document.scatterGroups)]
        .flatMap(group => Object.values(group.members).map(member => member.propId)))
      const anchored = new Set(Object.values(candidate.document.notes).flatMap(note => note.anchor.type === 'entity' ? [note.anchor.entityId] : []))
      const propId = candidate.document.props[id] && !grouped.has(id) && !anchored.has(id) ? id
        : Object.keys(candidate.document.props).find(id => !grouped.has(id) && !anchored.has(id) && !candidate.document.props[id].editLocked)!
      if (!propId) throw new Error('No independent fixture prop for C1d history verification.')
      const named = await workspace.createNamedSnapshot('布景初稿'), before = structuredClone(candidate.document.props[propId])
      workspace.updateProp(propId, { rotationDeg: (before.rotationDeg + 25) % 360 }); await workspace.flush()
      const preview = await workspace.prepareRestore(named.id, { ids: [propId], mode: 'transform' })
      const protection = await workspace.applyRestore(preview); await workspace.flush()
      workspace.execute([{ type: 'deleteProp', id: propId }]); await workspace.flush()
      const laterLayerId = `later-${kind}`
      workspace.execute([{ type: 'createLayer', id: laterLayerId, floorId: before.floorId, name: '快照后的布景' }]); await workspace.flush()
      const current = workspace.getState().project!, retained = (await h.migration.migrationOriginalV4(current, 3))!
      const actualOriginal = new Uint8Array(await retained.arrayBuffer())
      const entries = await repository.listNamedSnapshots(current.document.sceneId)
      const snapshots = await Promise.all(entries.map(async entry => (await repository.loadNamedSnapshot(entry.id, current.document.sceneId))!))
      const packed = await h.io.exportHistoryArchiveV4({ project: current, snapshots })
      const complete = await h.io.importProjectV4(await h.io.exportProjectV4(current))
      let oldReaderRejected = false
      try { await h.io3.importProjectV3(packed) } catch { oldReaderRejected = true }
      return { bytes: Array.from(new Uint8Array(await packed.arrayBuffer())), sourceSceneId: v3.document.sceneId, sceneId: current.document.sceneId,
        propId, before, namedId: named.id, laterLayerId, revision: current.document.revision, entries,
        protectionKind: protection.kind, completeHasIdentity: !!complete.historyIdentity,
        sourceUnchanged: JSON.stringify(v3.document) === originalDocument,
        originalExact: actualOriginal.length === originalBytes.length && actualOriginal.every((byte, index) => byte === originalBytes[index]),
        currentWithoutDeleted: !current.document.props[propId], oldReaderRejected, packageBytes: packed.size }
    }, { kind, databaseName })
    expect(initial.originalExact).toBe(true); expect(initial.sourceUnchanged).toBe(true); expect(initial.currentWithoutDeleted).toBe(true)
    expect(initial.protectionKind).toBe('protection'); expect(initial.entries).toHaveLength(2)
    expect(initial.oldReaderRejected).toBe(true); expect(initial.completeHasIdentity).toBe(true)

    const freshContext = await browser.newContext(), fresh = await freshContext.newPage(), externalRequests: string[] = []
    try {
      await fresh.goto('/'); await runtime(fresh)
      await freshContext.route(/\/(?:assets\/sceneweave-handdrawn|src\/editor\/v2\/(?:study|island)-sample)|(?:openai|anthropic)\.com/, route => {
        externalRequests.push(route.request().url()); return route.abort()
      })
      await freshContext.setOffline(true)
      const restored = await fresh.evaluate(async ({ bytes, name, propId, namedId, laterLayerId }) => {
        const h = Reflect.get(window, '__c1dStorageRuntime') as Runtime, repository = new h.storage.SceneRepositoryV4(name), workspace = new h.editor.WorkspaceV4(repository)
        Reflect.set(window, '__c1dBranch', { repository, workspace })
        const archive = await h.io.importHistoryArchiveV4(new Blob([Uint8Array.from(bytes)])), empty = (await repository.list()).length === 0
        await workspace.adoptArchive(archive)
        const forkId = workspace.getState().project!.document.sceneId
        const loaded = (await repository.load(forkId))!
        const source = (await repository.loadNamedSnapshot(namedId, forkId))!
        const preview = await workspace.prepareRestore(namedId, { ids: [propId], mode: 'entity' })
        const oldRevision = loaded.document.revision
        await workspace.applyRestore(preview); await workspace.flush()
        const current = workspace.getState().project!, decoded = []
        for (const [hash, asset] of Object.entries(current.assets)) {
          const bitmap = await createImageBitmap(asset.blob)
          decoded.push({ hash, actualHash: await h.hash.sha256Bytes(new Uint8Array(await asset.blob.arrayBuffer())), width: bitmap.width, height: bitmap.height })
          bitmap.close()
        }
        workspace.undo(); await workspace.flush()
        const undo = workspace.getState().project!.document
        workspace.redo(); await workspace.flush()
        const reopened = (await repository.load(forkId))!
        return { empty, forkId, sourceHash: source.contentHash, originalHash: archive.snapshots.find(value => value.id === namedId)!.contentHash,
          oldRevision, restoredRevision: current.document.revision, prop: current.document.props[propId], laterLayer: current.document.userLayers[laterLayerId],
          undoRevision: undo.revision, undoDeleted: !undo.props[propId], reopenedRevision: reopened.document.revision, reopenedProp: reopened.document.props[propId],
          named: await repository.listNamedSnapshots(forkId), decoded, offline: !navigator.onLine, status: workspace.getState().status }
      }, { bytes: initial.bytes, name: freshName, propId: initial.propId, namedId: initial.namedId, laterLayerId: initial.laterLayerId })
      expect(restored.empty).toBe(true); expect(restored.forkId).not.toBe(initial.sceneId)
      expect(restored.sourceHash).toBe(restored.originalHash); expect(restored.prop).toEqual(initial.before)
      expect(restored.laterLayer.name).toBe('快照后的布景'); expect(restored.restoredRevision).toBe(restored.oldRevision + 1)
      expect(restored.undoDeleted).toBe(true); expect(restored.undoRevision).toBe(restored.restoredRevision + 1)
      expect(restored.reopenedRevision).toBe(restored.undoRevision + 1); expect(restored.reopenedProp).toEqual(initial.before)
      expect(restored.named.filter(value => value.kind === 'protection')).toHaveLength(2)
      expect(restored.decoded.length).toBeGreaterThan(0); expect(restored.decoded.every(asset => asset.hash === asset.actualHash && asset.width > 0 && asset.height > 0)).toBe(true)
      expect(restored.offline).toBe(true); expect(restored.status).toBe('saved'); expect(externalRequests).toEqual([])
      const { bytes: _bytes, ...facts } = initial
      await evidence(info, `${kind}-c1d-offline-history.json`, { browserVersion: browser.version(), ...facts, restored, externalRequests, runtimePreloadedOnline: true, pwaColdStartTested: false })
    } finally { await close(fresh); await freshContext.close(); await close(page) }
  })
}

test('actual tabs reject stale history metadata and scene CAS while preserving both branches', async ({ page, context, browser }, info) => {
  test.slow()
  const second = await context.newPage(), databaseName = `c1d-tabs-${crypto.randomUUID()}`
  await page.goto('/'); await second.goto('/'); await runtime(page); await runtime(second)
  try {
    const initial = await page.evaluate(async name => {
      const h = Reflect.get(window, '__c1dStorageRuntime') as Runtime
      const document = h.fixtures.layerSceneV3()
      document.assets = {}; document.propDefinitions = {}
      const project: CompleteProjectV4 = { document, historyIdentity: h.identity.createHistoryIdentityV4(document), assets: {}, licenses: {}, licenseBindings: [] }
      const repository = new h.storage.SceneRepositoryV4(name), workspace = new h.editor.WorkspaceV4(repository)
      await workspace.adoptNew(project)
      Reflect.set(window, '__c1dBranch', { repository, workspace })
      const named = await workspace.createNamedSnapshot('同标签基线')
      return { sceneId: document.sceneId, snapshotId: named.id, hash: named.contentHash, metadataVersion: (await repository.usage(document.sceneId)).metadataVersion }
    }, databaseName)
    await second.evaluate(async ({ name, sceneId }) => {
      const h = Reflect.get(window, '__c1dStorageRuntime') as Runtime, repository = new h.storage.SceneRepositoryV4(name), workspace = new h.editor.WorkspaceV4(repository)
      await workspace.openPersisted((await repository.load(sceneId))!)
      Reflect.set(window, '__c1dBranch', { repository, workspace })
    }, { name: databaseName, sceneId: initial.sceneId })
    await page.evaluate(async initial => {
      const { repository, workspace } = Reflect.get(window, '__c1dBranch') as Branch
      await repository.renameNamedSnapshot(initial.snapshotId, '另一标签已命名', initial.hash, initial.metadataVersion, initial.sceneId)
      workspace.updateProp('item', { rotationDeg: 45 }); await workspace.flush()
    }, initial)
    const result = await second.evaluate(async initial => {
      const { repository, workspace } = Reflect.get(window, '__c1dBranch') as Branch
      let metadataError = ''
      try { await repository.deleteNamedSnapshot(initial.snapshotId, initial.hash, initial.metadataVersion, initial.sceneId) } catch (error) { metadataError = (error as Error).message }
      workspace.updateProp('item', { rotationDeg: 90 })
      let conflict = ''
      try { await workspace.flush() } catch (error) { conflict = (error as Error).name }
      const branch = structuredClone(workspace.getState().project!.document), durable = (await repository.load(initial.sceneId))!.document
      await workspace.saveAsCopy()
      const copied = workspace.getState().project!, saved = (await repository.load(copied.document.sceneId))!
      return { metadataError, conflict, branch, durable, copied: saved.document, named: await repository.listNamedSnapshots(initial.sceneId) }
    }, initial)
    expect(result.metadataError.length).toBeGreaterThan(0); expect(result.conflict).toBe('ConflictErrorV4')
    expect(result.branch.props.item.rotationDeg).toBe(90); expect(result.durable.props.item.rotationDeg).toBe(45)
    expect(result.copied.sceneId).not.toBe(initial.sceneId); expect(result.copied.props.item.rotationDeg).toBe(90)
    expect(result.named).toHaveLength(1); expect(result.named[0].name).toBe('另一标签已命名')
    await evidence(info, 'c1d-two-tab-cas.json', { browserVersion: browser.version(), ...initial, ...result })
  } finally { await close(second); await second.close(); await close(page) }
})
