import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { createEmptyGeneration5 } from '../../shared/terrain-generation/composition-contracts.js'
import { connectionRouteSchema, sampleConnectionRoute, type ConnectionRoute } from '../../shared/geometry/connection-route.js'
import { measureTaskBudget } from '../../shared/budget/task-budget.js'
import { inspectOutdoorChanges } from '../../shared/commands/outdoor.js'
import { checkTerrainRoute } from '../../shared/geometry/terrain-travel.js'
import { validateSceneScope, applySceneOperation, publicSceneContext } from '../../shared/ai/scene-authoring.js'
import { validateAuthoringStart } from '../../shared/ai/authoring.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { validateSceneDocument } from '../../shared/validation/scene.js'
import { cloneJson } from '../../shared/validation/json.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { selectionScene } from '../../editor/native-canvas/selection-scene.js'
import { isCertifiedSceneSnapshot } from '../../shared/validation/snapshots.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { fromBundle, toBundle } from './project.js'
import { Workspace } from './workspace.js'

const sessions: Workspace[] = [], repositories: ProjectRepository[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close().catch(() => {})
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
async function setup() {
  const bundle = fixture(), scene = cloneJson(bundle.project.document), floorId = 'blank-floor', layerId = scene.entityLayers.item
  for (const key of ['vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups'] as const) scene[key] = {}
  scene.entityLayers = {}; scene.constraints.entranceOpeningIds = []; scene.constraints.pathChecks = []
  scene.schemaVersion = 1; scene.mapMode = 'scene'; scene.regional = null
  scene.exportBoundsMm = { x: 0, y: 0, width: 60000, height: 20000 }; scene.floors[floorId].boundsMm = { ...scene.exportBoundsMm }
  scene.visual = { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }
  scene.generation = createEmptyGeneration5()
  scene.terrainAreas.high = { id: 'high', floorId, editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 30000, y: 1000 }, { x: 59000, y: 1000 }, { x: 59000, y: 19000 }, { x: 30000, y: 19000 }].map((positionMm, i) => ({ id: `high-p${i}`, segmentId: `high-s${i}`, positionMm })),
    groundElevationMm: 1200, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.entityLayers.high = layerId
  const content = createCompositionContent(scene, runtime), project = await fromBundle({ ...bundle, project: { ...bundle.project, schemaVersion: 1, ...content } }, validation)
  const repo = new ProjectRepository({ name: `curved-edits-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace); await workspace.adoptNew(project)
  return { workspace, repo, floorId, layerId }
}
function route(points = [{ x: 20000, y: 5000 }, { x: 25000, y: 5000 }, { x: 25000, y: 12000 }, { x: 40000, y: 12000 }], spacing = 1500): ConnectionRoute {
  const segments = points.slice(1).map((end, i) => ({ id: `route-s${i}`, start: points[i], control1: points[i], control2: end, end }))
  const source = { version: 1 as const, kind: 'polyline' as const, segments, sampleSpacingMm: spacing, toleranceMm: 20, stairStyle: 'stone' as const, treadDepthMm: 300 }
  return connectionRouteSchema.parse({ ...source, centerlineMm: sampleConnectionRoute(source) })
}
const create = (floorId: string, layerId: string, value = route()) => ({ type: 'createTerrainConnection' as const, id: 'curved', floorId, layerId, kind: 'stairs' as const,
  from: { surfaceRef: { kind: 'floor' as const, id: floorId }, positionMm: value.centerlineMm[0] }, to: { surfaceRef: { kind: 'terrainArea' as const, id: 'high' }, positionMm: value.centerlineMm.at(-1)! }, widthMm: 1200, route: value })

describe('curved connection editing authority', () => {
  it('keeps native selection lock/order views disposable without re-certifying generated content', async () => {
    const { workspace } = await setup(), original = workspace.getDocument()!, hash = projectContentHash(toBundle(workspace.getState().project!).project)
    const view = selectionScene(original, { effectiveLocks: true, layerOrder: true })
    expect(Object.isFrozen(view)).toBe(true); expect(isCertifiedSceneSnapshot(view)).toBe(false)
    expect(workspace.getDocument()).toBe(original)
    expect(projectContentHash(toBundle(workspace.getState().project!).project)).toBe(hash)
  })
  it('previews the full footprint without writes, then saves once and restores complete route on undo/redo', async () => {
    const { workspace, repo, floorId, layerId } = await setup(), before = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const preview = await workspace.preview([create(floorId, layerId)])
    expect(workspace.getState().project).toBe(before); expect(workspace.checkpoint()).toBe(checkpoint)
    expect((await repo.load(before.document.sceneId))!.project.document.terrainConnections).toEqual({})
    await workspace.adoptPreview(preview); await workspace.flush()
    const adopted = workspace.getState().project!, saved = (await repo.load(adopted.document.sceneId))!
    expect(adopted.document.revision).toBe(before.document.revision + 1)
    expect(projectContentHash(saved.project)).toBe(projectContentHash(toBundle(adopted).project))
    expect(checkTerrainRoute(adopted.document, { floorId, pointsMm: [{ x: 20000, y: 5000 }, { x: 25000, y: 5000 }, { x: 25000, y: 12000 }, { x: 40000, y: 12000 }], widthMm: 800 }).ok).toBe(true)
    workspace.undo(); await workspace.flush(); expect(workspace.getDocument()!.terrainConnections).toEqual({})
    workspace.redo(); await workspace.flush(); expect(workspace.getDocument()!.terrainConnections.curved.route).toEqual(adopted.document.terrainConnections.curved.route)
  })
  it('rejects current dependency locks, retaining current and cold content', async () => {
    const { workspace, repo, floorId, layerId } = await setup()
    await workspace.execute([{ type: 'setEditLock', kind: 'terrainArea', id: 'high', locked: true }]); await workspace.flush()
    const locked = workspace.getState().project!
    await expect(workspace.preview([create(floorId, layerId)])).rejects.toThrow(/锁/)
    expect(workspace.getState().project).toBe(locked)
    expect((await repo.load(locked.document.sceneId))!.project.document.terrainConnections).toEqual({})
  })
  it('rejects an older connection candidate after locking its support, retaining both current and saved content', async () => {
    const { workspace, repo, floorId, layerId } = await setup()
    const candidate = await workspace.preview([create(floorId, layerId)])
    await workspace.execute([{ type: 'setEditLock', kind: 'terrainArea', id: 'high', locked: true }])
    await workspace.flush()
    const current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const persisted = (await repo.load(current.document.sceneId))!
    const hash = projectContentHash(persisted.project)
    await expect(workspace.adoptPreview(candidate)).rejects.toThrow(/场景已有修改/)
    expect(workspace.getState().project).toBe(current)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(current.document.terrainAreas.high.editLocked).toBe(true)
    expect(current.document.terrainConnections).toEqual({})
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(hash)
  })
  it('separates a detailed route from its controls and full materialized sample budget', async () => {
    const { workspace, floorId, layerId } = await setup(), before = workspace.getState().project!
    const value = route([{ x: 10000, y: 10000 }, { x: 50000, y: 10000 }], 250)
    const after = cloneJson(before.document); after.terrainConnections.curved = { ...create(floorId, layerId, value), editLocked: false, visibility: 'public', openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }; delete (after.terrainConnections.curved as unknown as Record<string, unknown>).type; delete (after.terrainConnections.curved as unknown as Record<string, unknown>).layerId; after.entityLayers.curved = layerId
    expect(validateSceneDocument(after).ok).toBe(true)
    expect(inspectOutdoorChanges(before.document, after, ['curved']).commandCost).toBeGreaterThan(256)
    const usage = measureTaskBudget(before.document, after)
    expect(usage.geometryPoints).toBeGreaterThanOrEqual(value.centerlineMm.length + 4); expect(usage.curveSegments).toBe(1)
    const preview = await workspace.preview([create(floorId, layerId, value)])
    expect(preview.budgetUsage?.semanticTargets).toBe(1)
    expect(preview.budgetUsage!.geometryPoints).toBeGreaterThan(160)
    expect(workspace.getState().project).toBe(before)
  })
  it('does not send new-format geometry through unsupported AI start, operation or context APIs', async () => {
    const { workspace, floorId, layerId } = await setup(), project = toBundle(workspace.getState().project!).project
    const scope = { floorId, layerId, boundsMm: project.document.exportBoundsMm, entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], generationLayerIds: [layerId], regionalDefinitionIds: [], operations: ['terrainGenerate'] }
    expect(() => validateSceneScope(project, scope as never)).toThrow(/当前明确能力协议/)
    expect(() => applySceneOperation(project, scope as never, {} as never, runtime, new Set())).toThrow(/当前明确能力协议/)
    expect(() => publicSceneContext(project, scope as never, new Set())).toThrow(/当前明确能力协议/)
    expect(() => validateAuthoringStart({ schemaVersion: 1, project, baseContentHash: projectContentHash(project), seed: 'fcb3353d-8c8f-4890-b002-a9f5a464a769', preparedAt: '2026-10-31T00:00:00.000Z',
      skill: { id: 'sceneweave-prop-authoring', version: 1 }, disclosure: 'complete-metadata/public-model', scope: { targetIds: [], operations: [], placement: null, scene: scope } } as never)).toThrow(/当前明确能力协议/)
  })
})
