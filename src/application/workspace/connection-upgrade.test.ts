import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { listCatalogItems } from '../../shared/library/content.js'
import { sampleConnectionRoute, type ConnectionRoute } from '../../shared/geometry/connection-route.js'
import { advanceHistoryIdentity, createHistoryIdentityTrace } from '../../shared/history/identity.js'
import { buildRestorePlan } from '../../shared/history/restore.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { applyProjectDelta, createProjectDelta } from '../../shared/project/delta.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { cloneJson } from '../../shared/validation/json.js'
import { sceneDocumentSchema, validateSceneDocument } from '../../shared/validation/scene.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { captureEditableDraft, fromBundle, toBundle, validateEditableProject, type EditableProject } from './project.js'
import { prepareTerrainUpgrade } from './terrain.js'
import { prepareCompositionUpgrade } from './terrain-composition.js'
import { prepareConnectionUpgrade } from './connection-upgrade.js'
import { Workspace } from './workspace.js'

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
const content = (project: EditableProject) => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

async function source4(): Promise<EditableProject> {
  const base = captureEditableDraft(await fromBundle(fixture({ image: true }), validation))
  base.schemaVersion = 2; base.document.schemaVersion = 2; base.document.visual = emptyVisualSystem()
  const scene = base.document, floorId = 'blank-floor', layerId = scene.entityLayers.item
  scene.terrainAreas.high = { id: 'high', floorId, editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 10000, y: 1000 }, { x: 18000, y: 1000 }, { x: 18000, y: 18000 }, { x: 10000, y: 18000 }].map((positionMm, i) => ({ id: `high-point-${i}`, segmentId: `high-segment-${i}`, positionMm })),
    groundElevationMm: 800, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainConnections.stairs = { id: 'stairs', floorId, editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: { x: 8000, y: 6000 } },
    to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 12000, y: 6000 } }, widthMm: 1000,
    openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
  scene.entityLayers.high = layerId; scene.entityLayers.stairs = layerId
  Object.assign(base, createCompositionContent(scene, runtime))
  const source = await validateEditableProject(base, validation)
  const upgraded = captureEditableDraft(await prepareCompositionUpgrade(await prepareTerrainUpgrade(source, { runtime, validation }), { runtime, validation }))
  const identity = upgraded.historyIdentity
  identity.propTokens['deleted-prop'] = runtime.ids.nextId(); identity.prefabTokens['deleted-prefab'] = runtime.ids.nextId()
  const token = <T extends string>(kind: T) => ({ kind, token: runtime.ids.nextId(), topologyToken: runtime.ids.nextId(), topologyHash: 'a'.repeat(64) })
  identity.outdoorTokens['deleted-outdoor'] = token('terrainConnection')
  identity.generationTokens!['deleted-rule'] = token('generationRule')
  identity.regionalTokens!['deleted-regional-point'] = token('regionalPoint')
  identity.presentationTokens!['deleted-stroke'] = token('materializedStroke')
  identity.terrainTokens!['deleted-feature'] = token('terrainFeature')
  return validateEditableProject(upgraded, validation)
}
function route(): ConnectionRoute {
  const source = { version: 1 as const, kind: 'cubic' as const, segments: [{ id: 'route-segment', start: { x: 8000, y: 6000 }, control1: { x: 9000, y: 5500 }, control2: { x: 11000, y: 6500 }, end: { x: 12000, y: 6000 } }], sampleSpacingMm: 800, toleranceMm: 20, stairStyle: 'stone' as const, treadDepthMm: 300 }
  return { ...source, centerlineMm: sampleConnectionRoute(source) }
}
async function routed(base: EditableProject): Promise<EditableProject> {
  const draft = captureEditableDraft(base)
  draft.document.terrainConnections.stairs.route = route()
  draft.historyIdentity = advanceHistoryIdentity(base.historyIdentity, base.document, draft.document, runtime)
  return validateEditableProject(draft, validation)
}

describe('strict complete5 connection copies', () => {
  it('preserves absent-route records, immutable resources, all identity pools and old strict schemas', async () => {
    const source = await source4(), before = toBundle(source).project
    const target = await prepareConnectionUpgrade(source, { runtime, validation })
    expect(source).toMatchObject({ schemaVersion: 4, document: { schemaVersion: 4 } })
    expect(target).toMatchObject({ schemaVersion: 5, document: { schemaVersion: 5, revision: 0 }, historyIdentity: { version: 3 }, appearance: { version: 2 } })
    expect(target.document.sceneId).not.toBe(source.document.sceneId); expect(target.historyIdentity.lineageId).not.toBe(source.historyIdentity.lineageId)
    expect(target.document.terrainConnections).toEqual(source.document.terrainConnections)
    expect(Object.hasOwn(target.document.terrainConnections.stairs, 'route')).toBe(false)
    for (const key of ['propTokens', 'prefabTokens', 'outdoorTokens', 'generationTokens', 'regionalTokens', 'presentationTokens', 'terrainTokens'] as const) expect(target.historyIdentity[key]).toEqual(source.historyIdentity[key])
    for (const key of ['appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) expect(target[key]).toEqual(source[key])
    expect(listCatalogItems(toBundle(target))).toEqual(listCatalogItems(toBundle(source)))
    for (const hash of Object.keys(source.assets)) expect(await target.resources.read(hash)).toEqual(await source.resources.read(hash))
    expect(toBundle(source).project).toEqual(before)
    const withRoute = await routed(target), connection = withRoute.document.terrainConnections.stairs
    expect(sceneDocumentSchema.shape.terrainConnections.valueType.safeParse(connection).success).toBe(false)
    expect(validateSceneDocument({ ...withRoute.document, schemaVersion: 4 }).ok).toBe(false)
    expect(validateSceneDocument({ ...target.document, terrainConnections: { stairs: { ...connection, route: null } } }).ok).toBe(false)
    await expect(prepareConnectionUpgrade(target, { runtime, validation })).rejects.toThrow(/完整v4/)
  })

  it('round-trips real bytes and source controls through complete5 packages and reversible native deltas', async () => {
    const base = await prepareConnectionUpgrade(await source4(), { runtime, validation }), target = await routed(base)
    const bundle = toBundle(target), bytes = await exportProject(bundle, validation), round = await importProject(bytes, validation)
    expect(round.project.schemaVersion).toBe(5); expect(projectContentHash(round.project)).toBe(projectContentHash(bundle.project))
    expect(round.project.document.terrainConnections.stairs.route).toEqual(route())
    const delta = createProjectDelta(toBundle(base).project, bundle.project)
    expect(applyProjectDelta(toBundle(base).project, delta, 'forward')).toEqual(bundle.project)
    expect(applyProjectDelta(bundle.project, delta, 'backward')).toEqual(toBundle(base).project)
  })

  it('keeps geometric edits continuous but advances route topology even when changed back within one transaction', async () => {
    const base = await prepareConnectionUpgrade(await source4(), { runtime, validation }), target = await routed(base)
    const changed = captureEditableDraft(target), savedRoute = changed.document.terrainConnections.stairs.route!
    savedRoute.segments[0].control1.y += 100; savedRoute.centerlineMm = sampleConnectionRoute(savedRoute)
    savedRoute.stairStyle = 'wood'; savedRoute.treadDepthMm = 250
    changed.historyIdentity = advanceHistoryIdentity(target.historyIdentity, target.document, changed.document, runtime)
    expect(changed.historyIdentity.outdoorTokens.stairs).toEqual(target.historyIdentity.outdoorTokens.stairs)
    const trace = createHistoryIdentityTrace(target.historyIdentity, target.document, runtime)
    const temporary = cloneJson(changed.document); temporary.terrainConnections.stairs.route!.segments[0].id = 'replacement-route-segment'
    trace.observe(temporary)
    const reverted = cloneJson(target.document), identity = trace.finish(reverted)
    expect(identity.outdoorTokens.stairs.token).toBe(target.historyIdentity.outdoorTokens.stairs.token)
    expect(identity.outdoorTokens.stairs.topologyHash).toBe(target.historyIdentity.outdoorTokens.stairs.topologyHash)
    expect(identity.outdoorTokens.stairs.topologyToken).not.toBe(target.historyIdentity.outdoorTokens.stairs.topologyToken)
  })

  it('restores route geometry without replacing current stair presentation, and properties restore the full route', async () => {
    const base = await prepareConnectionUpgrade(await source4(), { runtime, validation }), historical = await routed(base), current = captureEditableDraft(historical)
    const r = current.document.terrainConnections.stairs.route!; r.segments[0].control1.y += 100; r.centerlineMm = sampleConnectionRoute(r); r.stairStyle = 'wood'; r.treadDepthMm = 250
    current.historyIdentity = advanceHistoryIdentity(historical.historyIdentity, historical.document, current.document, runtime)
    const checked = await validateEditableProject(current, validation)
    const geometric = buildRestorePlan(content(checked), content(historical), { ids: ['stairs'], mode: 'outdoorGeometry' })
    expect(geometric.document.terrainConnections.stairs.route).toEqual({ ...route(), stairStyle: 'wood', treadDepthMm: 250 })
    expect(geometric.changes.find(change => change.id === 'stairs')!.fields).toContain('route')
    const properties = buildRestorePlan(content(checked), content(historical), { ids: ['stairs'], mode: 'outdoorProperties' })
    expect(properties.document.terrainConnections.stairs.route).toEqual(route())
  })

  it('preserves the whole v4 source family before publishing and cold-reading a distinct v5 project', async () => {
    const repo = new ProjectRepository({ name: `connection-copy-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
    const workspace = new Workspace(repo, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await source4())
    const preview = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 17 } }]); await workspace.adoptPreview(preview); await workspace.flush()
    const source = workspace.getState().project!, hash = projectContentHash(toBundle(source).project), sourceId = source.document.sceneId
    const named = await workspace.createNamedSnapshot('v4 source retained')
    await repo.createSnapshot(toBundle(source), 'v4 protection retained', { id: 'v4-protection', kind: 'protection', expectedRevision: source.document.revision, expectedMetadataVersion: await repo.historyMetadataVersion(sourceId) })
    await workspace.enableConnectionCopy()
    const target = workspace.getState().project!, cold = await repo.load(target.document.sceneId)
    expect(target.schemaVersion).toBe(5); expect(cold!.project).toEqual(toBundle(target).project)
    expect(projectContentHash((await repo.load(sourceId))!.project)).toBe(hash)
    expect(await repo.loadSnapshot(sourceId, named.id)).not.toBeNull()
    const transfer = await repo.exportNativeUpgradeCapsule(target.document.sceneId)
    expect(transfer.capsule.family.automatic.map(row => row.revision)).toEqual([0, 1])
    expect(transfer.capsule.family.snapshots.map(row => row.kind).sort()).toEqual(['named', 'protection'])
    expect(transfer.capsule.family.current.contentHash).toBe(hash)
    expect(transfer.capsule.targetInitialProject).toEqual(toBundle(target).project)
    expect(transfer.capsule.version).toBe(2)
    if (transfer.capsule.version === 2) expect(transfer.capsule.historyGraph.versions).toHaveLength(2)
    expect((await repo.listNativeUpgradeSummaries(target.document.sceneId))[0].sourceSchemaVersion).toBe(4)
    const portable = await repo.exportNativeUpgradeFile(target.document.sceneId)
    const empty = new ProjectRepository({ name: `connection-originals-${crypto.randomUUID()}`, runtime, validation }); repositories.push(empty)
    await empty.importNativeUpgradeFile(portable)
    expect((await empty.exportNativeUpgradeCapsule(target.document.sceneId)).capsule).toEqual(transfer.capsule)
    const forged = captureEditableDraft(await prepareConnectionUpgrade(source, { runtime, validation })); forged.document.title += ' legal title'; forged.document.props.item.rotationDeg++
    await expect(repo.preserveNativeUpgrade(toBundle(source), toBundle(forged))).rejects.toThrow(/逐字段保留/)
  })

  it('retains the current v4 session and usable undo when the target save fails after source preservation', async () => {
    const repo = new ProjectRepository({ name: `connection-copy-failure-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
    const workspace = new Workspace(repo, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await source4())
    const preview = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 17 } }]); await workspace.adoptPreview(preview); await workspace.flush()
    const current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('new target quota'))
    await expect(workspace.enableConnectionCopy()).rejects.toThrow('new target quota')
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint); expect(workspace.getState().canUndo).toBe(true)
    expect((await repo.load(current.document.sceneId))!.project).toEqual(toBundle(current).project)
  })
})
