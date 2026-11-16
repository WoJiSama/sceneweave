import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { fromBundle } from '../../application/workspace/project.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { certifyCompositionContent } from '../validation/content.js'
import { validateSceneDocument } from '../validation/scene.js'
import { validateHistoryIdentity } from '../history/identity.js'
import { cloneJson } from '../validation/json.js'
import { supportSampleAt } from '../geometry/support-sample.js'
import { validateGeometry } from '../geometry/geometry.js'
import { checkTerrainRoute, checkTerrainTravel } from '../geometry/terrain-travel.js'
import { MANUAL_TRANSACTION_BUDGET, measureCommandBudget } from '../budget/command-budget.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { TerrainInlayRequest } from './contracts.js'
import { terrainInlayHash, terrainInlaySource, validateTerrainInlayProofs } from './scene.js'

const floorId = 'blank-floor'
function prepared() {
  const bundle = fixture(), scene = bundle.project.document
  scene.props = {}; scene.entityLayers = Object.fromEntries(Object.entries(scene.entityLayers).filter(([id]) => id !== 'item' && id !== 'other'))
  const initial = certifyCompositionContent(createCompositionContent(scene, runtime))
  const create = (id: string, x0: number, z: number): CompositionCommand => ({ type: 'createTerrainArea', id, floorId,
    boundaryMm: [{ x: x0, y: id === 'high' ? 2000 : 1000 }, { x: id === 'high' ? 9500 : 10000, y: id === 'high' ? 2000 : 1000 },
      { x: id === 'high' ? 9500 : 10000, y: id === 'high' ? 8000 : 9000 }, { x: x0, y: id === 'high' ? 8000 : 9000 }],
    groundElevationMm: z, coveragePriority: id === 'high' ? 2 : 1, visibility: 'public', surfaceStyle: null })
  const result = applyCompositionDraftCommands(initial, [create('low', 1000, 1000), create('high', 5000, 3000),
    { type: 'updateTerrainArea', id: 'high', changes: { coveragePriority: 2 } },
    { type: 'createTerrainConnection', id: 'road', floorId, kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: 'low' }, positionMm: { x: 2000, y: 5000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 8000, y: 5000 } }, widthMm: 2000, openingId: null, visibility: 'public', surfaceStyle: null }], runtime)
  return { bundle, result }
}
function command(scene: ReturnType<typeof prepared>['result']['document']): Extract<CompositionCommand, { type: 'adoptTerrainInlay' }> {
  const verticesMm = { a: { x: 2000, y: 4000, z: 1000 }, b: { x: 8000, y: 4000, z: 3000 }, t: { x: 8000, y: 5000, z: 3000 },
    c: { x: 8000, y: 6000, z: 3000 }, d: { x: 2000, y: 6000, z: 1000 }, s: { x: 2000, y: 5000, z: 1000 } }
  const triangles: [string, string, string][] = [['a', 'b', 't'], ['a', 't', 's'], ['s', 't', 'c'], ['s', 'c', 'd']]
  const geometry: TerrainInlayRequest = { sources: ['low', 'high'].map(id => terrainInlaySource(scene.terrainAreas[id])), verticesMm,
    faces: Object.fromEntries(triangles.map((vertexIds, i) => [`f${i}`, { id: `f${i}`, kind: 'walk', vertexIds }])),
    footprintVertexIds: ['a', 'b', 't', 'c', 'd', 's'], walkBoundaryVertexIds: ['a', 'b', 't', 'c', 'd', 's'] }
  return { type: 'adoptTerrainInlay', id: 'road', geometry, centerlineVertexIds: ['s', 't'], expectedConnectionHash: terrainInlayHash(scene.terrainConnections.road) }
}
function physical(scene: ReturnType<typeof prepared>['result']['document']) {
  expect(validateGeometry(scene).errors).toEqual([])
  expect(supportSampleAt(scene, floorId, { x: 5000, y: 5000 })).toMatchObject({ zMm: 2000, walkable: true, sourceConnectionId: 'road' })
  const route = checkTerrainRoute(scene, { floorId, pointsMm: [{ x: 2000, y: 5000 }, { x: 8000, y: 5000 }], widthMm: 2000 })
  expect(route.ok, JSON.stringify(route.issues)).toBe(true)
  expect(route.connectionIds).toEqual(['road'])
  expect(checkTerrainTravel(scene, { floorId, from: { x: 3000, y: 3500 }, to: { x: 3000, y: 5000 }, widthMm: 100 }).ok).toBe(false)
  expect(checkTerrainTravel(scene, { floorId, from: { x: 2000, y: 5000 }, to: { x: 8000, y: 5000 }, widthMm: 2001 }).ok).toBe(false)
}
const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) { const name = repository.database.name; repository.close(); await Dexie.delete(name) }
})

describe('complete cross-terrace inlay transactions', () => {
  it('replaces one connection, retaining complete source evidence, real support and side-wall rejection', () => {
    const { result } = prepared(), before = cloneJson(result), input = command(result.document)
    const after = applyCompositionDraftCommands(result, [input], runtime, { budget: MANUAL_TRANSACTION_BUDGET })
    physical(after.document)
    expect(result).toEqual(before)
    expect(Object.keys(after.document.terrainConnections)).toEqual(['road'])
    expect(after.document.terrainConnections.road).toMatchObject({ kind: 'ramp', terrainInlay: { originalConnection: result.document.terrainConnections.road } })
    expect(after.document.terrainConnections.road.route).toBeUndefined()
    expect(after.historyIdentity.outdoorTokens.road.token).toBe(result.historyIdentity.outdoorTokens.road.token)
    expect(after.historyIdentity.outdoorTokens.road.topologyToken).not.toBe(result.historyIdentity.outdoorTokens.road.topologyToken)
    expect(validateTerrainInlayProofs(after.document, after.historyIdentity)).toEqual([])
    const usage = measureCommandBudget(result.document, after.document, { before: result, after }, undefined, MANUAL_TRANSACTION_BUDGET)
    expect(usage.semanticTargets).toBe(1)
    expect(usage.geometryPoints).toBeGreaterThanOrEqual(Object.keys(input.geometry.verticesMm).length + 8)
  })

  it('rejects stale geometry, lost identities, hidden sources, third overlaps, duplicate active geometry and locked source dependencies', () => {
    const { result } = prepared()
    const input = command(result.document), before = cloneJson(result)
    expect(() => applyCompositionDraftCommands(result, [{ ...input, expectedConnectionHash: '0'.repeat(64) }], runtime)).toThrow(/候选/)
    const badSource = cloneJson(input); badSource.geometry.sources[0].groundElevationMm++
    expect(() => applyCompositionDraftCommands(result, [badSource], runtime)).toThrow(/源面/)
    const after = applyCompositionDraftCommands(result, [input], runtime)
    const damaged = cloneJson(after.document); damaged.terrainAreas.low.coveragePriority++
    expect(validateSceneDocument(damaged).ok).toBe(false)
    const dual = cloneJson(after.document); dual.terrainConnections.road.route = { version: 1, kind: 'polyline', segments: [{ id: 'other-route', start: { x: 2000, y: 5000 }, control1: { x: 2000, y: 5000 }, control2: { x: 8000, y: 5000 }, end: { x: 8000, y: 5000 } }], centerlineMm: [{ x: 2000, y: 5000 }, { x: 8000, y: 5000 }], sampleSpacingMm: 20000, toleranceMm: 1, stairStyle: 'stone', treadDepthMm: 500 }
    expect(validateSceneDocument(dual).ok).toBe(false)
    const identity = cloneJson(after.historyIdentity); identity.outdoorTokens.low.token = 'replacement-birth'
    expect(() => validateHistoryIdentity(identity, after.document)).toThrow(/来源/)
    const locked = applyCompositionDraftCommands(result, [{ type: 'setEditLock', kind: 'terrainArea', id: 'low', locked: true }], runtime)
    expect(() => applyCompositionDraftCommands(locked, [command(locked.document)], runtime)).toThrow(/锁/)
    const hidden = applyCompositionDraftCommands(result, [{ type: 'updateTerrainArea', id: 'low', changes: { visibility: 'gm' } }, { type: 'updateTerrainConnection', id: 'road', changes: { visibility: 'gm' } }], runtime)
    const publicDraft = cloneJson(after.document); publicDraft.terrainAreas.low.visibility = 'gm'
    expect(validateSceneDocument(publicDraft).ok).toBe(false)
    expect(hidden.document.terrainAreas.low.visibility).toBe('gm')
    const third = cloneJson(after.document)
    third.terrainAreas.third = { ...cloneJson(third.terrainAreas.high), id: 'third', coveragePriority: 3,
      boundaryMm: [{ x: 4500, y: 4500 }, { x: 5500, y: 4500 }, { x: 5500, y: 5500 }, { x: 4500, y: 5500 }].map((positionMm, i) => ({ id: `third-p${i}`, segmentId: `third-s${i}`, positionMm })) }
    third.entityLayers.third = third.entityLayers.low
    expect(validateSceneDocument(third).ok).toBe(false)
    expect(result).toEqual(before)
  })

  it('restores the inactive original explicitly while preserving current business fields', () => {
    const { result } = prepared(), after = applyCompositionDraftCommands(result, [command(result.document)], runtime)
    const changed = applyCompositionDraftCommands(after, [{ type: 'setConnectionBlocked', id: 'road', blocksMovement: true }], runtime)
    const restored = applyCompositionDraftCommands(changed, [{ type: 'restoreTerrainInlaySource', id: 'road', disposition: 'restore-original-connection-and-ground' }], runtime)
    expect(restored.document.terrainConnections.road).toEqual({ ...result.document.terrainConnections.road, blocksMovement: true })
    expect(() => applyCompositionDraftCommands(after, [{ type: 'removeTerrainConnection', id: 'road' }], runtime)).toThrow(/显式恢复/)
  })

  it('uses preview/adoption, undo/redo and repository cold load with complete stored geometry and proofs', async () => {
    const { result, bundle } = prepared()
    Object.assign(bundle.project, result)
    const repository = new ProjectRepository({ name: `inlay-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle(bundle, validation))
    const preview = await workspace.preview([command(workspace.getDocument()!)])
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toBeUndefined()
    await workspace.adoptPreview(preview)
    const actual = cloneJson(workspace.getDocument()!.terrainConnections.road.terrainInlay)
    physical(workspace.getDocument()!)
    workspace.undo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toBeUndefined()
    workspace.redo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toEqual(actual)
    await workspace.flush()
    const cold = (await repository.load(workspace.getDocument()!.sceneId))!
    expect(cold.project.document).toEqual(workspace.getDocument())
    expect(validateTerrainInlayProofs(cold.project.document, cold.project.historyIdentity)).toEqual([])
    physical(cold.project.document)
  }, 30000)
})
