import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { advanceHistoryIdentity, createHistoryIdentityTrace, nativeHistoryIdentitySchema } from '../../shared/history/identity.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { applyProjectDelta, createProjectDelta } from '../../shared/project/delta.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { cloneJson } from '../../shared/validation/json.js'
import { validateSceneDocument } from '../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { sampleConnectionRoute } from '../../shared/geometry/connection-route.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { captureEditableDraft, fromBundle, toBundle, validateEditableProject, type EditableProject } from './project.js'
import { prepareTerrainUpgrade } from './terrain.js'
import { prepareCompositionUpgrade } from './terrain-composition.js'
import { prepareConnectionUpgrade } from './connection-upgrade.js'
import { prepareDecorationUpgrade } from './decoration-upgrade.js'
import { Workspace } from './workspace.js'

const repositories: ProjectRepository[] = [], sessions: Workspace[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
async function source5() {
  const base = captureEditableDraft(await fromBundle(fixture({ image: true }), validation))
  base.schemaVersion = 2; base.document.schemaVersion = 2; base.document.visual = emptyVisualSystem()
  const scene = base.document, floorId = 'blank-floor', layerId = scene.entityLayers.item
  scene.terrainAreas.high = { id: 'high', floorId, editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 10000, y: 1000 }, { x: 18000, y: 1000 }, { x: 18000, y: 18000 }, { x: 10000, y: 18000 }].map((positionMm, i) => ({ id: `high-p${i}`, segmentId: `high-s${i}`, positionMm })),
    groundElevationMm: 800, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainConnections.stairs = { id: 'stairs', floorId, editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: { x: 8000, y: 6000 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 12000, y: 6000 } },
    widthMm: 1000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
  scene.entityLayers.high = layerId; scene.entityLayers.stairs = layerId
  Object.assign(base, createCompositionContent(scene, runtime))
  const v3 = await prepareTerrainUpgrade(await validateEditableProject(base, validation), { runtime, validation })
  const v4 = await prepareCompositionUpgrade(v3, { runtime, validation })
  const v5 = await prepareConnectionUpgrade(v4, { runtime, validation }), candidate = captureEditableDraft(v5)
  const route = { version: 1 as const, kind: 'cubic' as const, segments: [{ id: 'route-s', start: { x: 8000, y: 6000 }, control1: { x: 9000, y: 5500 }, control2: { x: 11000, y: 6500 }, end: { x: 12000, y: 6000 } }], sampleSpacingMm: 800, toleranceMm: 20, stairStyle: 'wood' as const, treadDepthMm: 250 }
  candidate.document.terrainConnections.stairs.route = { ...route, centerlineMm: sampleConnectionRoute(route) }
  candidate.historyIdentity = advanceHistoryIdentity(v5.historyIdentity, v5.document, candidate.document, runtime)
  const token = <T extends string>(kind: T) => ({ kind, token: runtime.ids.nextId(), topologyToken: runtime.ids.nextId(), topologyHash: 'a'.repeat(64) })
  candidate.historyIdentity.propTokens['deleted-prop'] = runtime.ids.nextId(); candidate.historyIdentity.prefabTokens['deleted-prefab'] = runtime.ids.nextId()
  candidate.historyIdentity.outdoorTokens['deleted-outdoor'] = token('terrainConnection')
  candidate.historyIdentity.generationTokens!['deleted-rule'] = token('generationRule')
  candidate.historyIdentity.regionalTokens!['deleted-regional'] = token('regionalPoint')
  candidate.historyIdentity.presentationTokens!['deleted-presentation'] = token('materializedStroke')
  candidate.historyIdentity.terrainTokens!['deleted-terrain'] = token('terrainFeature')
  return validateEditableProject(candidate, validation)
}
async function decorated(source: EditableProject) {
  const draft = captureEditableDraft(source)
  draft.document.decorations!.flower = { id: 'flower', floorId: 'blank-floor', editLocked: false, visibility: 'public', definitionRef: { id: 'definition', version: 1 },
    supportRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 2500, y: 2500 }, rotationDeg: 0, scalePpm: 1_000_000, renderOrder: 0 }
  draft.document.entityLayers.flower = draft.document.entityLayers.item
  draft.historyIdentity = advanceHistoryIdentity(source.historyIdentity, source.document, draft.document, runtime)
  return validateEditableProject(draft, validation)
}

describe('strict complete6 decoration copies and identity4', () => {
  it('adds only empty v6 records and the new identity pool while preserving route, all old tombstones and actual bytes', async () => {
    const source = await source5(), before = toBundle(source).project, target = await prepareDecorationUpgrade(source, { runtime, validation })
    expect(target).toMatchObject({ schemaVersion: 6, document: { schemaVersion: 6, revision: 0, decorations: {}, decorationClusters: {} }, historyIdentity: { version: 4, decorationTokens: {} } })
    expect(target.document.sceneId).not.toBe(source.document.sceneId); expect(target.historyIdentity.lineageId).not.toBe(source.historyIdentity.lineageId)
    expect(target.document.terrainConnections).toEqual(source.document.terrainConnections)
    for (const key of ['propTokens', 'prefabTokens', 'outdoorTokens', 'generationTokens', 'regionalTokens', 'presentationTokens', 'terrainTokens'] as const) expect(target.historyIdentity[key]).toEqual(source.historyIdentity[key])
    for (const key of ['appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) expect(target[key]).toEqual(source[key])
    for (const hash of Object.keys(source.assets)) expect(await target.resources.read(hash)).toEqual(await source.resources.read(hash))
    expect(toBundle(source).project).toEqual(before)
    expect(validateSceneDocument({ ...target.document, schemaVersion: 5 }).ok).toBe(false)
    expect(nativeHistoryIdentitySchema.safeParse({ ...target.historyIdentity, version: 3 }).success).toBe(false)
    await expect(prepareDecorationUpgrade(target, { runtime, validation })).rejects.toThrow(/完整v5/)
  })
  it('saves complete decoration records and real resources through package and reversible delta round trips', async () => {
    const base = await prepareDecorationUpgrade(await source5(), { runtime, validation }), target = await decorated(base)
    const bundle = toBundle(target), bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation)
    expect(round.project.schemaVersion).toBe(6); expect(projectContentHash(round.project)).toBe(projectContentHash(bundle.project))
    expect(round.project.document.decorations).toEqual(target.document.decorations)
    const delta = createProjectDelta(toBundle(base).project, bundle.project)
    expect(applyProjectDelta(toBundle(base).project, delta, 'forward')).toEqual(bundle.project)
    expect(applyProjectDelta(bundle.project, delta, 'backward')).toEqual(toBundle(base).project)
  })
  it('retains decoration birth during movement and forbids reusing deleted IDs across every identity pool', async () => {
    const base = await prepareDecorationUpgrade(await source5(), { runtime, validation }), source = await decorated(base)
    const changed = cloneJson(source.document); changed.decorations!.flower.positionMm.x += 200; changed.decorations!.flower.scalePpm = 1_100_000
    expect(advanceHistoryIdentity(source.historyIdentity, source.document, changed, runtime).decorationTokens!.flower).toEqual(source.historyIdentity.decorationTokens!.flower)
    const trace = createHistoryIdentityTrace(source.historyIdentity, source.document, runtime), removed = cloneJson(source.document)
    delete removed.decorations!.flower; delete removed.entityLayers.flower; trace.observe(removed)
    expect(() => trace.finish(cloneJson(source.document))).toThrow(/不能复用/)
    const conflict = cloneJson(source.document); conflict.decorations!['deleted-prop'] = { ...conflict.decorations!.flower, id: 'deleted-prop' }; conflict.entityLayers['deleted-prop'] = conflict.entityLayers.flower
    expect(() => advanceHistoryIdentity(source.historyIdentity, source.document, conflict, runtime)).toThrow(/冲突/)
  })
  it('preserves the full v5 source graph, named/protection snapshots and originals before publishing a cold-checked v6 copy', async () => {
    const repo = new ProjectRepository({ name: `decor-copy-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
    const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
    await workspace.adoptNew(await source5())
    await workspace.execute([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 17 } }]); await workspace.flush()
    const source = workspace.getState().project!, sourceId = source.document.sceneId, hash = projectContentHash(toBundle(source).project)
    const named = await workspace.createNamedSnapshot('v5 retained')
    await repo.createSnapshot(toBundle(source), 'v5 protected', { id: 'v5-protected', kind: 'protection', expectedRevision: source.document.revision, expectedMetadataVersion: await repo.historyMetadataVersion(sourceId) })
    await workspace.enableDecorationCopy()
    const target = workspace.getState().project!, cold = await repo.load(target.document.sceneId)
    expect(cold!.project).toEqual(toBundle(target).project); expect(target.schemaVersion).toBe(6)
    expect(projectContentHash((await repo.load(sourceId))!.project)).toBe(hash); expect(await repo.loadSnapshot(sourceId, named.id)).not.toBeNull()
    const transfer = await repo.exportNativeUpgradeCapsule(target.document.sceneId)
    expect(transfer.capsule.family.automatic.map(row => row.revision)).toEqual([0, 1]); expect(transfer.capsule.family.snapshots.map(row => row.kind).sort()).toEqual(['named', 'protection'])
    expect(transfer.capsule.targetInitialProject).toEqual(toBundle(target).project)
    expect(transfer.capsule.version).toBe(2); if (transfer.capsule.version === 2) expect(transfer.capsule.historyGraph.versions).toHaveLength(2)
    expect((await repo.listNativeUpgradeSummaries(target.document.sceneId))[0].sourceSchemaVersion).toBe(5)
    const portable = await repo.exportNativeUpgradeFile(target.document.sceneId), empty = new ProjectRepository({ name: `decor-originals-${crypto.randomUUID()}`, runtime, validation }); repositories.push(empty)
    await empty.importNativeUpgradeFile(portable); expect((await empty.exportNativeUpgradeCapsule(target.document.sceneId)).capsule).toEqual(transfer.capsule)
    const forged = captureEditableDraft(await prepareDecorationUpgrade(source, { runtime, validation })); forged.document.props.item.rotationDeg++
    await expect(repo.preserveNativeUpgrade(toBundle(source), toBundle(forged))).rejects.toThrow(/保留全部/)
  })
  it('keeps the v5 current session and usable undo if the independent target save fails', async () => {
    const repo = new ProjectRepository({ name: `decor-copy-failure-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
    const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
    await workspace.adoptNew(await source5()); await workspace.execute([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 17 } }]); await workspace.flush()
    const source = workspace.getState().project!, checkpoint = workspace.checkpoint()
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('v6 target quota'))
    await expect(workspace.enableDecorationCopy()).rejects.toThrow('v6 target quota')
    expect(workspace.getState().project).toBe(source); expect(workspace.checkpoint()).toBe(checkpoint); expect(workspace.getState().canUndo).toBe(true)
    expect((await repo.load(source.document.sceneId))!.project).toEqual(toBundle(source).project)
  })
})
