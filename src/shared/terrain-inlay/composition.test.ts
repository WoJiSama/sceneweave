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
import { createTerrainInlayCommand } from './create.js'
import { encodeSceneCoordinates, decodeSceneCoordinates } from '../aggregates/scene-coordinates.js'
import { exportProject, importProject } from '../project/file.js'
import { supportSampleAt } from '../geometry/support-sample.js'
import { pointOnSurface, supportedPolygon, validateGeometry, validatePropGeometry } from '../geometry/geometry.js'
import { checkTerrainRoute, checkTerrainTravel } from '../geometry/terrain-travel.js'
import { MANUAL_TRANSACTION_BUDGET, measureCommandBudget } from '../budget/command-budget.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { TerrainInlayRequest } from './contracts.js'
import { inspectTerrainInlay, terrainInlayHash, terrainInlaySource, validateTerrainInlayProofs } from './scene.js'

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
  it('removes the road treatment while keeping the actual excavation and its contact heights', () => {
    const { result } = prepared()
    const adopted = applyCompositionDraftCommands(result, [{ ...command(result.document), finish: { kind: 'steps', treadDepthMm: 350 } }], runtime)
    const row = adopted.document.terrainConnections.road
    const removed = applyCompositionDraftCommands(adopted, [{ type: 'removeTerrainInlayRoad', id: 'road', expectedConnectionHash: terrainInlayHash(row) }], runtime)
    const ground = removed.document.terrainConnections.road
    expect(ground.terrainInlay).toMatchObject({ groundOnly: true, appearance: 'source-ground', geometry: row.terrainInlay!.geometry })
    expect(ground.terrainInlay?.finish).toBeUndefined()
    expect(ground.staircase).toBeUndefined()
    expect(removed.document.terrainAreas).toEqual(adopted.document.terrainAreas)
    physical(removed.document)
    expect(validateTerrainInlayProofs(removed.document, removed.historyIdentity)).toEqual([])
  })
  it('changes only slope finish, rejecting stale hashes, locked dependencies and invalid tread spacing', () => {
    const { result } = prepared(), adopted = applyCompositionDraftCommands(result, [command(result.document)], runtime)
    const row = adopted.document.terrainConnections.road
    const change: CompositionCommand = { type: 'setTerrainInlayFinish', id: 'road', finish: { kind: 'steps', treadDepthMm: 350 }, expectedConnectionHash: terrainInlayHash(row) }
    const after = applyCompositionDraftCommands(adopted, [change], runtime)
    const connection = cloneJson(after.document.terrainConnections.road); delete connection.terrainInlay!.finish
    expect(connection).toEqual(row); expect(after.historyIdentity).toEqual(adopted.historyIdentity)
    physical(after.document)
    expect(() => applyCompositionDraftCommands(after, [change], runtime)).toThrow(/候选之后改变/)
    const locked = applyCompositionDraftCommands(adopted, [{ type: 'setEditLock', kind: 'terrainArea', id: 'high', locked: true }], runtime)
    expect(() => applyCompositionDraftCommands(locked, [change], runtime)).toThrow(/锁/)
    expect(() => applyCompositionDraftCommands(adopted, [{ ...change, finish: { kind: 'steps', treadDepthMm: 0 } }], runtime)).toThrow()
    const reverted = applyCompositionDraftCommands(after, [{ ...change, finish: null, expectedConnectionHash: terrainInlayHash(after.document.terrainConnections.road) }], runtime)
    expect(reverted.document).toEqual(adopted.document)
  })
  it('switches explicit source-ground paint without changing real walk, fill/cut, proofs or physical identity', () => {
    const { result } = prepared(), adopted = applyCompositionDraftCommands(result, [command(result.document)], runtime)
    const original = cloneJson(adopted), row = adopted.document.terrainConnections.road
    const change: CompositionCommand = { type: 'setTerrainInlayAppearance', id: 'road', appearance: 'source-ground', expectedConnectionHash: terrainInlayHash(row) }
    const after = applyCompositionDraftCommands(adopted, [change], runtime, { budget: MANUAL_TRANSACTION_BUDGET })
    expect(after.document.terrainConnections.road.terrainInlay!.appearance).toBe('source-ground')
    const connection = cloneJson(after.document.terrainConnections.road); delete connection.terrainInlay!.appearance
    expect(connection).toEqual(row)
    expect(after.historyIdentity).toEqual(adopted.historyIdentity)
    expect(after.document.terrainAreas).toEqual(adopted.document.terrainAreas)
    expect(adopted).toEqual(original)
    physical(after.document)
    expect(validateTerrainInlayProofs(after.document, after.historyIdentity)).toEqual([])
    expect(() => applyCompositionDraftCommands(after, [change], runtime)).toThrow(/候选之后改变/)
    const restored = applyCompositionDraftCommands(after, [{ ...change, appearance: null, expectedConnectionHash: terrainInlayHash(after.document.terrainConnections.road) }], runtime)
    expect(restored.document).toEqual(adopted.document)
    const locked = applyCompositionDraftCommands(adopted, [{ type: 'setEditLock', kind: 'terrainArea', id: 'low', locked: true }], runtime)
    expect(() => applyCompositionDraftCommands(locked, [change], runtime)).toThrow(/锁/)
    expect(() => applyCompositionDraftCommands(result, [change], runtime)).toThrow(/已采用/)
  })
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

  it('does not grant a former constant-height prop or room support on the actual new slope', () => {
    const { result } = prepared(), after = applyCompositionDraftCommands(result, [command(result.document)], runtime)
    const polygon = [{ x: 2800, y: 4800 }, { x: 3200, y: 4800 }, { x: 3200, y: 5200 }, { x: 2800, y: 5200 }]
    const support = { kind: 'terrainArea' as const, id: 'low' }
    expect(supportedPolygon(result.document, polygon, support, floorId)).toBe(true)
    expect(supportedPolygon(after.document, polygon, support, floorId)).toBe(false)
    const scene = cloneJson(after.document), prop = cloneJson(fixture().project.document.props.item)
    delete prop.roomId
    scene.props.item = { ...prop, positionMm: { x: 3000, y: 5000 }, supportRef: support,
      footprintMm: { width: 400, height: 400 }, footprintOffsetMm: { x: 0, y: 0 }, visualBoundsMm: { x: -200, y: -200, width: 400, height: 400 } }
    scene.entityLayers.item = scene.entityLayers.low
    expect(validateGeometry(scene).errors.some(issue => issue.entityId === 'item' && /支撑/.test(issue.message))).toBe(true)
    const damaged = cloneJson(scene)
    damaged.terrainConnections.road.terrainInlay!.geometry.faces = {}
    expect(pointOnSurface(damaged, { x: 3000, y: 5000 }, support, floorId)).toBe(false)
    expect(supportedPolygon(damaged, polygon, support, floorId)).toBe(false)
    expect(validatePropGeometry(damaged, [damaged.props.item]).some(issue => issue.code === 'PROP_SUPPORT')).toBe(true)
    scene.props = {}; delete scene.entityLayers.item
    const points = polygon.map((point, i) => { const id = `room-vertex-${i}`; scene.vertices[id] = { id, floorId, editLocked: false, xMm: point.x, yMm: point.y }; scene.entityLayers[id] = scene.entityLayers.low; return id })
    scene.rooms.room = { id: 'room', floorId, editLocked: false, boundaryVertexIds: points, purpose: 'slope support refusal',
      visibility: 'public', accessExpectation: 'unspecified', supportRef: support, groundElevationMm: 1000, floorStyle: null }
    scene.entityLayers.room = scene.entityLayers.low
    expect(validateGeometry(scene).errors.some(issue => issue.entityId === 'room' && /支撑/.test(issue.message))).toBe(true)
  })

  it('bounds the visible-owner proof against the entire current scene before large clipping work', () => {
    const { result } = prepared(), after = applyCompositionDraftCommands(result, [command(result.document)], runtime)
    const scene = cloneJson(after.document)
    const corners = [{ x: 1000, y: 1000 }, { x: 10000, y: 1000 }, { x: 10000, y: 9000 }, { x: 1000, y: 9000 }]
    for (const id of ['hidden-a', 'hidden-b']) {
      scene.terrainAreas[id] = { ...cloneJson(scene.terrainAreas.low), id, coveragePriority: 0,
        boundaryMm: corners.flatMap((a, edge) => Array.from({ length: 512 }, (_, i) => {
          const b = corners[(edge + 1) % 4]
          return { id: `${id}-p-${edge}-${i}`, segmentId: `${id}-s-${edge}-${i}`,
            positionMm: { x: Math.round(a.x + (b.x - a.x) * i / 512), y: Math.round(a.y + (b.y - a.y) * i / 512) } }
        })) }
      scene.entityLayers[id] = scene.entityLayers.low
    }
    expect(inspectTerrainInlay(scene, scene.terrainConnections.road)).toEqual([
      expect.objectContaining({ code: 'TERRAIN_INLAY', message: expect.stringMatching(/完整点边保护值/) }),
    ])
  })

  it('generates conservative dense integer end caps, freezes original fields and roundtrips owned aggregate geometry', () => {
    const { result } = prepared(), scene = cloneJson(result.document), original = scene.terrainConnections.road
    original.from.positionMm = { x: 2500, y: 4801 }; original.to.positionMm = { x: 8000, y: 5107 }
    const source = certifyCompositionContent(createCompositionContent(scene, runtime)), input = createTerrainInlayCommand(scene, 'road')
    const after = applyCompositionDraftCommands(source, [input], runtime)
    expect(validateGeometry(after.document).errors).toEqual([])
    const world = cloneJson(after.document)
    world.aggregateCoordinates = { encoding: 'world', groups: { group: { id: 'group', floorId, parentId: null,
      frame: { translationMm: { x: 1307, y: -519 }, quarterTurns: 1 }, editLocked: false, members: [{ kind: 'terrainConnection', id: 'road' }] } } }
    const local = encodeSceneCoordinates(world)
    expect(local.terrainConnections.road.terrainInlay!.geometry.verticesMm).not.toEqual(world.terrainConnections.road.terrainInlay!.geometry.verticesMm)
    expect(local.terrainConnections.road.terrainInlay!.geometry.sources).toEqual(world.terrainConnections.road.terrainInlay!.geometry.sources)
    expect(local.terrainConnections.road.terrainInlay!.originalConnection).toEqual(original)
    expect(decodeSceneCoordinates(local)).toEqual(world)
    const damagedOpening = cloneJson(after.document), inlay = damagedOpening.terrainConnections.road.terrainInlay!
    inlay.originalConnection.openingId = 'missing-door'; inlay.originalConnectionHash = terrainInlayHash(inlay.originalConnection)
    expect(validateSceneDocument(damagedOpening).ok).toBe(false)
    const damagedEnd = cloneJson(after.document), row = damagedEnd.terrainConnections.road.terrainInlay!
    row.originalConnection.from.positionMm.y++; row.originalConnectionHash = terrainInlayHash(row.originalConnection)
    expect(validateSceneDocument(damagedEnd).ok).toBe(false)
  })

  it('continues route heights toward a differently oriented source chain without changing any walk node or face', () => {
    const { result } = prepared(), scene = cloneJson(result.document), high = scene.terrainAreas.high
    const old = high.boundaryMm[0]
    high.boundaryMm.unshift({ ...old, id: 'chain-leading-point', segmentId: 'chain-leading-edge', positionMm: { x: 5000, y: 3000 } })
    const before = cloneJson(scene), plain = createTerrainInlayCommand(scene, 'road')
    const intent = { side: 'right' as const, startStation: 0, endStation: 1, sourceAreaId: 'high',
      sourcePointIds: high.boundaryMm.slice(0, 3).map(p => p.id), connectorsMm: [] }
    const opened = createTerrainInlayCommand(scene, 'road', intent), geometry = opened.geometry
    expect([0, 1, 2].map(i => geometry.verticesMm[`opening-source-${i}`].z)).toEqual([2000, 2000, 3000])
    for (const [id, p] of Object.entries(plain.geometry.verticesMm)) expect(geometry.verticesMm[id]).toEqual(p)
    expect(Object.values(geometry.faces).filter(f => f.kind === 'walk')).toEqual(Object.values(plain.geometry.faces))
    expect(geometry.walkBoundaryVertexIds).toEqual(plain.geometry.walkBoundaryVertexIds)
    expect(createTerrainInlayCommand(scene, 'road', intent)).toEqual(opened)
    expect(scene).toEqual(before)
    const source = certifyCompositionContent(createCompositionContent(scene, runtime))
    const after = applyCompositionDraftCommands(source, [opened], runtime)
    expect(validateGeometry(after.document).errors).toEqual([])
    expect(after.document.terrainAreas).toEqual(scene.terrainAreas)
  })

  it('rejects an opening equally near different-height route branches instead of silently choosing a branch', () => {
    const { result } = prepared(), scene = cloneJson(result.document), road = scene.terrainConnections.road
    road.to.positionMm = { x: 2000, y: 7000 }
    const line = [road.from.positionMm, { x: 4000, y: 5000 }, { x: 4000, y: 7000 }, road.to.positionMm]
    road.route = { version: 1, kind: 'polyline', centerlineMm: line, sampleSpacingMm: 20000, toleranceMm: 1,
      segments: line.slice(1).map((end, i) => ({ id: `branch-${i}`, start: line[i], control1: line[i], control2: end, end })),
      stairStyle: 'stone', treadDepthMm: 300 }
    scene.terrainAreas.high.boundaryMm[0].positionMm = { x: 3000, y: 6000 }
    const before = cloneJson(scene)
    expect(() => createTerrainInlayCommand(scene, 'road', { side: 'right', startStation: 0, endStation: 3, sourceAreaId: 'high',
      sourcePointIds: scene.terrainAreas.high.boundaryMm.slice(0, 2).map(p => p.id), connectorsMm: [] })).toThrow(/等距.*不同高度/)
    expect(scene).toEqual(before)
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
    const paint = await workspace.preview([{ type: 'setTerrainInlayAppearance', id: 'road', appearance: 'source-ground',
      expectedConnectionHash: terrainInlayHash(workspace.getDocument()!.terrainConnections.road) }])
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.appearance).toBeUndefined()
    await workspace.adoptPreview(paint)
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.appearance).toBe('source-ground')
    workspace.undo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toEqual(actual)
    workspace.redo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.appearance).toBe('source-ground')
    const beforeFinish = cloneJson(workspace.getDocument()!.terrainConnections.road.terrainInlay)
    const finish = await workspace.preview([{ type: 'setTerrainInlayFinish', id: 'road', finish: { kind: 'steps', treadDepthMm: 350 },
      expectedConnectionHash: terrainInlayHash(workspace.getDocument()!.terrainConnections.road) }])
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.finish).toBeUndefined()
    await workspace.adoptPreview(finish)
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.finish).toEqual({ kind: 'steps', treadDepthMm: 350 })
    expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.geometry).toEqual(beforeFinish!.geometry)
    workspace.undo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay).toEqual(beforeFinish)
    workspace.redo(); expect(workspace.getDocument()!.terrainConnections.road.terrainInlay!.finish?.kind).toBe('steps')
    await workspace.flush()
    const cold = (await repository.load(workspace.getDocument()!.sceneId))!
    expect(cold.project.document).toEqual(workspace.getDocument())
    expect(validateTerrainInlayProofs(cold.project.document, cold.project.historyIdentity)).toEqual([])
    physical(cold.project.document)
    const bytes = await exportProject(cold, validation), imported = await importProject(bytes, validation)
    expect(imported.project.document).toEqual(cold.project.document)
    expect(imported.project.historyIdentity).toEqual(cold.project.historyIdentity)
  }, 30000)
})
