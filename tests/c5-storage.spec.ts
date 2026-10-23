import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { CompositionCommandV6 } from '../src/core/v6/types'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'
import type { SceneRepositoryV6 } from '../src/io/v6/storage'

type Description = Awaited<ReturnType<typeof import('./c4-fixtures')['describeC4Project']>>
type NativeDev = {
  workspace: WorkspaceV6
  repository: SceneRepositoryV6
  databaseName: string
  io: typeof import('../src/io/v6/project-file')
  fixture: typeof import('./c5-storage-fixtures')
  describe: typeof import('./c4-fixtures')['describeC4Project']
}

/** Dev modules drive the domain; every save, image decode and byte check is native in Chromium. */
async function connect(page: Page, databaseName: string, options: { sceneId?: string; empty?: boolean } = {}) {
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  return page.evaluate(async ({ databaseName, options }) => {
    const storagePath = '/src/io/v6/storage.ts', workspacePath = '/src/editor/v6/workspace.ts'
    const fixturePath = '/tests/c5-storage-fixtures.ts', descriptionPath = '/tests/c4-fixtures.ts', ioPath = '/src/io/v6/project-file.ts'
    const { SceneRepositoryV6 } = await import(storagePath) as typeof import('../src/io/v6/storage')
    const { WorkspaceV6 } = await import(workspacePath) as typeof import('../src/editor/v6/workspace')
    // Load the complete transitive module set before a target context goes offline.
    const fixture = await import(fixturePath) as typeof import('./c5-storage-fixtures')
    const { describeC4Project: describe } = await import(descriptionPath) as typeof import('./c4-fixtures')
    const io = await import(ioPath) as typeof import('../src/io/v6/project-file')
    const repository = new SceneRepositoryV6(databaseName), workspace = new WorkspaceV6(repository)
    Reflect.set(window, '__c5StorageDev', { repository, workspace, databaseName, io, fixture, describe } satisfies NativeDev)
    await repository.open()
    if (options.sceneId) {
      const project = await repository.load(options.sceneId)
      if (!project) throw new Error('C5 persisted fixture is missing')
      await workspace.openPersisted(project)
    } else if (!options.empty) await workspace.adoptNew(await fixture.createC5MixedProjectV6())
    return workspace.getState().project?.document.sceneId ?? null
  }, { databaseName, options })
}
async function closeConnection(page: Page) {
  await page.evaluate(() => {
    const dev = Reflect.get(window, '__c5StorageDev') as NativeDev | undefined
    dev?.repository.close(); Reflect.deleteProperty(window, '__c5StorageDev')
  }).catch(() => {})
}
async function removeDatabase(page: Page, databaseName: string) {
  await page.evaluate(databaseName => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('C5 native database still has an open reader'))
  }), databaseName)
}
async function completeState(page: Page, sceneId?: string) {
  return page.evaluate(async sceneId => {
    const { workspace, repository, describe } = Reflect.get(window, '__c5StorageDev') as NativeDev
    const project = sceneId ? await repository.load(sceneId) : workspace.getState().project
    if (!project) throw new Error('Expected complete C5 project')
    const state = workspace.getState()
    return { ...await describe(project), status: state.status, error: state.error, canUndo: state.canUndo, canRedo: state.canRedo }
  }, sceneId)
}
async function executeAndSave(page: Page, commands: CompositionCommandV6[]) {
  await page.evaluate(async commands => {
    const { workspace } = Reflect.get(window, '__c5StorageDev') as NativeDev
    await workspace.execute(commands); await workspace.flush()
  }, commands)
}
async function evidence(info: TestInfo, name: string, report: unknown) {
  await info.attach(name, { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
}
function checkBytes(value: Description, requireImages = true) {
  if (requireImages) expect(Object.keys(value.assets).length).toBeGreaterThan(0)
  for (const asset of Object.values(value.assets)) expect(asset.actualHash).toBe(asset.sha256)
  for (const license of Object.values(value.licenses)) expect(license.actualHash).toBe(license.sha256)
  for (const original of value.originals) expect(original.actualHash).toBe(original.sourceHash)
}

test('C5 six native repositories retain five exact migration originals and old named history after reopened v6 editing', async ({ page }, info) => {
  test.setTimeout(180_000)
  const prefix = `c5-native-full-chain-${crypto.randomUUID()}`, names = Array.from({ length: 6 }, (_, index) => `${prefix}-v${index + 1}`)
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  try {
    const report = await page.evaluate(async names => {
      const fixturePath = '/tests/c5-storage-fixtures.ts', descriptionPath = '/tests/c4-fixtures.ts', ioPath = '/src/io/v6/project-file.ts'
      const v1Path = '/src/io/storage.ts', v2Path = '/src/io/v2/storage.ts', v3Path = '/src/io/v3/storage.ts'
      const v4Path = '/src/io/v4/storage.ts', v5Path = '/src/io/v5/storage.ts', v6Path = '/src/io/v6/storage.ts'
      const workspacePath = '/src/editor/v6/workspace.ts', migrationPath = '/src/io/v6/migration.ts'
      const { createC5MigrationChain } = await import(fixturePath) as typeof import('./c5-storage-fixtures')
      const { describeC4Project: describe } = await import(descriptionPath) as typeof import('./c4-fixtures')
      const { canonicalJsonV6 } = await import(ioPath) as typeof import('../src/io/v6/project-file')
      const { migrationOriginalV6 } = await import(migrationPath) as typeof import('../src/io/v6/migration')
      const { WorkspaceV6 } = await import(workspacePath) as typeof import('../src/editor/v6/workspace')
      const { SceneRepository } = await import(v1Path) as typeof import('../src/io/storage')
      const { SceneRepositoryV2 } = await import(v2Path) as typeof import('../src/io/v2/storage')
      const { SceneRepositoryV3 } = await import(v3Path) as typeof import('../src/io/v3/storage')
      const { SceneRepositoryV4 } = await import(v4Path) as typeof import('../src/io/v4/storage')
      const { SceneRepositoryV5 } = await import(v5Path) as typeof import('../src/io/v5/storage')
      const { SceneRepositoryV6 } = await import(v6Path) as typeof import('../src/io/v6/storage')
      const chain = await createC5MigrationChain(), r1 = new SceneRepository(names[0]), r2 = new SceneRepositoryV2(names[1])
      const r3 = new SceneRepositoryV3(names[2]), r4 = new SceneRepositoryV4(names[3]), r5 = new SceneRepositoryV5(names[4])
      let r6 = new SceneRepositoryV6(names[5])
      const readers = [r1, r2, r3, r4, r5, r6]
      Reflect.set(window, '__c5MigrationConnections', readers)
      const digest = async (value: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value))).map(byte => byte.toString(16).padStart(2, '0')).join('')
      const documentHash = async (value: unknown) => digest(new TextEncoder().encode(canonicalJsonV6(value)).buffer)
      const exactOriginals = async (project: typeof chain.v6) => {
        const values = []
        for (const schema of [1, 2, 3, 4, 5] as const) {
          const blob = await migrationOriginalV6(project, schema)
          if (!blob) throw new Error(`Missing exact original v${schema}`)
          const actual = new Uint8Array(await blob.arrayBuffer()), expected = new Uint8Array(await chain.originals[schema - 1].arrayBuffer())
          values.push({ schema, sourceSceneId: [chain.v1.sceneId, chain.v2.document.sceneId, chain.v3.document.sceneId, chain.v4.document.sceneId, chain.v5.document.sceneId][schema - 1],
            expectedHash: await digest(expected.buffer), actualHash: await digest(actual.buffer), sizeBytes: actual.length,
            exactBytes: expected.length === actual.length && expected.every((byte, index) => actual[index] === byte) })
        }
        return values
      }
      const readOldSources = async () => {
        const old = [await r1.load(chain.v1.sceneId), await r2.load(chain.v2.document.sceneId), await r3.load(chain.v3.document.sceneId), await r4.load(chain.v4.document.sceneId), await r5.load(chain.v5.document.sceneId)]
        const current = []
        for (let index = 0; index < old.length; index++) {
          const value = old[index]
          if (!value) throw new Error(`Missing native v${index + 1} current`)
          const document = 'document' in value ? value.document : value
          current.push({ schema: index + 1, sceneId: document.sceneId, revision: document.revision, documentHash: await documentHash(document) })
        }
        return { current, automatic: [await r1.listSnapshots(chain.v1.sceneId), await r2.listSnapshots(chain.v2.document.sceneId), await r3.listSnapshots(chain.v3.document.sceneId),
          await r4.listSnapshots(chain.v4.document.sceneId), await r5.listSnapshots(chain.v5.document.sceneId)],
        v4History: await r4.listNamedSnapshots(chain.v4.document.sceneId), v5History: await r5.listNamedSnapshots(chain.v5.document.sceneId) }
      }
      try {
        await r1.save(chain.v1, null); await r2.save(chain.v2, null); await r3.save(chain.v3, null)
        await r4.save(chain.v4, null); await r5.save(chain.v5, null)
        const v4Named = await r4.createNamedSnapshot(chain.v4, 'C5 old v4 named source'), v5Named = await r5.createNamedSnapshot(chain.v5, 'C5 old v5 named source')
        const beforeSources = await readOldSources()
        await r6.save(chain.v6, null)
        const before = await describe((await r6.load(chain.v6.document.sceneId))!), beforeOriginals = await exactOriginals((await r6.load(chain.v6.document.sceneId))!)
        r6.close(); r6 = new SceneRepositoryV6(names[5]); readers.push(r6)
        const reopenedProject = await r6.load(chain.v6.document.sceneId)
        if (!reopenedProject) throw new Error('Missing reopened v6 chain')
        const reopened = await describe(reopenedProject), reopenedOriginals = await exactOriginals(reopenedProject)
        const workspace = new WorkspaceV6(r6); await workspace.openPersisted(reopenedProject)
        await workspace.execute([{ type: 'setTerrainElevation', id: 'c5-chain-terrain', groundElevationMm: 350 }, { type: 'updateProp', id: 'p-a1', changes: { rotationDeg: 5 } }]); await workspace.flush()
        const after = await describe((await r6.load(chain.v6.document.sceneId))!), afterOriginals = await exactOriginals((await r6.load(chain.v6.document.sceneId))!)
        const v4Retained = (await r4.loadNamedSnapshot(v4Named.id, chain.v4.document.sceneId))!, v5Retained = (await r5.loadNamedSnapshot(v5Named.id, chain.v5.document.sceneId))!
        return { sceneIds: [chain.v1.sceneId, chain.v2.document.sceneId, chain.v3.document.sceneId, chain.v4.document.sceneId, chain.v5.document.sceneId, chain.v6.document.sceneId],
          beforeSources, afterSources: await readOldSources(), before, beforeOriginals, reopened, reopenedOriginals, after, afterOriginals,
          retainedNamed: [{ schema: 4, id: v4Retained.id, expectedHash: v4Named.contentHash, actualHash: v4Retained.contentHash, documentHash: await documentHash(v4Retained.project.document) },
            { schema: 5, id: v5Retained.id, expectedHash: v5Named.contentHash, actualHash: v5Retained.contentHash, documentHash: await documentHash(v5Retained.project.document) }],
          v6NamedHistory: await r6.listNamedSnapshots(chain.v6.document.sceneId) }
      } finally { readers.forEach(reader => reader.close()); Reflect.deleteProperty(window, '__c5MigrationConnections') }
    }, names)
    expect(new Set(report.sceneIds).size).toBe(6)
    expect(report.afterSources).toEqual(report.beforeSources)
    expect(report.before.originals).toHaveLength(5); expect(Object.keys(report.before.assets)).toHaveLength(0)
    expect(report.reopened.contentHash).toBe(report.before.contentHash)
    expect(report.reopened.historyIdentity).toEqual(report.before.historyIdentity); expect(report.reopened.appearance).toEqual(report.before.appearance)
    expect(report.after.document.revision).toBe(1); expect(report.after.document.terrainAreas['c5-chain-terrain'].groundElevationMm).toBe(350)
    expect(report.after.document.props['p-a1'].rotationDeg).toBe(5)
    expect(report.after.document.regions).toEqual(report.before.document.regions)
    expect(report.after.document.rooms['r-c3'].visibility).toBe('gm')
    expect(report.after.document.openings['o-c3'].secret).toBe(true)
    expect(report.after.historyIdentity).toEqual(report.before.historyIdentity)
    for (const values of [report.beforeOriginals, report.reopenedOriginals, report.afterOriginals]) {
      expect(values.map(value => value.schema)).toEqual([1, 2, 3, 4, 5])
      for (const value of values) { expect(value.exactBytes).toBe(true); expect(value.actualHash).toBe(value.expectedHash) }
    }
    expect(report.after.originals).toEqual(report.before.originals); expect(report.v6NamedHistory).toEqual([])
    for (const snapshot of report.retainedNamed) {
      expect(snapshot.actualHash).toBe(snapshot.expectedHash)
      expect(snapshot.documentHash).toBe(report.beforeSources.current[snapshot.schema - 1].documentHash)
    }
    checkBytes(report.after, false)
    await evidence(info, 'c5-native-full-migration-chain.json', { method: 'All v1-v6 independent current projects and v4/v5 named snapshots saved in six real IndexedDBs. Exact exported Blob originals are retrieved via v6 downloads before/after a new connection and continued outdoor/prop editing. This geometry-only chain has no bitmap resources; bitmap decoding is covered by the separate mixed offline test.', ...report })
  } finally {
    await page.evaluate(() => {
      const readers = Reflect.get(window, '__c5MigrationConnections') as { close(): void }[] | undefined
      readers?.forEach(reader => reader.close()); Reflect.deleteProperty(window, '__c5MigrationConnections')
    }).catch(() => {})
    for (const name of names) await removeDatabase(page, name)
  }
})

test('C5 mixed selected-history package imports into an empty offline context and continues scoped restoration after native reopen', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  const sourceName = `c5-mixed-source-${crypto.randomUUID()}`, targetName = `c5-mixed-offline-${crypto.randomUUID()}`
  await connect(page, sourceName)
  const targetContext = await browser.newContext({ baseURL: new URL(page.url()).origin }), target = await targetContext.newPage()
  try {
    const exported = await page.evaluate(async () => {
      const { workspace, repository, io, describe } = Reflect.get(window, '__c5StorageDev') as NativeDev
      const source = await workspace.createNamedSnapshot('C5 selected mixed source'), omitted = await workspace.createNamedSnapshot('C5 omitted source')
      await workspace.execute([
        { type: 'updatePath', id: 'c4-path', changes: { widthMm: 1500, movementCostMultiplier: 2 } },
        { type: 'setTerrainElevation', id: 'c4-terrain', groundElevationMm: 350 },
        { type: 'updateNote', id: 'c5-room-note', changes: { text: 'C5 保存前的新注记' } },
      ]); await workspace.flush()
      await workspace.execute([
        { type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['c3-secret'] }, adjustment: { id: 'c4-retained-tint', kind: 'tint', value: '#40A0FF', enabled: true } },
      ]); await workspace.flush()
      const protection = await workspace.applyRestore(await workspace.prepareRestore(source.id, { ids: ['c4-path'], mode: 'outdoorGeometry' })); await workspace.flush()
      const current = workspace.getState().project!, selected = await repository.exportArchive(current.document.sceneId, [source.id, protection.id])
      const blob = await io.exportHistoryArchiveV6(selected)
      return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), before: await describe(current),
        selected: { sourceId: source.id, protectionId: protection.id, omittedId: omitted.id },
        snapshots: await Promise.all(selected.snapshots.map(async value => ({ id: value.id, contentHash: value.contentHash, project: await describe(value.project) }))),
        sourceHistory: await repository.listNamedSnapshots(current.document.sceneId) }
    })
    await connect(target, targetName, { empty: true })
    expect(await target.evaluate(async () => (Reflect.get(window, '__c5StorageDev') as NativeDev).repository.list())).toEqual([])
    await targetContext.setOffline(true)
    const imported = await target.evaluate(async bytes => {
      const { workspace, repository, io, describe } = Reflect.get(window, '__c5StorageDev') as NativeDev
      const archive = await io.importHistoryArchiveV6(new Blob([Uint8Array.from(bytes).buffer], { type: 'application/x-sceneweave' }))
      const adopted = await workspace.adoptArchive(archive), sceneId = adopted.project.document.sceneId
      const snapshots = []
      for (const summary of await repository.listNamedSnapshots(sceneId)) {
        const value = (await repository.loadNamedSnapshot(summary.id, sceneId))!
        snapshots.push({ id: value.id, contentHash: value.contentHash, actualHash: await io.projectContentHashV6(value.project), project: await describe(value.project) })
      }
      return { project: await describe(workspace.getState().project!), snapshots, scenes: await repository.list() }
    }, exported.bytes)
    const historicalSecret = exported.snapshots.find(value => value.id === exported.selected.sourceId)!.project.document.props['c3-secret'].appearance
    const currentSecret = exported.before.document.props['c3-secret'].appearance
    expect(historicalSecret.kind).toBe('image'); expect(currentSecret.kind).toBe('image')
    if (historicalSecret.kind === 'image' && currentSecret.kind === 'image') expect(currentSecret.assetId).not.toBe(historicalSecret.assetId)
    expect(imported.scenes).toHaveLength(1); expect(imported.project.document.sceneId).not.toBe(exported.before.document.sceneId)
    expect(imported.project.document.revision).toBe(0); expect(imported.project.originals).toEqual([])
    for (const key of ['rooms', 'walls', 'vertices', 'notes', 'userLayers', 'entityLayers', 'props', 'prefabInstances', 'terrainAreas', 'paths', 'scatterGroups'] as const) expect(imported.project.document[key]).toEqual(exported.before.document[key])
    expect(imported.project.historyIdentity).toEqual(exported.before.historyIdentity); expect(imported.project.appearance).toEqual(exported.before.appearance)
    expect(imported.project.assets).toEqual(exported.before.assets); expect(imported.project.licenses).toEqual(exported.before.licenses)
    expect(imported.project.licenseBindings).toEqual(exported.before.licenseBindings); checkBytes(imported.project)
    expect(imported.snapshots.map(value => value.id).sort()).toEqual([exported.selected.sourceId, exported.selected.protectionId].sort())
    expect(imported.snapshots.some(value => value.id === exported.selected.omittedId)).toBe(false)
    for (const value of imported.snapshots) {
      const original = exported.snapshots.find(candidate => candidate.id === value.id)!
      expect(value.actualHash).toBe(value.contentHash); expect(value.contentHash).toBe(original.contentHash)
      expect(value.project.document).toEqual(original.project.document); expect(value.project.historyIdentity).toEqual(original.project.historyIdentity)
      expect(value.project.appearance).toEqual(original.project.appearance); expect(value.project.assets).toEqual(original.project.assets)
      expect(value.project.licenses).toEqual(original.project.licenses); expect(value.project.licenseBindings).toEqual(original.project.licenseBindings)
      expect(value.project.originals).toEqual([]); checkBytes(value.project)
    }
    await executeAndSave(target, [
      { type: 'updatePath', id: 'c4-path', changes: { widthMm: 1800, movementCostMultiplier: 3 } },
      { type: 'setTerrainElevation', id: 'c4-terrain', groundElevationMm: 600 },
      { type: 'updateNote', id: 'c5-room-note', changes: { text: 'C5 离线新编辑必须保留' } },
    ])
    const edited = await completeState(target)
    // Reopen the actual native connection while offline, without loading any new module.
    const reopened = await target.evaluate(async () => {
      const dev = Reflect.get(window, '__c5StorageDev') as NativeDev, sceneId = dev.workspace.getState().project!.document.sceneId
      dev.repository.close(); await dev.repository.open()
      const persisted = await dev.repository.load(sceneId)
      if (!persisted) throw new Error('C5 offline branch is missing after native reopen')
      await dev.workspace.openPersisted(persisted)
      return dev.describe(persisted)
    })
    expect(reopened.contentHash).toBe(edited.contentHash); expect(reopened.assets).toEqual(edited.assets); expect(reopened.licenses).toEqual(edited.licenses)
    const restored = await target.evaluate(async snapshotId => {
      const { workspace, repository, describe } = Reflect.get(window, '__c5StorageDev') as NativeDev
      const preview = await workspace.prepareRestore(snapshotId, { ids: ['c4-path'], mode: 'outdoorGeometry' })
      const scope = { affectedIds: preview.plan.affectedIds, commandCost: preview.plan.commandCost, changes: preview.plan.changes }
      const protection = await workspace.applyRestore(preview); await workspace.flush()
      const current = workspace.getState().project!, protectedProject = (await repository.loadNamedSnapshot(protection.id, current.document.sceneId))!.project
      repository.close(); await repository.open()
      return { scope, protection: { id: protection.id, contentHash: protection.contentHash, project: await describe(protectedProject) },
        project: await describe((await repository.load(current.document.sceneId))!), usage: await repository.usage(current.document.sceneId) }
    }, exported.selected.sourceId)
    expect(restored.project.document.revision).toBe(edited.document.revision + 1)
    expect(restored.project.document.paths['c4-path']).toMatchObject({ widthMm: 1000, movementCostMultiplier: 3 })
    for (const key of ['rooms', 'walls', 'notes', 'props', 'terrainAreas', 'scatterGroups', 'prefabInstances', 'userLayers', 'entityLayers'] as const) expect(restored.project.document[key]).toEqual(edited.document[key])
    expect(restored.project.appearance).toEqual(edited.appearance); expect(restored.project.historyIdentity).toEqual(edited.historyIdentity)
    expect(restored.project.assets).toEqual(edited.assets); expect(restored.project.licenses).toEqual(edited.licenses)
    expect(restored.protection.contentHash).toBe(edited.contentHash); expect(restored.protection.project.contentHash).toBe(edited.contentHash)
    expect(restored.project.originals).toEqual([]); expect(restored.usage).toMatchObject({ namedCount: 1, protectionCount: 2 })
    checkBytes(restored.project); checkBytes(restored.protection.project)
    const sourceAfter = await completeState(page, exported.before.document.sceneId)
    expect(sourceAfter.contentHash).toBe(exported.before.contentHash); expect(sourceAfter.originals).toEqual(exported.before.originals)
    expect(await page.evaluate(async sceneId => (Reflect.get(window, '__c5StorageDev') as NativeDev).repository.listNamedSnapshots(sceneId), exported.before.document.sceneId)).toEqual(exported.sourceHistory)
    const { bytes: _bytes, ...sourceReport } = exported
    await evidence(info, 'c5-native-mixed-offline-selected-history.json', { method: 'Dev fixture/domain methods with real original/derived bitmap decoding, native IndexedDB and a portable ZIP transferred through Playwright bytes into a separate browser context with empty custom storage. Modules preload before offline mode. Import, save, native close/reopen and scoped restore execute offline; this is not PWA cold-start evidence.', packageBytes: exported.bytes.length, ...sourceReport, imported, edited, reopened, restored, sourceAfter })
  } finally {
    await closeConnection(target); await removeDatabase(target, targetName); await targetContext.close()
    await closeConnection(page); await removeDatabase(page, sourceName)
  }
})

interface SaveFault {
  hits: number
  restore(): void
}

test('C5 native save failure after protected restoration rolls back current/resource rows and retains memory, undo and retry', async ({ page }, info) => {
  test.setTimeout(180_000)
  const databaseName = `c5-native-post-restore-save-${crypto.randomUUID()}`
  try {
    const sceneId = (await connect(page, databaseName))!
    const source = await page.evaluate(async () => {
      const snapshot = await (Reflect.get(window, '__c5StorageDev') as NativeDev).workspace.createNamedSnapshot('C5 source before save fault')
      return { id: snapshot.id, contentHash: snapshot.contentHash }
    })
    await executeAndSave(page, [
      { type: 'updatePath', id: 'c4-path', changes: { widthMm: 1700, movementCostMultiplier: 2 } },
      { type: 'setTerrainElevation', id: 'c4-terrain', groundElevationMm: 400 },
      { type: 'updateNote', id: 'c5-room-note', changes: { text: 'C5 恢复范围外的持久新注记' } },
    ])
    const before = await completeState(page)
    const failure = await page.evaluate(async snapshotId => {
      const { workspace, repository, databaseName, fixture, describe } = Reflect.get(window, '__c5StorageDev') as NativeDev
      const sceneId = workspace.getState().project!.document.sceneId, failedRevision = workspace.getState().project!.document.revision + 1
      const beforeRows = await fixture.countC5NativeStores(databaseName, sceneId), automaticBefore = await repository.listSnapshots(sceneId)
      const preview = await workspace.prepareRestore(snapshotId, { ids: ['c4-path'], mode: 'outdoorProperties' })
      const nativeAdd = IDBObjectStore.prototype.add, fault: SaveFault = { hits: 0, restore: () => { IDBObjectStore.prototype.add = nativeAdd } }
      Reflect.set(window, '__c5SaveFault', fault)
      // Fail after scenes.put and resourceBindings.add inside the SAME native transaction.
      // A simulated QuotaExceededError tests abort handling; it does not exhaust actual disk quota.
      IDBObjectStore.prototype.add = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (this.transaction.db.name === databaseName && this.name === 'snapshots' && value && typeof value === 'object'
          && 'sceneId' in value && value.sceneId === sceneId && 'revision' in value && value.revision === failedRevision) {
          fault.hits++; throw new DOMException('C5 injected native snapshot write failure', 'QuotaExceededError')
        }
        return key === undefined ? nativeAdd.call(this, value) : nativeAdd.call(this, value, key)
      }
      let error: { name: string; message: string } | null = null
      const protection = await workspace.applyRestore(preview)
      try { await workspace.flush() } catch (reason) { error = { name: reason instanceof Error ? reason.name : '', message: String(reason) } }
      fault.restore()
      const state = workspace.getState(), protectedProject = (await repository.loadNamedSnapshot(protection.id, sceneId))!.project
      return { error, hits: fault.hits, failedRevision, beforeRows, afterRows: await fixture.countC5NativeStores(databaseName, sceneId),
        automaticBefore, automaticAfter: await repository.listSnapshots(sceneId), usage: await repository.usage(sceneId),
        restoredMemory: { ...await describe(state.project!), status: state.status, error: state.error, canUndo: state.canUndo, canRedo: state.canRedo },
        persisted: await describe((await repository.load(sceneId))!), protection: { id: protection.id, contentHash: protection.contentHash, project: await describe(protectedProject) } }
    }, source.id)
    expect(failure.error?.name).toBe('QuotaExceededError'); expect(failure.hits).toBe(1)
    expect(failure.restoredMemory.status).toBe('error'); expect(failure.restoredMemory.error).toContain('C5 injected native snapshot write failure')
    expect(failure.restoredMemory.canUndo).toBe(true); expect(failure.restoredMemory.document.revision).toBe(before.document.revision + 1)
    expect(failure.restoredMemory.document.paths['c4-path']).toMatchObject({ widthMm: 1000, movementCostMultiplier: 1 })
    for (const key of ['rooms', 'notes', 'props', 'terrainAreas', 'scatterGroups'] as const) expect(failure.restoredMemory.document[key]).toEqual(before.document[key])
    expect(failure.persisted.contentHash).toBe(before.contentHash); expect(failure.persisted.assets).toEqual(before.assets)
    expect(failure.persisted.originals).toEqual(before.originals); expect(failure.persisted.licenses).toEqual(before.licenses)
    expect(failure.afterRows).toEqual(failure.beforeRows); expect(failure.automaticAfter).toEqual(failure.automaticBefore)
    expect(failure.protection.contentHash).toBe(before.contentHash); expect(failure.protection.project.contentHash).toBe(before.contentHash)
    expect(failure.usage).toMatchObject({ namedCount: 1, protectionCount: 1, metadataVersion: 2 })
    checkBytes(failure.restoredMemory); checkBytes(failure.persisted); checkBytes(failure.protection.project)
    const recovery = await page.evaluate(async () => {
      const { workspace, repository, fixture, databaseName, describe } = Reflect.get(window, '__c5StorageDev') as NativeDev
      workspace.undo()
      const undoneMemory = { ...await describe(workspace.getState().project!), canRedo: workspace.getState().canRedo }
      await workspace.retry()
      const sceneId = workspace.getState().project!.document.sceneId, retried = await describe((await repository.load(sceneId))!)
      workspace.redo(); await workspace.flush()
      const redone = await describe((await repository.load(sceneId))!)
      repository.close(); await repository.open()
      return { undoneMemory, retried, redone, reopened: await describe((await repository.load(sceneId))!),
        automatic: await repository.listSnapshots(sceneId), rows: await fixture.countC5NativeStores(databaseName, sceneId), usage: await repository.usage(sceneId) }
    })
    expect(recovery.undoneMemory.document.revision).toBe(failure.failedRevision + 1); expect(recovery.undoneMemory.canRedo).toBe(true)
    for (const key of ['paths', 'terrainAreas', 'notes', 'props'] as const) expect(recovery.undoneMemory.document[key]).toEqual(before.document[key])
    expect(recovery.retried.contentHash).toBe(recovery.undoneMemory.contentHash)
    expect(recovery.redone.document.revision).toBe(failure.failedRevision + 2)
    for (const key of ['paths', 'terrainAreas', 'notes', 'props'] as const) expect(recovery.redone.document[key]).toEqual(failure.restoredMemory.document[key])
    expect(recovery.reopened.contentHash).toBe(recovery.redone.contentHash); expect(recovery.reopened.appearance).toEqual(failure.restoredMemory.appearance)
    expect(recovery.reopened.historyIdentity).toEqual(failure.restoredMemory.historyIdentity); expect(recovery.reopened.assets).toEqual(before.assets)
    expect(recovery.reopened.originals).toEqual(before.originals); expect(recovery.reopened.licenses).toEqual(before.licenses)
    expect(recovery.automatic.some(value => value.revision === failure.failedRevision)).toBe(false)
    expect(recovery.automatic.map(value => value.revision).sort((a, b) => a - b)).toEqual([0, 1, 3, 4])
    expect(recovery.rows.snapshots).toBe(failure.beforeRows.snapshots + 2); expect(recovery.rows.resourceBindings).toBe(failure.beforeRows.resourceBindings + 2)
    expect(recovery.usage).toMatchObject({ namedCount: 1, protectionCount: 1, metadataVersion: 2 }); checkBytes(recovery.reopened)
    expect((await completeState(page, sceneId)).contentHash).toBe(recovery.redone.contentHash)
    await evidence(info, 'c5-native-post-restore-save-failure.json', { method: 'Native IDBObjectStore.add throws a deterministic simulated QuotaExceededError only for the restored revision in the custom snapshots store, after earlier writes in that transaction. Actual IDB abort preserves the old current/snapshot/resource rows; the separately committed protection point, restored memory and monotonic undo/redo survive. Retry saves the latest undo branch, then redo persists and reopens. This is not real quota exhaustion.', source, before, failure, recovery })
  } finally {
    await page.evaluate(() => { (Reflect.get(window, '__c5SaveFault') as SaveFault | undefined)?.restore(); Reflect.deleteProperty(window, '__c5SaveFault') }).catch(() => {})
    await closeConnection(page); await removeDatabase(page, databaseName)
  }
})
