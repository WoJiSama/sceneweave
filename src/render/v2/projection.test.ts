import { describe, expect, it } from 'vitest'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { pointInPolygonV2 } from '../../core/v2/geometry'
import type { PointMm, PropV2, SceneDocumentV2, SurfaceStyle } from '../../core/v2/types'
import { boundsCoveredV2, projectSceneV2, transformedVisualBoundsV2 } from './projection'
import { connectionPolygonV2, terrainFaceV2, terrainShadowV2, wallGeometryV2 } from './renderer'

function empty(): SceneDocumentV2 {
  const scene = createHouse('source')
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.props = {}; scene.notes = {}; scene.regions = {}; scene.constraints.entranceOpeningIds = []
  scene.floors['f-a1'].boundsMm = { x: 0, y: 0, width: 20000, height: 20000 }; scene.exportBoundsMm = { x: 0, y: 0, width: 20000, height: 20000 }
  return migrateSceneV1(scene, { sceneId: 'copy', now: '2026-10-20T00:00:00.000Z' })
}
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function mask(scene: SceneDocumentV2, x = 1000, y = 1000, width = 7000, height = 7000) {
  scene.regions.mask = { id: 'mask', floorId: 'f-a1', editLocked: false, boundaryMm: rect(x, y, width, height), kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
}
function prop(id: string, x = 4000, y = 4000): PropV2 {
  return { id, floorId: 'f-a1', editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'chair', opacity: 1, tint: null }, visualBoundsMm: { x: -600, y: -350, width: 1200, height: 700 }, footprintMm: { width: 600, height: 600 }, footprintOffsetMm: { x: 0, y: 0 }, positionMm: { x, y }, rotationDeg: 0, blocksMovement: true, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: 'f-a1' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
}
function room(scene: SceneDocumentV2, points: PointMm[] = [{ x: 1000, y: 1000 }, { x: 8000, y: 1000 }, { x: 9000, y: 2000 }, { x: 9000, y: 7000 }, { x: 1000, y: 7000 }]) {
  points.forEach((p, i) => { const id = `v${i}`; scene.vertices[id] = { id, floorId: 'f-a1', editLocked: false, xMm: p.x, yMm: p.y }; const wid = `w${i}`; scene.walls[wid] = { id: wid, floorId: 'f-a1', editLocked: false, startVertexId: id, endVertexId: `v${(i + 1) % points.length}`, thicknessMm: 200, topStyle: null, blocksMovement: true, blocksSight: true } })
  scene.rooms.room = { id: 'room', floorId: 'f-a1', editLocked: false, boundaryVertexIds: points.map((_p, i) => `v${i}`), purpose: 'private-purpose-never-a-label', supportRef: { kind: 'floor', id: 'f-a1' }, groundElevationMm: 0, floorStyle: null, accessExpectation: 'unspecified', visibility: 'public' }
}
function note(scene: SceneDocumentV2, id: string, anchor: SceneDocumentV2['notes'][string]['anchor']) {
  scene.notes[id] = { id, floorId: 'f-a1', editLocked: false, anchor, kind: 'label', text: id, visibility: 'public' }
}

describe('B2 audience projection before visual derivation', () => {
  it('removes private members, dependent notes, material/resource metadata, and keeps source immutable', () => {
    const scene = empty(); mask(scene); scene.props.secret = prop('secret'); scene.props.secret.visibility = 'gm'
    scene.props.visible = prop('visible', 12000, 10000)
    note(scene, 'private-parent-note', { type: 'entity', entityKind: 'prop', entityId: 'secret' }); note(scene, 'nested-note', { type: 'entity', entityKind: 'note', entityId: 'private-parent-note' })
    note(scene, 'public-label', { type: 'entity', entityKind: 'prop', entityId: 'visible' })
    scene.generationMetadata = { generatorVersion: 'secret-generator', seed: 'secret-seed', adoptedAt: scene.updatedAt }
    const original = structuredClone(scene), projection = projectSceneV2(scene, 'player'), encoded = JSON.stringify(projection)
    expect(projection.props.map(p => p.id)).toEqual(['visible']); expect(projection.notes.map(n => n.text)).toEqual(['public-label'])
    expect(encoded).not.toContain('secret-generator'); expect(encoded).not.toContain('private-parent-note'); expect(encoded).not.toContain('nested-note')
    projection.props[0].positionMm.x = 5; projection.masks[0][0].x = 5; expect(scene).toEqual(original)
  })

  it('inherits privacy from support, semantic room affiliation, and whole prefab groups', () => {
    const scene = empty(); room(scene); mask(scene, 0, 0, 18000, 18000); scene.rooms.room.visibility = 'gm'
    scene.props.affiliated = { ...prop('affiliated', 12000, 10000), roomId: 'room' }
    scene.props.member = prop('member', 14000, 10000)
    scene.prefabInstances.group = { id: 'group', floorId: 'f-a1', editLocked: false, visibility: 'gm', definitionRef: { id: 'unneeded-by-render', version: 1 }, anchorMm: { x: 14000, y: 10000 }, rotationDeg: 0, members: { chair: { propId: 'member', overrideFields: [] } } }
    expect(projectSceneV2(scene, 'player').props).toEqual([]); expect(projectSceneV2(scene, 'player').walls).toEqual([])
    expect(projectSceneV2(scene, 'gm').props).toHaveLength(2)
  })

  it('uses rotated visual bounds and actual shadow expansion for privacy, not collision footprint', () => {
    const scene = empty(); scene.props.secret = prop('secret'); scene.props.secret.visibility = 'gm'; scene.props.secret.rotationDeg = 90
    const b = transformedVisualBoundsV2(scene.props.secret)
    expect(b.x).toBeCloseTo(3650); expect(b.y).toBeCloseTo(3400); expect(b.width).toBeCloseTo(700); expect(b.height).toBeCloseTo(1200)
    mask(scene, 3600, 3300, 800, 1400); expect(() => projectSceneV2(scene, 'player')).not.toThrow()
    scene.props.secret.shadowOverride = { directionDeg: 45, offsetMm: 120, blurMm: 80, opacity: .22, color: '#24313A' }
    expect(() => projectSceneV2(scene, 'player')).toThrow('装饰阴影')
  })

  it('supports conservative union masks and refuses arbitrary tight polygon masks', () => {
    expect(boundsCoveredV2({ x: 0, y: 0, width: 20, height: 20 }, [{ x: 0, y: 0, width: 10, height: 20 }, { x: 10, y: 0, width: 10, height: 20 }])).toBe(true)
    expect(boundsCoveredV2({ x: 0, y: 0, width: 20, height: 20 }, [{ x: 0, y: 0, width: 9, height: 20 }, { x: 10, y: 0, width: 10, height: 20 }])).toBe(false)
    const scene = empty(); mask(scene); scene.regions.mask.boundaryMm = [{ x: 0, y: 0 }, { x: 8000, y: 500 }, { x: 0, y: 8000 }]
    expect(() => projectSceneV2(scene, 'player')).toThrow('轴对齐矩形')
  })

  it('conceals unrevealed slanted secret windows as continuous wall and preserves endpoint reference after reversal', () => {
    const scene = empty(); room(scene)
    scene.openings.window = { id: 'window', floorId: 'f-a1', editLocked: false, wallId: 'w1', offsetReferenceVertexId: 'v1', offsetMm: 400, widthMm: 600, kind: 'window', state: 'closed', locked: false, secret: true, revealed: false }
    const gm = projectSceneV2(scene, 'gm'), before = gm.walls.find(w => w.id === 'w1')!.openings[0]
    expect(before.start.x).toBeCloseTo(8000 + 400 / Math.SQRT2); expect(before.end.y).toBeCloseTo(1000 + 1000 / Math.SQRT2)
    expect(projectSceneV2(scene, 'player').walls.flatMap(w => w.openings)).toEqual([])
    ;[scene.walls.w1.startVertexId, scene.walls.w1.endVertexId] = [scene.walls.w1.endVertexId, scene.walls.w1.startVertexId]
    expect(projectSceneV2(scene, 'gm').walls.find(w => w.id === 'w1')!.openings[0]).toEqual(before)
    scene.openings.window.revealed = true; expect(projectSceneV2(scene, 'player').walls.flatMap(w => w.openings)).toHaveLength(1)
  })

  it('filters private resources before collecting decode dependencies', () => {
    const scene = empty(); mask(scene); scene.props.secret = prop('secret'); scene.props.secret.visibility = 'gm'; scene.props.secret.appearance = { kind: 'image', assetId: 'secret-bitmap', tint: null, opacity: 1 }
    expect(projectSceneV2(scene, 'player').assetIds).toEqual([]); expect(projectSceneV2(scene, 'gm').assetIds).toEqual(['secret-bitmap'])
  })

  it('keeps world-coordinate paint phase independent of room bounds and filters private terrain first', () => {
    const scene = empty(); room(scene)
    const style: SurfaceStyle = { base: { materialRef: { id: 'wood', version: 1 }, tileSizeMm: { width: 2000, height: 2000 }, rotationDeg: 90, alignment: 'surface', originMm: { x: -750, y: 1200 }, opacity: 1, tint: null }, overlays: [] }
    scene.materials.wood = { id: 'wood', catalogId: 'wood', version: 1, name: 'Wood', licenseRef: 'MIT', origin: { kind: 'original', attribution: 'original', canEmbed: true }, tags: [], textureAssetId: 'texture', defaultTileSizeMm: { width: 2000, height: 2000 }, applicableSurfaces: ['room'] }
    scene.rooms.room.floorStyle = style; const before = projectSceneV2(scene, 'gm').rooms[0].style
    scene.vertices.v0.xMm = 500; expect(projectSceneV2(scene, 'gm').rooms[0].style).toEqual(before)
    scene.terrainAreas.hidden = { id: 'hidden', floorId: 'f-a1', editLocked: false, visibility: 'gm', groundElevationMm: 3500, coveragePriority: 50, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1, boundaryMm: rect(12000, 10000, 1000, 1000).map((p, i) => ({ id: `hidden-v${i}`, segmentId: `hidden-s${i}`, positionMm: p })) }; mask(scene, 11000, 9000, 4000, 4000)
    const player = projectSceneV2(scene, 'player'); expect(player.terrain).toEqual([]); expect(player.limitations).toEqual([])
    expect(projectSceneV2(scene, 'gm').limitations).toEqual([]); expect(projectSceneV2(scene, 'gm').edges).toHaveLength(4)
  })

  it('canonicalizes public collinear wall splits and removes all hidden wall-only geometry', () => {
    const scene = empty(); room(scene, rect(1000, 1000, 7000, 6000)); const baseline = projectSceneV2(scene, 'player').walls
    scene.vertices.split = { id: 'split', floorId: 'f-a1', editLocked: false, xMm: 4500, yMm: 1000 }; scene.walls.w0.endVertexId = 'split'
    scene.walls.extra = { ...scene.walls.w0, id: 'extra', startVertexId: 'split', endVertexId: 'v1' }; scene.rooms.room.boundaryVertexIds.splice(1, 0, 'split')
    expect(projectSceneV2(scene, 'player').walls).toEqual(baseline)
  })
})

describe('B2 derived wall bands', () => {
  it('fills the VIS-01 diagonal corner using miter joins and leaves the window interval empty', () => {
    const scene = empty(); room(scene)
    scene.openings.window = { id: 'window', floorId: 'f-a1', editLocked: false, wallId: 'w1', offsetReferenceVertexId: 'v1', offsetMm: 400, widthMm: 600, kind: 'window', state: 'closed', locked: false, secret: false, revealed: false }
    const projection = projectSceneV2(scene, 'gm'), geometry = wallGeometryV2(projection.walls), polygons = geometry.flatMap(g => g.polygons)
    expect(polygons.some(p => pointInPolygonV2({ x: 8041, y: 900 }, p))).toBe(true)
    const middle = { x: 8000 + 700 / Math.SQRT2, y: 1000 + 700 / Math.SQRT2 }
    expect(polygons.some(p => pointInPolygonV2(middle, p, false))).toBe(false)
    const other = { x: 8000 + 200 / Math.SQRT2, y: 1000 + 200 / Math.SQRT2 }
    expect(polygons.some(p => pointInPolygonV2(other, p))).toBe(true)
  })

  it('is independent of wall orientation and does not stretch or quantize slanted opening endpoints', () => {
    const scene = empty(); room(scene); const projected = projectSceneV2(scene, 'gm'), before = wallGeometryV2(projected.walls).flatMap(g => g.polygons)
    for (const wall of projected.walls) [wall.start, wall.end] = [wall.end, wall.start]
    const after = wallGeometryV2(projected.walls).flatMap(g => g.polygons)
    for (const p of [{ x: 8500, y: 1500 }, { x: 8041, y: 900 }, { x: 9050, y: 2020 }, { x: 1000, y: 1000 }]) expect(before.some(r => pointInPolygonV2(p, r))).toBe(after.some(r => pointInPolygonV2(p, r)))
  })
})


describe('B3 audience-derived terrain and connections', () => {
  function island() {
    const scene = empty()
    const area = (id: string, points: PointMm[], height: number, priority = 10) => ({ id, floorId: 'f-a1', editLocked: false, visibility: 'public' as const, groundElevationMm: height, coveragePriority: priority, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1, boundaryMm: points.map((positionMm, i) => ({ id: `${id}-v${i}`, segmentId: `${id}-s${i}`, positionMm })) })
    scene.terrainAreas.water = { ...area('water', rect(0, 0, 20000, 20000), 0, 0), blocksMovement: true }
    scene.terrainAreas.low = area('low', rect(1000, 1000, 9000, 16000), 1000)
    scene.terrainAreas.high = area('high', rect(10000, 1000, 7000, 16000), 3000)
    scene.terrainEdges.shared = { id: 'shared', floorId: 'f-a1', editLocked: false, visibility: 'public', source: { areaId: 'high', segmentId: 'high-s3' }, neighborAreaId: 'low', kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: null, styleOverride: null }
    scene.terrainConnections.stairs = { id: 'stairs', floorId: 'f-a1', editLocked: false, visibility: 'public', kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: 'low' }, positionMm: { x: 8500, y: 10000 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 11500, y: 10000 } }, widthMm: 2000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    return scene
  }

  it('resolves a shared cliff once, updates derived heights, and keeps connection corridors explicit', () => {
    const scene = island(), projection = projectSceneV2(scene, 'gm')
    const shared = projection.edges.filter(e => e.start.x === 10000 && e.end.x === 10000)
    expect(shared).toHaveLength(1); expect(shared[0].id).toBe('shared'); expect(shared[0].neighborElevationMm).toBe(1000)
    expect(projection.connections[0]).toMatchObject({ fromElevationMm: 1000, toElevationMm: 3000, widthMm: 2000, blocksMovement: false })
    expect(connectionPolygonV2(projection.connections[0]).map(p => `${p.x},${p.y}`).sort()).toEqual(rect(8500, 9000, 3000, 2000).map(p => `${p.x},${p.y}`).sort())
    const faceEdge = projection.edges.find(e => e.sourceAreaId === 'high' && e.start.y === 17000 && e.end.y === 17000)!
    const original = terrainFaceV2(faceEdge, projection)
    expect(original).toHaveLength(4); expect(original[2].x).toBe(faceEdge.end.x); expect(original[2].y - faceEdge.end.y).toBe(450)
    scene.terrainAreas.high.groundElevationMm = 4000
    const changed = projectSceneV2(scene, 'gm'); expect(changed.connections[0].toElevationMm).toBe(4000)
    expect(terrainFaceV2(changed.edges.find(e => e.id === faceEdge.id)!, changed)[2].y - faceEdge.end.y).toBe(450)
    const sharedFace = terrainFaceV2(shared[0], projection); expect(sharedFace[2].x).toBe(9640)
    const lowerCanonical = { ...shared[0], start: shared[0].end, end: shared[0].start, elevationMm: 1000, neighborElevationMm: 3000 }; expect(terrainFaceV2(lowerCanonical, projection)[2].x).toBe(9640)
    const withTheme = { theme: { terrainCliff: { directionDeg: 45, offsetFactor: .18, maxOffsetMm: 600, blurMm: 120, opacity: .24, color: '#24313A' } } } as typeof projection
    const shadow = terrainShadowV2(shared[0], withTheme); expect(shadow[2].x - shared[0].end.x).toBeCloseTo(360 / Math.SQRT2); expect(shadow[2].y - shared[0].end.y).toBeCloseTo(360 / Math.SQRT2)
    expect(changed.limitations).toEqual([])
  })

  it('filters a private plateau before effective coverage, cliffs, connections and resource collection', () => {
    const scene = island(), baseline = projectSceneV2(scene, 'player')
    const secret = structuredClone(scene.terrainAreas.high); secret.id = 'secret'; secret.visibility = 'gm'; secret.coveragePriority = 30; secret.groundElevationMm = 3500; secret.boundaryMm = rect(12500, 4000, 1500, 1800).map((positionMm, i) => ({ id: `secret-v${i}`, segmentId: `secret-s${i}`, positionMm })); scene.terrainAreas.secret = secret
    mask(scene, 11000, 2500, 5000, 5000)
    scene.terrainConnections.private = { ...scene.terrainConnections.stairs, id: 'private', visibility: 'gm', from: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 12000, y: 5000 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'secret' }, positionMm: { x: 13000, y: 5000 } }, widthMm: 500 }
    note(scene, 'private-edge-label', { type: 'entity', entityKind: 'terrainConnection', entityId: 'private' })
    const player = projectSceneV2(scene, 'player')
    expect(player.terrain).toEqual(baseline.terrain); expect(player.edges).toEqual(baseline.edges); expect(player.connections).toEqual(baseline.connections); expect(player.notes).toEqual([])
    const gm = projectSceneV2(scene, 'gm'); expect(gm.edges.filter(e => e.sourceAreaId === 'secret')).toHaveLength(4); expect(gm.connections).toHaveLength(2)
    scene.terrainAreas.secret.groundElevationMm = 4300; scene.terrainAreas.secret.boundaryMm[0].positionMm.x += 200
    expect(projectSceneV2(scene, 'player').edges).toEqual(baseline.edges)
    mask(scene, 12400, 3900, 1800, 2000); expect(() => projectSceneV2(scene, 'player')).toThrow('装饰阴影')
  })

  it('requires actual visible overlay and cliff material bytes, after privacy filtering', () => {
    const scene = island(), material = (id: string) => ({ id, catalogId: id, version: 1, name: id, licenseRef: 'MIT', origin: { kind: 'original' as const, attribution: 'original', canEmbed: true }, tags: [], textureAssetId: `${id}-texture`, defaultTileSizeMm: { width: 2000, height: 2000 }, applicableSurfaces: ['terrain' as const] })
    for (const id of ['grass', 'rock', 'cliff']) scene.materials[id] = material(id)
    const paint = (id: string) => ({ materialRef: { id, version: 1 }, tileSizeMm: { width: 2000, height: 2000 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 })
    scene.terrainAreas.high.surfaceStyle = { base: paint('grass'), overlays: [{ id: 'rock-patch', paint: paint('rock'), boundaryMm: rect(11000, 3000, 3000, 3000), blendWidthMm: 250, renderOrder: 5 }] }
    scene.terrainEdges.shared.surfaceStyle = { base: paint('cliff'), overlays: [] }
    const gm = projectSceneV2(scene, 'gm'); expect(gm.assetIds).toEqual(['cliff-texture', 'grass-texture', 'rock-texture']); expect(gm.limitations).toEqual([])
    scene.terrainEdges.shared.visibility = 'gm'; mask(scene, 8500, 0, 3000, 20000)
    expect(projectSceneV2(scene, 'player').assetIds).toEqual(['grass-texture', 'rock-texture'])
  })
})
