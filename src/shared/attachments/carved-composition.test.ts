import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fromBundle } from '../../application/workspace/project.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { CarvedRockCommand } from '../commands/carved-rock.js'
import type { CompositionCommand, CompositionContent } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import { connectionFootprint, pointInPolygon, validateGeometry } from '../geometry/geometry.js'
import { supportSampleAt } from '../geometry/support-sample.js'
import { assertTerrainConnectionClearances, checkTerrainRoute, checkTerrainTravel } from '../geometry/terrain-travel.js'
import { projectScene } from '../projection/projection.js'
import { certifyCompositionContent } from '../validation/content.js'
import { cloneJson } from '../validation/json.js'
import { validateAttachmentProofs } from './identity.js'
import { inspectAttachments } from './validation.js'
import { MANUAL_TRANSACTION_BUDGET, measureCommandBudget } from '../budget/command-budget.js'

const floorId = 'blank-floor'
function bundle() {
  const value = fixture(), scene = value.project.document
  delete scene.props.item; delete scene.props.other; delete scene.entityLayers.item; delete scene.entityLayers.other
  Object.assign(value.project, createCompositionContent(scene, runtime))
  return value
}
function content(value: Pick<CompositionContent, 'document' | 'historyIdentity' | 'appearance'>): CompositionContent {
  return { document: value.document, historyIdentity: value.historyIdentity, appearance: value.appearance }
}
const createArea: CompositionCommand = { type: 'createTerrainArea', id: 'rock', floorId,
  boundaryMm: [{ x: 6000, y: 4000 }, { x: 20000, y: 4000 }, { x: 20000, y: 14000 }, { x: 6000, y: 14000 }],
  groundElevationMm: 2000, visibility: 'public', surfaceStyle: null }
const makeRock: CompositionCommand = { type: 'setRockBody', id: 'rock', rockBody: { baseElevationMm: -500 } }
const addSource: CompositionCommand = { type: 'addAttachmentSurface', id: 'rock-face', owner: { kind: 'terrainArea', id: 'rock' },
  feature: { kind: 'rockSourceFace', sourceSegmentIds: ['rock:segment:0'] }, capabilities: ['embed'] }
function path(scene: SceneDocument, visibility: 'public' | 'gm' = 'public'): Extract<CarvedRockCommand, { type: 'createCarvedMountainPath' }> {
  return { type: 'createCarvedMountainPath', id: 'mountain-path', attachmentId: 'path-embed', walkSurfaceId: 'path-walk', sourceSurfaceId: 'rock-face',
    fromSurfaceRef: { kind: 'floor', id: floorId }, toSurfaceRef: { kind: 'terrainArea', id: 'rock' },
    pointsMm: [{ x: 6000, y: 6000, z: 0 }, { x: 18000, y: 6000, z: 2000 }], widthMm: 1000, cutSide: 'right',
    layerId: scene.entityLayers.rock, visibility, follow: 'follow' }
}
function rock() {
  const source = certifyCompositionContent(content(bundle().project))
  const area = applyCompositionDraftCommands(source, [createArea], runtime)
  return applyCompositionDraftCommands(area, [makeRock, addSource], runtime)
}
function assertPhysical(value: CompositionContent) {
  const scene = value.document
  expect(validateGeometry(scene).errors).toEqual([])
  expect(inspectAttachments(scene)).toEqual([])
  expect(validateAttachmentProofs(scene, value.historyIdentity)).toEqual([])
  expect(supportSampleAt(scene, floorId, { x: 12000, y: 6000 }, 'path-walk')).toMatchObject({
    rootSupportRef: { kind: 'terrainArea', id: 'rock' }, actualSurfaceId: 'path-walk', zMm: 1000, walkable: true, sourceConnectionId: 'mountain-path',
  })
  const route = checkTerrainRoute(scene, { floorId, pointsMm: [{ x: 5000, y: 6000 }, { x: 19000, y: 6000 }], widthMm: 1000 })
  expect(route.ok, JSON.stringify(route.issues)).toBe(true)
  expect(route.connectionIds).toEqual(['mountain-path'])
  expect(() => assertTerrainConnectionClearances(scene, [{ connectionId: 'mountain-path', minWidthMm: 1000, approachDepthMm: 1000 }])).not.toThrow()
}
const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) { const name = repository.database.name; repository.close(); await Dexie.delete(name) }
})

describe('actual carved mountain-path composition and persistence', () => {
  it('admits the complete dense route under the current manual meter and retains legacy mixed rejection', () => {
    const prepared = rock(), before = cloneJson(prepared), command = path(prepared.document)
    command.pointsMm = Array.from({ length: 33 }, (_, i) => ({ x: 6000 + i * 375, y: 6000, z: Math.round(i * 2000 / 32) }))
    expect(() => applyCompositionDraftCommands(prepared, [command], runtime)).toThrow(/256/)
    expect(prepared).toEqual(before)
    const adopted = applyCompositionDraftCommands(prepared, [command], runtime, { budget: MANUAL_TRANSACTION_BUDGET })
    const strip = adopted.document.terrainConnections['mountain-path'].carvedStrip!
    expect(strip.stations.map(row => strip.verticesMm[row.centerVertexId])).toEqual(command.pointsMm)
    expect(strip.walkFaceIds).toHaveLength(128)
    expect(inspectAttachments(adopted.document)).toEqual([])
    expect(validateAttachmentProofs(adopted.document, adopted.historyIdentity)).toEqual([])
    expect(validateGeometry(adopted.document).errors).toEqual([])
    const usage = measureCommandBudget(prepared.document, adopted.document, { before: prepared, after: adopted }, undefined, MANUAL_TRANSACTION_BUDGET)
    expect(usage.semanticTargets).toBe(3)
    expect(usage.geometryPoints).toBeLessThanOrEqual(MANUAL_TRANSACTION_BUDGET.limits.geometryPoints)
    expect(usage.geometrySegments).toBeLessThanOrEqual(MANUAL_TRANSACTION_BUDGET.limits.geometrySegments)
    expect(prepared).toEqual(before)
  })

  it('creates physical rock, explicit source and complete cut through public commands before projecting the same geometry', () => {
    const prepared = rock(), result = applyCompositionDraftCommands(prepared, [path(prepared.document)], runtime)
    const scene = result.document, strip = scene.terrainConnections['mountain-path'].carvedStrip!
    assertPhysical(result)
    expect(result.historyIdentity.outdoorTokens['mountain-path'].kind).toBe('terrainConnection')
    expect(result.historyIdentity.structureTokens!['path-walk'].kind).toBe('attachmentSurface')
    expect(result.historyIdentity.structureTokens!['path-embed'].kind).toBe('attachment')
    expect(scene.attachments!['path-embed'].proofs.child.birthToken).toBe(result.historyIdentity.outdoorTokens['mountain-path'].token)
    const gm = projectScene(scene, 'gm', result.appearance, { floorId }), player = projectScene(scene, 'player', result.appearance, { floorId })
    expect(player.rocks).toEqual(gm.rocks)
    expect(player.rocks![0].patches).toHaveLength(Object.keys(strip.faces).length)
    expect(player.rocks![0].facets.length).toBeGreaterThan(0)
    expect(player.connections).toEqual(gm.connections)
    expect(player.connections[0]).toMatchObject({ id: 'mountain-path', kind: 'ramp', carvedFootprintMm: connectionFootprint(scene.terrainConnections['mountain-path']) })
    expect(player.connections[0].route).toBeUndefined()
    const top = player.terrain.find(row => row.id === 'rock')!
    expect(top.regionsMm!.some(region => pointInPolygon({ x: 12000, y: 6000 }, region.outerMm) && !region.holesMm.some(hole => pointInPolygon({ x: 12000, y: 6000 }, hole)))).toBe(false)
    expect(JSON.stringify(player)).not.toMatch(/birthToken|topologyToken|carvedStrip|sourceSegmentIds/)
  })

  it('filters a private cut before deriving player cliffs and top, leaving no secret cut silhouette', () => {
    const prepared = rock(), baseline = projectScene(prepared.document, 'player', prepared.appearance, { floorId })
    const result = applyCompositionDraftCommands(prepared, [path(prepared.document, 'gm')], runtime)
    const gm = projectScene(result.document, 'gm', result.appearance, { floorId }), player = projectScene(result.document, 'player', result.appearance, { floorId })
    expect(gm.rocks![0].patches.length).toBeGreaterThan(0)
    expect(player.rocks![0].patches).toEqual([])
    expect(player.rocks).toEqual(baseline.rocks)
    expect(player.terrain).toEqual(baseline.terrain)
    expect(player.connections).toEqual([])
    expect(player.masks).toEqual(baseline.masks)
    expect(JSON.stringify(player)).not.toMatch(/mountain-path|path-embed|path-walk|birthToken|topologyToken/)
  })

  it('adopts an irregular host through the same complete commands and projects public and private cuts from its actual outline', () => {
    const initial = certifyCompositionContent(content(bundle().project))
    const boundaryMm = [{ x: 6000, y: 4000 }, { x: 18000, y: 4000 }, { x: 19800, y: 7000 },
      { x: 19000, y: 12500 }, { x: 14500, y: 15000 }, { x: 9500, y: 14000 }, { x: 6000, y: 11000 }]
    const created = applyCompositionDraftCommands(initial, [{ ...createArea, boundaryMm } as CompositionCommand, makeRock, addSource], runtime)
    const command = path(created.document); command.pointsMm[1] = { x: 17000, y: 6000, z: 2000 }
    const adopted = applyCompositionDraftCommands(created, [command], runtime)
    expect(validateGeometry(adopted.document).errors).toEqual([])
    expect(inspectAttachments(adopted.document)).toEqual([])
    expect(validateAttachmentProofs(adopted.document, adopted.historyIdentity)).toEqual([])
    expect(adopted.document.terrainAreas.rock.boundaryMm.map(row => row.positionMm)).toEqual(boundaryMm)
    const route = checkTerrainRoute(adopted.document, { floorId, pointsMm: [{ x: 5000, y: 6000 }, { x: 18000, y: 6000 }], widthMm: 1000 })
    expect(route.ok, JSON.stringify(route.issues)).toBe(true)
    const gm = projectScene(adopted.document, 'gm', adopted.appearance, { floorId })
    const player = projectScene(adopted.document, 'player', adopted.appearance, { floorId })
    expect(player.rocks).toEqual(gm.rocks)
    expect(player.terrain.find(row => row.id === 'rock')!.points).toEqual(boundaryMm)
    const privateCut = applyCompositionDraftCommands(created, [{ ...command, visibility: 'gm' }], runtime)
    const baseline = projectScene(created.document, 'player', created.appearance, { floorId })
    const privatePlayer = projectScene(privateCut.document, 'player', privateCut.appearance, { floorId })
    expect(privatePlayer.rocks).toEqual(baseline.rocks)
    expect(privatePlayer.terrain).toEqual(baseline.terrain)
    expect(privatePlayer.connections).toEqual([])
  })

  it('uses the whole real width and rejects side-wall, apron and floating-landing shortcuts', () => {
    const prepared = rock(), result = applyCompositionDraftCommands(prepared, [path(prepared.document)], runtime), scene = result.document
    expect(checkTerrainTravel(scene, { floorId, from: { x: 8000, y: 6000 }, to: { x: 16000, y: 6000 }, widthMm: 1000 }).ok).toBe(true)
    expect(checkTerrainTravel(scene, { floorId, from: { x: 8000, y: 6000 }, to: { x: 16000, y: 6000 }, widthMm: 1001 }).ok).toBe(false)
    expect(checkTerrainTravel(scene, { floorId, from: { x: 12000, y: 6000 }, to: { x: 12000, y: 8000 }, widthMm: 200 }).issues.some(row => row.code === 'TERRAIN_HEIGHT_CONNECTION')).toBe(true)
    expect(supportSampleAt(scene, floorId, { x: 12000, y: 4500 })).toMatchObject({ zMm: 1000, walkable: false })
    const invalid = path(prepared.document); invalid.pointsMm[0] = { x: 7000, y: 6000, z: 0 }
    expect(() => applyCompositionDraftCommands(prepared, [invalid], runtime)).toThrow(/接入|低端|山路|净宽/)
    expect(prepared.document.terrainConnections['mountain-path']).toBeUndefined()
    expect(() => applyCompositionDraftCommands(result, [{ type: 'setRockBody', id: 'rock', rockBody: null }], runtime)).toThrow(/岩体|宿主/)
    expect(() => applyCompositionDraftCommands(result, [{ type: 'detachPropAttachment', id: 'path-embed' }], runtime)).toThrow(/嵌入|切削|山路/)
    expect(() => applyCompositionDraftCommands(result, [{ type: 'removeAttachmentSurface', id: 'path-walk' }], runtime)).toThrow(/依赖|切削|山路/)
  })

  it('checks the actual source dependency lock and forbids a public cut into a private host', () => {
    const prepared = rock()
    const locked = applyCompositionDraftCommands(prepared, [{ type: 'setEditLock', kind: 'terrainArea', id: 'rock', locked: true }], runtime)
    expect(() => applyCompositionDraftCommands(locked, [path(locked.document)], runtime)).toThrow(/锁定/)
    const privateRock = applyCompositionDraftCommands(prepared, [{ type: 'updateTerrainArea', id: 'rock', changes: { visibility: 'gm' } }], runtime)
    expect(() => applyCompositionDraftCommands(privateRock, [path(privateRock.document)], runtime)).toThrow(/公开|私密/)
    expect(() => applyCompositionDraftCommands(prepared, [{ ...path(prepared.document), sourceSurfaceId: 'not-a-source' }], runtime)).toThrow(/源岩面/)
  })

  it('adopts the actual command closure, restores its exact cut on undo/redo and cold-reads all saved geometry and proofs', async () => {
    const repository = new ProjectRepository({ name: `carved-composition-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle(bundle(), validation))
    await workspace.execute([createArea]); await workspace.execute([makeRock, addSource]); await workspace.execute([path(workspace.getDocument()!)])
    const original = cloneJson(workspace.getDocument()!.terrainConnections['mountain-path'].carvedStrip!)
    const originalIdentity = cloneJson(workspace.getState().project!.historyIdentity.outdoorTokens['mountain-path'])
    assertPhysical(content(workspace.getState().project!))
    const checkpoint = workspace.checkpoint()
    await expect(workspace.execute([{ type: 'setRockBody', id: 'rock', rockBody: null }])).rejects.toThrow(/岩体|宿主/)
    expect(workspace.checkpoint()).toBe(checkpoint)
    workspace.undo()
    expect(workspace.getDocument()!.terrainConnections['mountain-path']).toBeUndefined()
    expect(supportSampleAt(workspace.getDocument()!, floorId, { x: 12000, y: 6000 })).toMatchObject({ zMm: 2000, walkable: true })
    workspace.redo()
    expect(workspace.getDocument()!.terrainConnections['mountain-path'].carvedStrip).toEqual(original)
    expect(workspace.getState().project!.historyIdentity.outdoorTokens['mountain-path'].topologyToken).not.toBe(originalIdentity.topologyToken)
    assertPhysical(content(workspace.getState().project!))
    await workspace.execute([{ type: 'removeCarvedMountainPath', id: 'mountain-path', disposition: 'restore-source-rock' }])
    expect(workspace.getDocument()!.terrainConnections['mountain-path']).toBeUndefined()
    expect(workspace.getDocument()!.attachmentSurfaces!['path-walk']).toBeUndefined()
    expect(workspace.getDocument()!.attachments!['path-embed']).toBeUndefined()
    expect(workspace.getDocument()!.attachmentSurfaces!['rock-face']).toBeDefined()
    workspace.undo()
    expect(workspace.getDocument()!.terrainConnections['mountain-path'].carvedStrip).toEqual(original)
    assertPhysical(content(workspace.getState().project!))
    await workspace.flush()
    const owner = workspace.getDocument()!.sceneId, cold = (await repository.load(owner))!
    expect(cold.project.document).toEqual(workspace.getDocument())
    expect(cold.project.historyIdentity).toEqual(workspace.getState().project!.historyIdentity)
    assertPhysical(content(cold.project))
    const damaged = { ...cold, project: cloneJson(cold.project) }
    const vertexId = original.stations[0].centerVertexId
    damaged.project.document.terrainConnections['mountain-path'].carvedStrip!.verticesMm[vertexId].z += 100
    await expect(fromBundle(damaged, validation)).rejects.toThrow(/接触面|零横坡|摘要/)
  })
})
