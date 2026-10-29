import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import type { SceneDocument, TerrainArea } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import * as snapshots from '../validation/snapshots.js'
import { projectEditorScene, projectScene } from './projection.js'

afterEach(() => { vi.restoreAllMocks() })

const floorId = 'visual-floor', layerId = 'visual-layer-ground'
function rectangle(x: number, y: number, width: number, height: number) {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
}
function fixture() {
  const scene = createRefinedBlankDocument('island', { sceneId: 'connection-projection', title: 'Connection projection', widthMm: 24000, heightMm: 18000,
    preset: 'narrative', now: '2026-10-29T00:00:00.000Z' })
  const area = (id: string, x: number, elevation: number): TerrainArea => ({ id, floorId, editLocked: false, visibility: 'public',
    boundaryMm: rectangle(x, 1000, 10000, 14000).map((positionMm, index) => ({ id: `${id}-p${index}`, segmentId: `${id}-s${index}`, positionMm })),
    groundElevationMm: elevation, coveragePriority: 10, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 })
  scene.terrainAreas.low = area('low', 1000, 1000); scene.terrainAreas.high = area('high', 11000, 3000)
  scene.terrainConnections.stairs = { id: 'stairs', floorId, editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'terrainArea', id: 'low' }, positionMm: { x: 9500, y: 8000 } },
    to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 12500, y: 8000 } },
    widthMm: 1500, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
  for (const id of ['low', 'high', 'stairs']) scene.entityLayers[id] = layerId
  scene.notes.label = { id: 'label', floorId, editLocked: false, visibility: 'public', kind: 'label', text: 'stairs label',
    anchor: { type: 'entity', entityKind: 'terrainConnection', entityId: 'stairs' } }
  scene.entityLayers.label = layerId
  return scene
}
function mask(scene: SceneDocument) {
  scene.regions.mask = { id: 'mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1,
    boundaryMm: rectangle(0, 0, 24000, 18000) }
  scene.entityLayers.mask = layerId
}
function connectionTexture(scene: SceneDocument) {
  const material = Object.values(scene.materials)[0]
  scene.terrainConnections.stairs.surfaceStyle = { base: { materialRef: { id: material.id, version: material.version },
    tileSizeMm: { ...material.defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
  return material.textureAssetId
}
function roomFixture() {
  const scene = fixture(), points = rectangle(11000, 5000, 6000, 6000)
  for (const [index, point] of points.entries()) {
    const id = `room-v${index}`, wallId = `room-w${index}`
    scene.vertices[id] = { id, floorId, editLocked: false, xMm: point.x, yMm: point.y }
    scene.walls[wallId] = { id: wallId, floorId, editLocked: false, startVertexId: id, endVertexId: `room-v${(index + 1) % points.length}`,
      thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.entityLayers[id] = layerId; scene.entityLayers[wallId] = layerId
  }
  scene.rooms.room = { id: 'room', floorId, editLocked: false, visibility: 'public', boundaryVertexIds: points.map((_, index) => `room-v${index}`),
    purpose: 'Public room', supportRef: { kind: 'terrainArea', id: 'high' }, groundElevationMm: 3000, floorStyle: null, accessExpectation: 'unspecified' }
  scene.openings.door = { id: 'door', floorId, editLocked: false, wallId: 'room-w3', offsetReferenceVertexId: 'room-v3', offsetMm: 2000, widthMm: 2000,
    kind: 'door', state: 'closed', locked: true, secret: false, revealed: false }
  scene.entityLayers.room = layerId; scene.entityLayers.door = layerId
  scene.terrainConnections.stairs.to.surfaceRef = { kind: 'room', id: 'room' }
  scene.terrainConnections.stairs.openingId = 'door'
  return scene
}
function isolateRoomProjection() {
  // Room/door audience rules are exercised independently of the separate
  // full-wall support validator; this fixture is no creation/geometry evidence.
  vi.spyOn(snapshots, 'validateSceneSnapshot').mockImplementation(input => ({ ok: true, document: structuredClone(input as SceneDocument), warnings: [] }))
}

describe('audience-owned connection supports for disposable cliff openings', () => {
  it('projects a detached support ID pair with real endpoint order, width and elevations for each audience', () => {
    const scene = fixture(), before = canonicalJson(scene)
    for (const audience of ['gm', 'player'] as const) {
      const projected = projectScene(scene, audience), connection = projected.connections[0]
      expect(connection).toMatchObject({ surfaceIds: ['low', 'high'], widthMm: 1500, fromElevationMm: 1000, toElevationMm: 3000 })
      expect(connection).not.toHaveProperty('from'); expect(connection).not.toHaveProperty('to')
      connection.surfaceIds![0] = 'changed-copy'; connection.start.x += 10
      expect(projectScene(scene, audience).connections[0].surfaceIds).toEqual(['low', 'high'])
    }
    expect(canonicalJson(scene)).toBe(before)
    ;[scene.terrainConnections.stairs.from, scene.terrainConnections.stairs.to] = [scene.terrainConnections.stairs.to, scene.terrainConnections.stairs.from]
    expect(projectScene(scene, 'gm').connections[0]).toMatchObject({ surfaceIds: ['high', 'low'], fromElevationMm: 3000, toElevationMm: 1000 })
  })

  it.each(['connection', 'support'] as const)('filters a private %s before exposing connection support IDs or dependent labels', target => {
    const scene = fixture(), texture = connectionTexture(scene); mask(scene)
    if (target === 'connection') scene.terrainConnections.stairs.visibility = 'gm'
    else scene.terrainAreas.high.visibility = 'gm'
    expect(projectScene(scene, 'gm').connections[0].surfaceIds).toEqual(['low', 'high'])
    expect(projectScene(scene, 'gm').assetIds).toContain(texture)
    const player = projectScene(scene, 'player')
    expect(player.connections).toEqual([]); expect(player.notes).toEqual([]); expect(player.assetIds).not.toContain(texture)
  })

  it.each(['stairs', 'low', 'high'] as const)('omits the connection when editor layer hiding removes %s, without changing formal output', id => {
    const scene = fixture(), hidden = 'hidden-layer'
    scene.userLayers[hidden] = { id: hidden, floorId, name: 'Hidden in editor only', order: Object.keys(scene.userLayers).length, editLocked: false }
    scene.entityLayers[id] = hidden
    const before = canonicalJson(scene), formal = projectScene(scene, 'player')
    expect(projectEditorScene(scene, { hiddenLayerIds: new Set([hidden]) }).connections).toEqual([])
    expect(projectScene(scene, 'player')).toEqual(formal)
    expect(formal.connections[0].surfaceIds).toEqual(['low', 'high']); expect(canonicalJson(scene)).toBe(before)
  })

  it('retains the physical connection and its supports when explicitly blocked or its real door is closed and locked', () => {
    const terrainScene = fixture(); terrainScene.terrainConnections.stairs.blocksMovement = true
    for (const audience of ['gm', 'player'] as const) expect(projectScene(terrainScene, audience).connections[0]).toMatchObject({ surfaceIds: ['low', 'high'], blocksMovement: true })
    isolateRoomProjection()
    const scene = roomFixture(), before = canonicalJson(scene)
    for (const audience of ['gm', 'player'] as const) expect(projectScene(scene, audience).connections[0]).toMatchObject({ surfaceIds: ['low', 'room'], blocksMovement: false })
    scene.terrainConnections.stairs.blocksMovement = true
    for (const audience of ['gm', 'player'] as const) expect(projectScene(scene, audience).connections[0]).toMatchObject({ surfaceIds: ['low', 'room'], blocksMovement: true })
    scene.terrainConnections.stairs.blocksMovement = false
    expect(canonicalJson(scene)).toBe(before)
  })

  it('conceals a connection through an unrevealed secret door and its dependent label before player decoration and resources', () => {
    isolateRoomProjection()
    const scene = roomFixture(), texture = connectionTexture(scene); mask(scene); scene.openings.door.secret = true
    const before = canonicalJson(scene), gm = projectScene(scene, 'gm'), player = projectScene(scene, 'player')
    expect(player.connections).toEqual([]); expect(player.notes).toEqual([])
    expect(gm.connections[0].surfaceIds).toEqual(['low', 'room'])
    expect(gm.assetIds).toContain(texture); expect(player.assetIds).not.toContain(texture)
    const withoutConnection = structuredClone(scene)
    delete withoutConnection.terrainConnections.stairs; delete withoutConnection.entityLayers.stairs
    delete withoutConnection.notes.label; delete withoutConnection.entityLayers.label
    expect(player).toEqual(projectScene(withoutConnection, 'player'))
    expect(canonicalJson(scene)).toBe(before)
    scene.openings.door.revealed = true
    delete scene.regions.mask; delete scene.entityLayers.mask
    expect(projectScene(scene, 'player').connections[0].surfaceIds).toEqual(['low', 'room'])
    expect(projectScene(scene, 'player').notes.map(note => note.id)).toEqual(['label'])
  })

  it('requires the existing full private-geometry mask when a secret door conceals an otherwise public connection', () => {
    isolateRoomProjection()
    const scene = roomFixture(); scene.openings.door.secret = true
    expect(() => projectScene(scene, 'player')).toThrow('固定遮罩未覆盖私密几何')
    expect(projectScene(scene, 'gm').connections[0].surfaceIds).toEqual(['low', 'room'])
  })
})
