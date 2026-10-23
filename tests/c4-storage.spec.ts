import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { CompositionCommandV6 } from '../src/core/v6/types'
import type { WorkspaceV6 } from '../src/editor/v6/workspace'
import type { SceneRepositoryV6 } from '../src/io/v6/storage'

type NativeDev = { workspace: WorkspaceV6; repository: SceneRepositoryV6; databaseName: string }

/** Each test owns a unique real IndexedDB; the two pages have separate repository connections. */
async function connect(page: Page, databaseName: string, sceneId?: string) {
  await page.goto('/#outdoor'); await expect(page.getByTestId('outdoor-workbench')).toBeVisible()
  return page.evaluate(async ({ databaseName, sceneId }) => {
    const storagePath = '/src/io/v6/storage.ts', workspacePath = '/src/editor/v6/workspace.ts', fixturePath = '/tests/c4-fixtures.ts'
    const { SceneRepositoryV6 } = await import(storagePath) as typeof import('../src/io/v6/storage')
    const { WorkspaceV6 } = await import(workspacePath) as typeof import('../src/editor/v6/workspace')
    const repository = new SceneRepositoryV6(databaseName), workspace = new WorkspaceV6(repository)
    await repository.open()
    if (sceneId) {
      const project = await repository.load(sceneId)
      if (!project) throw new Error('C4 native fixture is missing')
      await workspace.openPersisted(project)
    } else {
      const { createC4ProjectV6 } = await import(fixturePath) as typeof import('./c4-fixtures')
      await workspace.adoptNew(await createC4ProjectV6())
    }
    Reflect.set(window, '__c4StorageDev', { repository, workspace, databaseName } satisfies NativeDev)
    return workspace.getState().project!.document.sceneId
  }, { databaseName, sceneId })
}
async function closeConnection(page: Page) {
  await page.evaluate(() => { const dev = Reflect.get(window, '__c4StorageDev') as NativeDev | undefined; dev?.repository.close(); Reflect.deleteProperty(window, '__c4StorageDev') }).catch(() => {})
}
async function removeDatabase(page: Page, databaseName: string) {
  await page.evaluate(databaseName => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('C4 test database still has a reader'))
  }), databaseName)
}
async function completeState(page: Page, sceneId?: string) {
  return page.evaluate(async sceneId => {
    const { workspace, repository } = Reflect.get(window, '__c4StorageDev') as NativeDev
    const project = sceneId ? await repository.load(sceneId) : workspace.getState().project
    if (!project) throw new Error('Expected complete C4 project')
    const path = '/tests/c4-fixtures.ts', { describeC4Project } = await import(path) as typeof import('./c4-fixtures')
    return { ...await describeC4Project(project), status: workspace.getState().status, error: workspace.getState().error }
  }, sceneId)
}
async function executeAndSave(page: Page, commands: CompositionCommandV6[]) {
  await page.evaluate(async commands => { const { workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev; await workspace.execute(commands); await workspace.flush() }, commands)
}
async function evidence(info: TestInfo, name: string, value: unknown) { await info.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' }) }
function checkBytes(value: Awaited<ReturnType<typeof completeState>>) {
  expect(Object.keys(value.assets).length).toBeGreaterThan(0)
  for (const asset of Object.values(value.assets)) expect(asset.actualHash).toBe(asset.sha256)
  for (const license of Object.values(value.licenses)) expect(license.actualHash).toBe(license.sha256)
  for (const original of value.originals) expect(original.actualHash).toBe(original.sourceHash)
}

test('C4 native two-page revision CAS preserves outdoor edits and exact sources in an independent reopened conflict copy', async ({ page, context }, info) => {
  test.setTimeout(180_000)
  const databaseName = `c4-native-cas-${crypto.randomUUID()}`, second = await context.newPage()
  try {
    const sceneId = await connect(page, databaseName), original = await completeState(page)
    await connect(second, databaseName, sceneId)
    expect((await completeState(second)).contentHash).toBe(original.contentHash); expect(original.document.revision).toBe(0)
    await executeAndSave(page, [{ type: 'updatePath', id: 'c4-path', changes: { widthMm: 1500, movementCostMultiplier: 2 } }])
    const winner = await completeState(page)
    const failure = await second.evaluate(async () => {
      const { workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev
      await workspace.execute([{ type: 'setTerrainElevation', id: 'c4-terrain', groundElevationMm: 500 }, { type: 'updateProp', id: 'c3-secret', changes: { rotationDeg: 25 } }])
      try { await workspace.flush(); return null } catch (error) { return { name: error instanceof Error ? error.name : '', message: String(error) } }
    })
    expect(failure?.name).toBe('ConflictErrorV6')
    const losing = await completeState(second)
    expect(losing.status).toBe('conflict'); expect(losing.document.terrainAreas['c4-terrain'].groundElevationMm).toBe(500)
    expect(losing.document.paths['c4-path'].widthMm).toBe(1000); expect(losing.document.props['c3-secret'].rotationDeg).toBe(25)
    expect((await completeState(second, sceneId)).contentHash).toBe(winner.contentHash)
    await second.evaluate(async () => { await (Reflect.get(window, '__c4StorageDev') as NativeDev).workspace.saveAsCopy() })
    const copy = await completeState(second)
    expect(copy.document.sceneId).not.toBe(sceneId); expect(copy.document.revision).toBe(0)
    for (const key of ['props', 'prefabInstances', 'terrainAreas', 'paths', 'scatterGroups'] as const) expect(copy.document[key]).toEqual(losing.document[key])
    expect(copy.historyIdentity).toEqual(losing.historyIdentity); expect(copy.appearance).toEqual(losing.appearance)
    expect(copy.assets).toEqual(losing.assets); expect(copy.licenses).toEqual(losing.licenses); expect(copy.licenseBindings).toEqual(losing.licenseBindings)
    expect(copy.originals).toEqual(original.originals); expect(copy.originals).toHaveLength(1); checkBytes(copy)
    await closeConnection(second); await connect(second, databaseName, copy.document.sceneId)
    const reopened = await completeState(second)
    expect(reopened.contentHash).toBe(copy.contentHash); expect(reopened.originals).toEqual(copy.originals)
    expect(reopened.historyIdentity).toEqual(copy.historyIdentity); expect(reopened.appearance).toEqual(copy.appearance); checkBytes(reopened)
    expect((await completeState(second, sceneId)).contentHash).toBe(winner.contentHash)
    const scenes = await second.evaluate(async () => (Reflect.get(window, '__c4StorageDev') as NativeDev).repository.list())
    expect(scenes.map(value => value.sceneId).sort()).toEqual([sceneId, copy.document.sceneId].sort())
    await evidence(info, 'c4-native-two-page-cas.json', { method: 'Two pages, separate repository connections and one unique native IndexedDB. Native image decoding and byte hashes; no fake IndexedDB or quota injection.', original, winner, failure, losing, copy, reopened, scenes })
  } finally { await closeConnection(second); await second.close(); await closeConnection(page); await removeDatabase(page, databaseName) }
})

interface ProtectionGate {
  entered: boolean
  expectedMetadataVersion?: number
  release: () => void
  pending: Promise<void>
  failure: { name: string; message: string } | null
  adopted: boolean
  restoreMethod: () => void
}

test('C4 native protection metadata CAS rejects a stale outdoor restore and a fresh retry protects the current complete branch', async ({ page, context }, info) => {
  test.setTimeout(180_000)
  const databaseName = `c4-native-metadata-${crypto.randomUUID()}`, second = await context.newPage()
  try {
    const sceneId = await connect(page, databaseName)
    const source = await page.evaluate(async () => { const value = await (Reflect.get(window, '__c4StorageDev') as NativeDev).workspace.createNamedSnapshot('Native C4 source'); return { id: value.id, contentHash: value.contentHash } })
    await executeAndSave(page, [
      { type: 'updatePath', id: 'c4-path', changes: { widthMm: 1600, movementCostMultiplier: 2 } },
      { type: 'setTerrainElevation', id: 'c4-terrain', groundElevationMm: 300 },
      { type: 'updateProp', id: 'c3-secret', changes: { rotationDeg: 15 } },
    ])
    const before = await completeState(page); await connect(second, databaseName, sceneId)
    await page.evaluate(async snapshotId => {
      const { repository, workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev
      const preview = await workspace.prepareRestore(snapshotId, { ids: ['c4-path'], mode: 'outdoorProperties' }), original = repository.createNamedSnapshot.bind(repository)
      let release!: () => void
      const pause = new Promise<void>(resolve => { release = resolve })
      const state: ProtectionGate = { entered: false, release, pending: Promise.resolve(), failure: null, adopted: false, restoreMethod: () => { repository.createNamedSnapshot = original } }
      repository.createNamedSnapshot = async (project, name, options = {}) => {
        if (options.kind === 'protection') { state.entered = true; state.expectedMetadataVersion = options.expectedMetadataVersion; await pause }
        return original(project, name, options)
      }
      Reflect.set(window, '__c4ProtectionGate', state)
      state.pending = workspace.applyRestore(preview).then(() => { state.adopted = true }, error => { state.failure = { name: error instanceof Error ? error.name : '', message: String(error) } })
    }, source.id)
    await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__c4ProtectionGate') as ProtectionGate).entered)).toBe(true)
    const inserted = await second.evaluate(async () => {
      const { repository, workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev, value = await workspace.createNamedSnapshot('Other native page')
      return { id: value.id, usage: await repository.usage(value.sceneId) }
    })
    const rejected = await page.evaluate(async () => {
      const gate = Reflect.get(window, '__c4ProtectionGate') as ProtectionGate; gate.release(); await gate.pending; gate.restoreMethod()
      const { repository, workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev, sceneId = workspace.getState().project!.document.sceneId
      return { failure: gate.failure, adopted: gate.adopted, expectedMetadataVersion: gate.expectedMetadataVersion,
        usage: await repository.usage(sceneId), snapshots: await repository.listNamedSnapshots(sceneId) }
    })
    expect(rejected.failure?.name).toBe('HistoryConflictErrorV6'); expect(rejected.adopted).toBe(false)
    expect(rejected.expectedMetadataVersion).toBe(1); expect(inserted.usage.metadataVersion).toBe(2)
    expect(rejected.usage).toMatchObject({ metadataVersion: 2, namedCount: 2, protectionCount: 0 })
    expect(rejected.snapshots.map(value => value.id).sort()).toEqual([source.id, inserted.id].sort())
    expect((await completeState(page)).contentHash).toBe(before.contentHash); expect((await completeState(second, sceneId)).contentHash).toBe(before.contentHash)
    const retried = await page.evaluate(async snapshotId => {
      const { repository, workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev
      const protection = await workspace.applyRestore(await workspace.prepareRestore(snapshotId, { ids: ['c4-path'], mode: 'outdoorProperties' })); await workspace.flush()
      return { protection: { id: protection.id, contentHash: protection.contentHash }, usage: await repository.usage(protection.sceneId) }
    }, source.id)
    const after = await completeState(page)
    expect(after.document.revision).toBe(before.document.revision + 1); expect(after.document.paths['c4-path']).toMatchObject({ widthMm: 1000, movementCostMultiplier: 1 })
    for (const key of ['props', 'terrainAreas', 'scatterGroups'] as const) expect(after.document[key]).toEqual(before.document[key])
    expect(after.historyIdentity).toEqual(before.historyIdentity); expect(after.appearance).toEqual(before.appearance)
    expect(after.assets).toEqual(before.assets); expect(after.licenses).toEqual(before.licenses); expect(after.originals).toEqual(before.originals)
    expect(retried.protection.contentHash).toBe(before.contentHash); expect(retried.usage).toMatchObject({ metadataVersion: 3, namedCount: 2, protectionCount: 1 })
    expect((await completeState(second, sceneId)).contentHash).toBe(after.contentHash); checkBytes(after)
    await evidence(info, 'c4-native-protection-metadata-cas.json', { method: 'Only the method entry is gated. The other page commits native metadata and the actual compare/write transaction is native IndexedDB.', source, before, inserted, rejected, retried, after })
  } finally {
    await page.evaluate(async () => { const gate = Reflect.get(window, '__c4ProtectionGate') as ProtectionGate | undefined; if (gate) { gate.release(); await gate.pending; gate.restoreMethod(); Reflect.deleteProperty(window, '__c4ProtectionGate') } }).catch(() => {})
    await closeConnection(second); await second.close(); await closeConnection(page); await removeDatabase(page, databaseName)
  }
})

test('C4 native reopen keeps durable terrain continuity and selectively restores a deleted scatter birth without erasing manual records', async ({ page }, info) => {
  test.setTimeout(180_000)
  const databaseName = `c4-native-recovery-${crypto.randomUUID()}`
  try {
    const sceneId = await connect(page, databaseName), original = await completeState(page)
    const source = await page.evaluate(async () => {
      const { workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev, snapshot = await workspace.createNamedSnapshot('C4 durable recovery source')
      const geometryPath = '/src/core/v2/geometry.ts', viewPath = '/src/core/v3/geometry-view.ts'
      const { polygonDistance, propFootprintV2, supportedPolygon } = await import(geometryPath) as typeof import('../src/core/v2/geometry')
      const { toGeometryDocumentV2 } = await import(viewPath) as typeof import('../src/core/v3/geometry-view')
      const scene = snapshot.project.document, group = scene.scatterGroups['c4-scatter'], domain = toGeometryDocumentV2(scene)
      const members = Object.entries(group.members).filter((entry): entry is [string, typeof entry[1] & { propId: string }] => entry[1].propId !== null).sort(([a], [b]) => a.localeCompare(b))
      const prop = scene.props[members[0][1].propId], obstacles = members.slice(1).map(([, member]) => propFootprintV2(scene.props[member.propId]))
      let movedPosition: { x: number; y: number } | null = null, bestDistance = -1
      // Retain the declared terrain support, with room for the actual footprint.
      for (let y = 9500; y <= 18500; y += 500) for (let x = 1500; x <= 18500; x += 500) {
        if (Math.hypot(prop.positionMm.x - x, prop.positionMm.y - y) < 1000) continue
        const footprint = propFootprintV2({ ...prop, positionMm: { x, y } })
        if (!supportedPolygon(domain, footprint, prop.supportRef, prop.floorId) || group.exclusions.some(exclusion => polygonDistance(footprint, exclusion.boundaryMm) <= 1e-7)) continue
        const clearance = Math.min(...obstacles.map(other => polygonDistance(footprint, other)))
        // Leave clearance for the later deleted member's buffered exclusion.
        if (clearance <= group.minDistanceMm + 1) continue
        if (clearance > bestDistance) { bestDistance = clearance; movedPosition = { x, y } }
      }
      if (!movedPosition) throw new Error('C4 fixture requires a supported move clear of scatter exclusions and other members')
      return { id: snapshot.id, contentHash: snapshot.contentHash, moved: members[0], deleted: members[1], detached: members[2], movedPosition }
    })
    await executeAndSave(page, [
      { type: 'updatePath', id: 'c4-path', changes: { widthMm: 1400, movementCostMultiplier: 2 } },
      { type: 'setTerrainElevation', id: 'c4-terrain', groundElevationMm: 500 },
      { type: 'updateProp', id: source.moved[1].propId, changes: { positionMm: source.movedPosition } },
      { type: 'deleteProp', id: source.deleted[1].propId },
      { type: 'detachScatterMember', groupId: 'c4-scatter', propId: source.detached[1].propId },
    ])
    const edited = await completeState(page)
    expect(edited.document.scatterGroups['c4-scatter'].members[source.moved[0]].state).toBe('manual')
    expect(edited.document.scatterGroups['c4-scatter'].members[source.deleted[0]].state).toBe('deleted')
    expect(edited.document.scatterGroups['c4-scatter'].members[source.detached[0]].state).toBe('detached')
    await closeConnection(page); await connect(page, databaseName, sceneId)
    const reopened = await completeState(page); expect(reopened.contentHash).toBe(edited.contentHash); expect(reopened.historyIdentity).toEqual(edited.historyIdentity)
    const restored = await page.evaluate(async ({ snapshotId, deletedId }) => {
      const { workspace, repository } = Reflect.get(window, '__c4StorageDev') as NativeDev
      const geometry = await workspace.prepareRestore(snapshotId, { ids: ['c4-terrain', 'c4-path'], mode: 'outdoorGeometry' })
      const geometryScope = { affectedIds: geometry.plan.affectedIds, changes: geometry.plan.changes, commandCost: geometry.plan.commandCost }
      await workspace.applyRestore(geometry); await workspace.flush()
      const member = await workspace.prepareRestore(snapshotId, { ids: [deletedId], mode: 'scatterMembers' })
      const memberScope = { affectedIds: member.plan.affectedIds, changes: member.plan.changes, commandCost: member.plan.commandCost }
      await workspace.applyRestore(member); await workspace.flush()
      const sceneId = workspace.getState().project!.document.sceneId
      return { geometryScope, memberScope, usage: await repository.usage(sceneId), automatic: await repository.listSnapshots(sceneId) }
    }, { snapshotId: source.id, deletedId: source.deleted[1].propId })
    const after = await completeState(page), scatter = after.document.scatterGroups['c4-scatter']
    expect(after.document.revision).toBe(edited.document.revision + 2)
    expect(after.document.terrainAreas['c4-terrain'].groundElevationMm).toBe(0)
    expect(after.document.paths['c4-path']).toMatchObject({ widthMm: 1000, movementCostMultiplier: 2 })
    expect(after.document.props[source.deleted[1].propId]).toEqual(original.document.props[source.deleted[1].propId])
    expect(scatter.members[source.deleted[0]]).toEqual(original.document.scatterGroups['c4-scatter'].members[source.deleted[0]])
    expect(scatter.members[source.moved[0]]).toEqual(edited.document.scatterGroups['c4-scatter'].members[source.moved[0]])
    expect(scatter.members[source.detached[0]]).toEqual(edited.document.scatterGroups['c4-scatter'].members[source.detached[0]])
    expect(after.document.props[source.moved[1].propId]).toEqual(edited.document.props[source.moved[1].propId])
    expect(after.document.props[source.detached[1].propId]).toEqual(edited.document.props[source.detached[1].propId])
    expect(scatter.exclusions).toEqual(edited.document.scatterGroups['c4-scatter'].exclusions.filter(value => value.sourceCandidateKey !== source.deleted[0]))
    expect(after.historyIdentity.propTokens[source.deleted[1].propId]).toBe(original.historyIdentity.propTokens[source.deleted[1].propId])
    expect(restored.geometryScope.affectedIds).toEqual(expect.arrayContaining(['c4-terrain', 'c4-path', 'c4-scatter']))
    expect(restored.memberScope.affectedIds).toContain('c4-scatter'); expect(restored.usage.protectionCount).toBe(2)
    expect(after.assets).toEqual(edited.assets); expect(after.licenses).toEqual(edited.licenses); expect(after.originals).toEqual(edited.originals); checkBytes(after)
    const automatic = await page.evaluate(async ({ sceneId, revision }) => {
      const { repository } = Reflect.get(window, '__c4StorageDev') as NativeDev, project = await repository.loadSnapshot(sceneId, revision)
      if (!project) throw new Error('Native automatic checkpoint missing')
      const fixturePath = '/tests/c4-fixtures.ts', { describeC4Project } = await import(fixturePath) as typeof import('./c4-fixtures')
      return describeC4Project(project)
    }, { sceneId, revision: edited.document.revision })
    expect(automatic.contentHash).toBe(edited.contentHash); expect(automatic.originals).toEqual(edited.originals)
    await page.evaluate(async () => { const { workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev; workspace.undo(); await workspace.flush() })
    const undone = await completeState(page)
    expect(undone.document.revision).toBe(after.document.revision + 1); expect(undone.document.props[source.deleted[1].propId]).toBeUndefined()
    expect(undone.document.scatterGroups['c4-scatter']).toEqual(edited.document.scatterGroups['c4-scatter'])
    await page.evaluate(async () => { const { workspace } = Reflect.get(window, '__c4StorageDev') as NativeDev; workspace.redo(); await workspace.flush() })
    const redone = await completeState(page)
    expect(redone.document.revision).toBe(undone.document.revision + 1); expect(redone.document.props).toEqual(after.document.props)
    expect(redone.document.scatterGroups).toEqual(after.document.scatterGroups)
    await evidence(info, 'c4-native-checkpoint-recovery.json', { method: 'Native close/reopen, persisted outdoor birth/topology tokens, selected geometry and one deleted scatter birth, exact automatic checkpoint read, monotonic undo/redo.', original, source, edited, reopened, restored, after, automatic, undone, redone })
  } finally { await closeConnection(page); await removeDatabase(page, databaseName) }
})

test('C4 selected native and portable history branches retain licensed bytes and malformed packages leave the opened branch intact', async ({ page }, info) => {
  test.setTimeout(180_000)
  const databaseName = `c4-native-archive-${crypto.randomUUID()}`
  try {
    const sceneId = await connect(page, databaseName)
    const report = await page.evaluate(async sceneId => {
      const { workspace, repository } = Reflect.get(window, '__c4StorageDev') as NativeDev
      const fixturePath = '/tests/c4-fixtures.ts', ioPath = '/src/io/v6/project-file.ts', zipPath = '/node_modules/fflate/esm/browser.js'
      const { describeC4Project } = await import(fixturePath) as typeof import('./c4-fixtures'), io = await import(ioPath) as typeof import('../src/io/v6/project-file')
      const { unzipSync, zipSync } = await import(zipPath) as typeof import('fflate')
      const source = await workspace.createNamedSnapshot('Selected source'), omitted = await workspace.createNamedSnapshot('Omitted source')
      await workspace.execute([{ type: 'updatePath', id: 'c4-path', changes: { widthMm: 1700 } }]); await workspace.flush()
      const protection = await workspace.applyRestore(await workspace.prepareRestore(source.id, { ids: ['c4-path'], mode: 'outdoorGeometry' })); await workspace.flush()
      const before = await describeC4Project(workspace.getState().project!), historyBefore = await repository.listNamedSnapshots(sceneId), scenesBefore = await repository.list()
      const selected = await repository.exportArchive(sceneId, [source.id, protection.id])
      const local = await repository.importArchive(selected), localReopened = (await repository.load(local.project.document.sceneId))!
      const file = await io.exportHistoryArchiveV6(selected), files = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const decoded = await io.importHistoryArchiveV6(file), portable = await repository.importArchive(decoded)
      const portableReopened = (await repository.load(portable.project.document.sceneId))!
      const snapshots = []
      for (const summary of await repository.listNamedSnapshots(portable.project.document.sceneId)) {
        const snapshot = (await repository.loadNamedSnapshot(summary.id, portable.project.document.sceneId))!
        snapshots.push({ ...summary, actualContentHash: await io.projectContentHashV6(snapshot.project), project: await describeC4Project(snapshot.project) })
      }
      const knownScenes = await repository.list(), knownHistory = await repository.listNamedSnapshots(sceneId), knownUsage = await repository.usage(sceneId)
      const errors: { variant: string; message: string }[] = []
      const reject = async (variant: string, operation: () => Promise<unknown>) => {
        try { await operation(); throw new Error(`Malformed fixture accepted: ${variant}`) } catch (error) {
          if (String(error).includes('Malformed fixture accepted')) throw error
          errors.push({ variant, message: String(error) })
        }
      }
      await reject('unknown-selected-snapshot', () => repository.exportArchive(sceneId, ['unknown-c4-snapshot']))
      const wrongHash = structuredClone(decoded); wrongHash.snapshots[0].contentHash = 'f'.repeat(64)
      await reject('native-history-content-hash', () => workspace.adoptArchive(wrongHash))
      const missingLicense = structuredClone(decoded); delete missingLicense.project.licenses[Object.keys(missingLicense.project.licenses)[0]]
      await reject('native-license-missing', () => workspace.adoptArchive(missingLicense))
      const badOriginal = structuredClone(selected); badOriginal.project.migrationSource!.original = new Blob(['wrong v5 original'])
      await reject('native-original-bytes', () => workspace.adoptArchive(badOriginal))
      const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
      const digest = async (value: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value.slice().buffer))).map(v => v.toString(16).padStart(2, '0')).join('')
      const packageFile = (entries: Record<string, Uint8Array>) => new Blob([zipSync(entries).slice().buffer], { type: 'application/x-sceneweave' })
      const badIndexFiles = structuredClone(files), index = JSON.parse(new TextDecoder().decode(badIndexFiles['history.json'])) as { snapshots: { summary: { contentHash: string } }[] }
      index.snapshots[0].summary.contentHash = 'e'.repeat(64); badIndexFiles['history.json'] = encode(index)
      const manifest = JSON.parse(new TextDecoder().decode(badIndexFiles['manifest.json'])) as { entries: { path: string; sizeBytes: number; sha256: string }[] }
      const entry = manifest.entries.find(value => value.path === 'history.json')!; entry.sizeBytes = badIndexFiles['history.json'].length; entry.sha256 = await digest(badIndexFiles['history.json'])
      badIndexFiles['manifest.json'] = encode(manifest)
      await reject('portable-history-content-hash', async () => workspace.adoptArchive(await io.importHistoryArchiveV6(packageFile(badIndexFiles))))
      const badLicenseFiles = structuredClone(files), licensePath = Object.keys(badLicenseFiles).find(path => path.startsWith('licenses/'))!
      badLicenseFiles[licensePath] = new TextEncoder().encode('Replaced license bytes')
      await reject('portable-license-sha', async () => workspace.adoptArchive(await io.importHistoryArchiveV6(packageFile(badLicenseFiles))))
      const complete = await io.exportProjectV6(selected.project)
      await reject('wrong-package-mode', async () => workspace.adoptArchive(await io.importHistoryArchiveV6(complete)))
      const after = await describeC4Project(workspace.getState().project!), persistedAfter = await describeC4Project((await repository.load(sceneId))!)
      return { source: { id: source.id, contentHash: source.contentHash }, omittedId: omitted.id, protection: { id: protection.id, contentHash: protection.contentHash }, before, historyBefore, scenesBefore,
        selectedIds: selected.snapshots.map(value => value.id), local: await describeC4Project(localReopened), portable: await describeC4Project(portableReopened), snapshots,
        packagePaths: Object.keys(files).sort(), errors, knownScenes, scenesAfter: await repository.list(), knownHistory, historyAfter: await repository.listNamedSnapshots(sceneId),
        knownUsage, usageAfter: await repository.usage(sceneId), after, persistedAfter }
    }, sceneId)
    expect(report.selectedIds.sort()).toEqual([report.source.id, report.protection.id].sort())
    expect(report.local.document.sceneId).not.toBe(sceneId); expect(report.local.document.revision).toBe(0)
    expect(report.local.originals).toEqual(report.before.originals); checkBytes({ ...report.local, status: 'saved', error: null })
    expect(report.portable.document.sceneId).not.toBe(sceneId); expect(report.portable.document.revision).toBe(0); expect(report.portable.originals).toEqual([])
    for (const key of ['props', 'terrainAreas', 'paths', 'scatterGroups', 'prefabInstances'] as const) {
      expect(report.local.document[key]).toEqual(report.before.document[key]); expect(report.portable.document[key]).toEqual(report.before.document[key])
    }
    expect(report.portable.historyIdentity).toEqual(report.before.historyIdentity); expect(report.portable.appearance).toEqual(report.before.appearance)
    expect(report.portable.assets).toEqual(report.before.assets); expect(report.portable.licenses).toEqual(report.before.licenses); expect(report.portable.licenseBindings).toEqual(report.before.licenseBindings)
    expect(report.snapshots.map(value => value.id).sort()).toEqual(report.selectedIds)
    expect(report.snapshots.some(value => value.id === report.omittedId)).toBe(false)
    for (const snapshot of report.snapshots) { expect(snapshot.actualContentHash).toBe(snapshot.contentHash); expect(snapshot.project.originals).toEqual([]); checkBytes({ ...snapshot.project, status: 'saved', error: null }) }
    expect(report.packagePaths.some(path => path.includes('original') || path.includes('migration'))).toBe(false)
    expect(report.errors.map(value => value.variant)).toEqual(['unknown-selected-snapshot', 'native-history-content-hash', 'native-license-missing', 'native-original-bytes', 'portable-history-content-hash', 'portable-license-sha', 'wrong-package-mode'])
    expect(report.errors.every(value => value.message.length > 0)).toBe(true)
    expect(report.after.contentHash).toBe(report.before.contentHash); expect(report.persistedAfter.contentHash).toBe(report.before.contentHash)
    expect(report.after.originals).toEqual(report.before.originals); expect(report.persistedAfter.originals).toEqual(report.before.originals)
    expect(report.persistedAfter.assets).toEqual(report.before.assets); expect(report.persistedAfter.licenses).toEqual(report.before.licenses)
    expect(report.scenesAfter).toEqual(report.knownScenes); expect(report.historyAfter).toEqual(report.knownHistory); expect(report.usageAfter).toEqual(report.knownUsage)
    await evidence(info, 'c4-native-selected-history-packages.json', { method: 'Real native saves, named and protection checkpoints, local branch import retaining exact v5 bytes, portable ZIP import retaining supported scene/history/resource closure and excluding local originals. Invalid content and actual license/original bytes are rejected before replacing the current branch.', ...report })
  } finally { await closeConnection(page); await removeDatabase(page, databaseName) }
})
