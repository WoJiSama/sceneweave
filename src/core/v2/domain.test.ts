import { describe, expect, it } from 'vitest'
import { createHouse } from '../seed'
import { validateScene } from '../schema'
import { collectDependenciesV2 } from './dependencies'
import { openingEndpointsV2, pathPolygonV2, supportSurfaceAtV2 } from './geometry'
import { migrateSceneV1 } from './migration'
import { validateSceneV2 } from './schema'
import type { MaterialRef, PointMm, PropDefinition, PropV2, SceneDocumentV2, TerrainArea } from './types'

const stamp = '2026-10-20T00:00:00.000Z'
function empty(): SceneDocumentV2 {
  const source = createHouse('source')
  source.vertices = {}; source.rooms = {}; source.walls = {}; source.openings = {}; source.props = {}; source.regions = {}; source.notes = {}; source.constraints.entranceOpeningIds = []
  source.floors['f-a1'].boundsMm = { x: 0, y: 0, width: 20000, height: 20000 }
  source.exportBoundsMm = { x: 0, y: 0, width: 20000, height: 20000 }
  return migrateSceneV1(source, { sceneId: 'copy', now: stamp })
}
const origin = { kind: 'original' as const, attribution: 'Sceneweave test original', canEmbed: true }
function prop(id: string, x = 4000, y = 4000): PropV2 {
  return { id, floorId: 'f-a1', editLocked: false, visibility: 'public', definitionRef: null,
    appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 }, visualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 },
    positionMm: { x, y }, rotationDeg: 0, footprintMm: { width: 1000, height: 1000 }, footprintOffsetMm: { x: 0, y: 0 },
    blocksMovement: true, blocksSight: false, supportRef: { kind: 'floor', id: 'f-a1' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
}
function area(id: string, points: PointMm[], priority = 1, elevation = 0): TerrainArea {
  return { id, floorId: 'f-a1', editLocked: false, visibility: 'public', boundaryMm: points.map((positionMm, index) => ({ id: `${id}-v${index}`, segmentId: `${id}-s${index}`, positionMm })), groundElevationMm: elevation, coveragePriority: priority,
    surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
}
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function assets(scene: SceneDocumentV2): { definition: PropDefinition; material: MaterialRef } {
  scene.assets.image = { id: 'image', sha256: 'a'.repeat(64), mimeType: 'image/png', pixelWidth: 256, pixelHeight: 256, logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'MIT', origin }
  const definition: PropDefinition = { id: 'definition', catalogId: 'prop.original.table', version: 1, licenseRef: 'MIT', origin, name: 'Table', tags: ['test'],
    defaultAppearance: { kind: 'image', assetId: 'image', tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 }, defaultFootprintMm: { width: 900, height: 800 }, defaultFootprintOffsetMm: { x: 0, y: 0 },
    defaultBlocksMovement: true, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'furniture' }
  const material: MaterialRef = { id: 'material', catalogId: 'material.original.wood', version: 1, licenseRef: 'MIT', origin, name: 'Wood', tags: [], textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room', 'terrain'] }
  scene.propDefinitions.definition = definition; scene.materials.material = material
  return { definition, material }
}
const codes = (input: unknown): string[] => { const result = validateSceneV2(input); return result.ok ? [] : result.errors.map(issue => issue.code) }
function slantedRoom(): SceneDocumentV2 {
  const scene = empty(), points = [{ x: 1000, y: 1000 }, { x: 8000, y: 1000 }, { x: 9000, y: 2000 }, { x: 9000, y: 7000 }, { x: 1000, y: 7000 }]
  points.forEach((p, i) => { const id = `v${i}`; scene.vertices[id] = { id, floorId: 'f-a1', editLocked: false, xMm: p.x, yMm: p.y }; const wallId = `w${i}`; scene.walls[wallId] = { id: wallId, floorId: 'f-a1', editLocked: false, startVertexId: id, endVertexId: `v${(i + 1) % points.length}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null } })
  scene.rooms.room = { id: 'room', floorId: 'f-a1', editLocked: false, boundaryVertexIds: points.map((_p, i) => `v${i}`), purpose: '斜角书房', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: 'f-a1' }, groundElevationMm: 0, floorStyle: null }
  scene.openings.window = { id: 'window', floorId: 'f-a1', editLocked: false, wallId: 'w1', offsetReferenceVertexId: 'v1', offsetMm: 400, widthMm: 600, kind: 'window', state: 'closed', locked: false, secret: false, revealed: false }
  return scene
}

describe('v1 isolated migration', () => {
  it('preserves geometry, secrets, notes, locks and source input; rejects v2 at v1 entry', () => {
    const source = createHouse('original'), before = structuredClone(source)
    source.props['p-b2'].editLocked = true; before.props['p-b2'].editLocked = true
    const migrated = migrateSceneV1(source, { sceneId: 'new-id', now: stamp })
    expect(source).toEqual(before)
    expect(migrated.sceneId).toBe('new-id'); expect(migrated.revision).toBe(0)
    expect(migrated.createdAt).toBe(stamp); expect(migrated.updatedAt).toBe(stamp)
    expect(migrated.notes).toEqual(source.notes); expect(migrated.regions).toEqual(source.regions)
    expect(migrated.rooms['r-c3'].visibility).toBe('gm')
    expect(migrated.openings['o-c3'].secret).toBe(true)
    expect(migrated.props['p-b2'].editLocked).toBe(true)
    expect(migrated.props['p-b2'].supportRef).toEqual({ kind: 'floor', id: 'f-a1' })
    expect(migrated.props['p-b2'].roomId).toBe('r-a1')
    expect('assetId' in migrated.props['p-b2']).toBe(false)
    expect(migrated.openings['o-a1'].offsetReferenceVertexId).toBe(source.walls[source.openings['o-a1'].wallId].startVertexId)
    expect(validateSceneV2(migrated).ok).toBe(true); expect(validateScene(migrated).ok).toBe(false)
  })
  it('keeps odd millimetre physical dimensions and uses deterministic visual centering', () => {
    const source = createHouse('source')
    source.props['p-b2'].footprintMm = { width: 901, height: 701 }
    const migrated = migrateSceneV1(source, { sceneId: 'new-id' })
    expect(migrated.props['p-b2'].footprintMm).toEqual({ width: 901, height: 701 })
    expect(migrated.props['p-b2'].visualBoundsMm).toEqual({ x: -450, y: -350, width: 901, height: 701 })
  })
  it('keeps roomId semantic when physical footprint is outside that room', () => {
    const source = createHouse('source'); source.props['p-b2'].positionMm = { x: 17000, y: 12000 }
    expect(migrateSceneV1(source).props['p-b2'].roomId).toBe('r-a1')
  })
  it('rejects reused identity, malformed source and unsupported v1 resources', () => {
    const source = createHouse('same')
    expect(() => migrateSceneV1(source, { sceneId: 'same' })).toThrow(/独立 sceneId/)
    expect(() => migrateSceneV1({ ...source, unknown: true })).toThrow(/迁移失败/)
    source.assets.a = { id: 'a', sha256: 'a'.repeat(64), mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 1, height: 1 }, licenseRef: 'MIT', origin }
    expect(() => migrateSceneV1(source)).toThrow(/m0-geometry/)
  })
})

describe('strict nested v2 schema and dependency closure', () => {
  it('rejects legacy parallel appearance and unknown nested semantics without stripping', () => {
    const scene = empty(); scene.props.p = prop('p')
    expect(codes(scene)).toEqual([])
    const unknown = structuredClone(scene) as unknown as Record<string, any>
    unknown.props.p.appearance.assetId = 'conflicting-image'
    expect(codes(unknown)).toContain('SCHEMA')
    delete unknown.props.p.appearance.assetId; unknown.props.p.symbol = 'chair'
    expect(codes(unknown)).toContain('SCHEMA')
    delete unknown.props.p.symbol; delete unknown.props.p.supportRef
    expect(codes(unknown)).toContain('SCHEMA')
  })
  it('rejects unsafe inputs, global ID collisions and key mismatches', () => {
    const source = empty(), cycle: any = {}; cycle.self = cycle
    expect(codes(cycle)).toContain('JSON_BUDGET')
    const unsafe = JSON.parse(JSON.stringify(source).replace('"materials":{}', '"materials":{"__proto__":{}}'))
    expect(codes(unsafe)).toContain('UNSAFE_KEY')
    source.props.p = prop('wrong')
    expect(codes(source)).toContain('ID_KEY_MISMATCH')
    source.props = { 'f-a1': prop('f-a1') }
    expect(codes(source)).toContain('DUPLICATE_ID')
  })
  it('treats all adopted definitions as roots and reports stable resource/license subjects', () => {
    const scene = empty(); assets(scene)
    expect(codes(scene)).toEqual([])
    expect(collectDependenciesV2(scene)).toEqual({ assetIds: ['image'], subjects: [
      { subjectKind: 'asset', subjectId: 'image', licenseRef: 'MIT' },
      { subjectKind: 'material', subjectId: 'material', licenseRef: 'MIT' },
      { subjectKind: 'propDefinition', subjectId: 'definition', licenseRef: 'MIT' },
    ] })
    delete scene.assets.image
    expect(codes(scene)).toContain('MISSING_ASSET'); expect(() => collectDependenciesV2(scene)).toThrow(/MISSING_ASSET/)
  })
  it('requires definitions for image props and exact references; rejects unused assets', () => {
    const scene = empty(); assets(scene); scene.props.p = prop('p'); scene.props.p.appearance = { kind: 'image', assetId: 'image', tint: null, opacity: 1 }
    expect(codes(scene)).toContain('IMAGE_WITHOUT_DEFINITION')
    scene.props.p.definitionRef = { id: 'definition', version: 2 }
    expect(codes(scene)).toContain('DEFINITION_VERSION')
    scene.props.p.definitionRef.version = 1
    expect(codes(scene)).toEqual([])
    scene.assets.extra = { ...scene.assets.image, id: 'extra' }
    expect(codes(scene)).toContain('UNUSED_ASSET')
  })
  it('allows concurrent catalog versions and rejects hidden conflicting snapshots', () => {
    const scene = empty(); const { definition } = assets(scene)
    scene.propDefinitions.copy = { ...structuredClone(definition), id: 'copy', defaultBlocksMovement: false }
    expect(codes(scene)).toContain('DEFINITION_IDENTITY_CONFLICT')
    scene.propDefinitions.copy.version = 2
    expect(codes(scene)).toEqual([])
    scene.propDefinitions.copy.version = 1; scene.propDefinitions.copy.defaultBlocksMovement = true
    expect(codes(scene)).toEqual([])
  })
  it('checks material applicability and opaque base paint; overlay geometry cannot self-intersect', () => {
    const scene = slantedRoom(); assets(scene)
    const paint = { materialRef: { id: 'material', version: 1 }, tileSizeMm: { width: 2000, height: 2000 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
    scene.rooms.room.floorStyle = { base: paint, overlays: [] }
    expect(codes(scene)).toEqual([])
    scene.materials.material.applicableSurfaces = ['terrain']
    expect(codes(scene)).toContain('MATERIAL_SURFACE')
    scene.materials.material.applicableSurfaces = ['room']; paint.opacity = 0.5
    expect(codes(scene)).toContain('TRANSLUCENT_BASE')
    paint.opacity = 1; scene.rooms.room.floorStyle.overlays.push({ id: 'overlay', paint: structuredClone(paint), blendWidthMm: 0, renderOrder: 0, boundaryMm: [{ x: 2000, y: 2000 }, { x: 4000, y: 4000 }, { x: 2000, y: 4000 }, { x: 4000, y: 2000 }] })
    expect(codes(scene)).toContain('INVALID_POLYGON')
  })
})

describe('diagonal structure and stable opening endpoint', () => {
  it('accepts VIS-01 slanted window and preserves exact derived location on repeated wall reversals', () => {
    const scene = slantedRoom(), before = openingEndpointsV2(scene, scene.openings.window)
    expect(codes(scene)).toEqual([])
    for (let i = 0; i < 20; i++) {
      const wall = scene.walls.w1; [wall.startVertexId, wall.endVertexId] = [wall.endVertexId, wall.startVertexId]
      expect(openingEndpointsV2(scene, scene.openings.window)).toEqual(before); expect(codes(scene)).toEqual([])
    }
  })
  it('compares true diagonal length and opening intervals measured from opposite stable endpoints', () => {
    const scene = slantedRoom()
    scene.openings.window.widthMm = 1000
    expect(codes(scene)).toContain('OPENING_CLEARANCE')
    scene.openings.window.widthMm = 600
    scene.openings.second = { ...scene.openings.window, id: 'second', offsetReferenceVertexId: 'v2', offsetMm: 400, widthMm: 200 }
    expect(codes(scene)).toContain('OPENING_OVERLAP')
    scene.openings.second.offsetMm = 100; scene.openings.second.widthMm = 100
    expect(codes(scene)).not.toContain('OPENING_OVERLAP')
    scene.openings.second.offsetReferenceVertexId = 'v4'
    expect(codes(scene)).toContain('OPENING_REFERENCE')
  })
  it('rejects duplicate walls, unsplit intersections and positive room overlap', () => {
    const scene = slantedRoom()
    scene.walls.duplicate = { ...scene.walls.w1, id: 'duplicate' }
    expect(codes(scene)).toContain('OVERLAPPING_WALLS')
    delete scene.walls.duplicate
    scene.vertices.crossA = { id: 'crossA', floorId: 'f-a1', editLocked: false, xMm: 500, yMm: 3000 }
    scene.vertices.crossB = { id: 'crossB', floorId: 'f-a1', editLocked: false, xMm: 9500, yMm: 3000 }
    scene.walls.cross = { ...scene.walls.w1, id: 'cross', startVertexId: 'crossA', endVertexId: 'crossB' }
    expect(codes(scene)).toContain('UNSPLIT_INTERSECTION')
    delete scene.walls.cross
    scene.rooms.copy = { ...scene.rooms.room, id: 'copy' }
    expect(codes(scene)).toContain('ROOM_OVERLAP')
  })
})

describe('effective terrain support and physical footprints', () => {
  it('resolves coverage priority independently of elevation and rejects equal-priority overlap', () => {
    const scene = empty()
    scene.terrainAreas.low = area('low', rect(1000, 1000, 8000, 8000), 1, 5000)
    scene.terrainAreas.high = area('high', rect(3000, 3000, 2000, 2000), 2, 0)
    expect(codes(scene)).toEqual([])
    expect(supportSurfaceAtV2(scene, { x: 4000, y: 4000 }, 'f-a1')).toEqual({ kind: 'terrainArea', id: 'high' })
    scene.terrainAreas.high.coveragePriority = 1
    expect(codes(scene)).toContain('TERRAIN_PRIORITY_OVERLAP')
  })
  it('checks entire rotated physical footprint and contained overriding islands, not only corners/centre', () => {
    const scene = empty(); scene.props.p = prop('p', 5000, 5000)
    scene.terrainAreas.base = area('base', rect(1000, 1000, 10000, 10000), 1, 1000)
    scene.props.p.supportRef = { kind: 'terrainArea', id: 'base' }
    expect(codes(scene)).toEqual([])
    scene.terrainAreas.secret = area('secret', rect(5100, 5100, 100, 100), 2, 2000)
    expect(codes(scene)).toContain('PROP_SUPPORT')
    delete scene.terrainAreas.secret
    scene.props.p.positionMm.x = 1500; scene.props.p.rotationDeg = 45
    expect(codes(scene)).toContain('PROP_SUPPORT')
    scene.props.p.positionMm.x = 4000; scene.props.p.footprintOffsetMm.x = -4000
    expect(codes(scene)).toContain('PROP_SUPPORT')
  })
  it('distinguishes physical support from roomId and checks room support ownership', () => {
    const scene = slantedRoom(); scene.props.p = prop('p', 12000, 10000); scene.props.p.roomId = 'room'
    expect(codes(scene)).toEqual([])
    scene.props.p.supportRef = { kind: 'room', id: 'room' }
    expect(codes(scene)).toContain('PROP_SUPPORT')
    scene.props.p.positionMm = { x: 4000, y: 4000 }
    expect(codes(scene)).toEqual([])
    scene.rooms.room.groundElevationMm = 1000
    expect(codes(scene)).toContain('ROOM_ELEVATION')
  })
  it('rejects partially shared terrain edges and noncanonical source/incorrect cliff semantics', () => {
    const scene = empty()
    scene.terrainAreas.a = area('a', rect(1000, 1000, 5000, 5000), 1, 1000)
    scene.terrainAreas.b = area('b', rect(6000, 1000, 5000, 5000), 1, 3000)
    scene.terrainEdges.edge = { id: 'edge', floorId: 'f-a1', editLocked: false, visibility: 'public', source: { areaId: 'a', segmentId: 'a-s1' }, neighborAreaId: 'b', kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: null, styleOverride: null }
    expect(codes(scene)).toEqual([])
    scene.terrainEdges.edge.blocksMovement = false
    expect(codes(scene)).toContain('CLIFF_BLOCKING')
    scene.terrainEdges.edge.blocksMovement = true; scene.terrainEdges.edge.source = { areaId: 'b', segmentId: 'b-s3' }; scene.terrainEdges.edge.neighborAreaId = 'a'
    expect(codes(scene)).toContain('NONCANONICAL_EDGE_SOURCE')
    scene.terrainAreas.b.boundaryMm[0].positionMm.y = 3000
    expect(codes(scene)).toContain('UNSPLIT_TERRAIN_INTERSECTION')
  })
  it('checks connection full width across exactly two surfaces and rejects obstacle intrusion', () => {
    const scene = empty()
    scene.terrainAreas.a = area('a', rect(1000, 1000, 5000, 5000), 1, 1000)
    scene.terrainAreas.b = area('b', rect(6000, 1000, 5000, 5000), 1, 3000)
    scene.terrainConnections.stairs = { id: 'stairs', floorId: 'f-a1', editLocked: false, visibility: 'public', kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: 'a' }, positionMm: { x: 5000, y: 3500 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'b' }, positionMm: { x: 7000, y: 3500 } }, widthMm: 2000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    expect(codes(scene)).toEqual([])
    scene.props.p = prop('p', 5000, 3500); scene.props.p.supportRef = { kind: 'terrainArea', id: 'a' }
    expect(codes(scene)).toContain('CONNECTION_OBSTACLE')
    delete scene.props.p; scene.terrainConnections.stairs.widthMm = 6000
    expect(codes(scene)).toContain('CONNECTION_CORRIDOR')
    scene.terrainConnections.stairs.widthMm = 2000; scene.terrainConnections.stairs.to.surfaceRef = { kind: 'terrainArea', id: 'a' }
    expect(codes(scene)).toContain('CONNECTION_HEIGHT')
  })
  it('accepts ordinary paths with square caps/miter turns and rejects support spill and path solver claims', () => {
    const scene = empty()
    scene.paths.path = { id: 'path', floorId: 'f-a1', editLocked: false, visibility: 'public', centerlineMm: [{ x: 2000, y: 2000 }, { x: 6000, y: 2000 }, { x: 6000, y: 6000 }], widthMm: 1000, supportRefs: [{ kind: 'floor', id: 'f-a1' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    expect(pathPolygonV2(scene.paths.path).length).toBe(6); expect(codes(scene)).toEqual([])
    scene.paths.path.centerlineMm[0].x = 100
    expect(codes(scene)).toContain('PATH_SUPPORT')
    scene.paths.path.centerlineMm[0].x = 2000; scene.constraints.minPathWidthMm = 1000
    expect(codes(scene)).toContain('UNSUPPORTED_PATH_CLEARANCE')
    delete scene.constraints.minPathWidthMm
    scene.constraints.pathChecks = [{ id: 'check', from: { type: 'point', positionMm: { x: 2000, y: 2000 } }, to: { type: 'point', positionMm: { x: 6000, y: 6000 } }, clearanceMm: 1000, mode: 'current', assumedOpenDoorIds: [] }]
    expect(codes(scene)).toContain('UNSUPPORTED_PATH_CHECK')
  })
  it('requires a real height connection even when the transition is exactly a path vertex', () => {
    const scene = empty()
    scene.terrainAreas.a = area('a', rect(1000, 1000, 5000, 5000), 1, 1000)
    scene.terrainAreas.b = area('b', rect(6000, 1000, 5000, 5000), 1, 3000)
    scene.paths.path = { id: 'path', floorId: 'f-a1', editLocked: false, visibility: 'public', centerlineMm: [{ x: 4000, y: 3500 }, { x: 6000, y: 3500 }, { x: 8000, y: 3500 }], widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: 'a' }, { kind: 'terrainArea', id: 'b' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    expect(codes(scene)).toContain('PATH_HEIGHT_TRANSITION')
    scene.terrainConnections.stairs = { id: 'stairs', floorId: 'f-a1', editLocked: false, visibility: 'public', kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: 'a' }, positionMm: { x: 5000, y: 3500 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'b' }, positionMm: { x: 7000, y: 3500 } }, widthMm: 1200, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    expect(codes(scene)).toEqual([])
  })
})

describe('persisted composite members and scatter tombstones', () => {
  it('retains explicit null prefab members and rejects inconsistent keys/double management', () => {
    const scene = empty(); const p = prop('p'); scene.props.p = p
    const { id: _id, floorId: _floorId, editLocked: _lock, visibility: _visibility, supportRef: _support, ...template } = p
    scene.prefabDefinitions.pdef = { id: 'pdef', catalogId: 'prefab.original', version: 1, licenseRef: 'MIT', origin, name: 'Table and chair', tags: [], members: [{ key: 'table', propTemplate: template }, { key: 'chair', propTemplate: template }] }
    scene.prefabInstances.group = { id: 'group', floorId: 'f-a1', editLocked: false, visibility: 'public', definitionRef: { id: 'pdef', version: 1 }, anchorMm: { x: 4000, y: 4000 }, rotationDeg: 0, members: { table: { propId: 'p', overrideFields: ['positionMm'] }, chair: { propId: null, overrideFields: [] } } }
    expect(codes(scene)).toEqual([])
    delete scene.prefabInstances.group.members.chair
    expect(codes(scene)).toContain('PREFAB_MEMBER_KEYS')
    scene.prefabInstances.group.members.chair = { propId: 'p', overrideFields: [] }
    expect(codes(scene)).toContain('DUPLICATE_MANAGEMENT')
  })
  it('requires deleted candidate tombstone plus persistent world exclusion and never expands on load', () => {
    const scene = empty(); assets(scene); scene.terrainAreas.area = area('area', rect(1000, 1000, 8000, 8000))
    const key = 'b'.repeat(64)
    scene.scatterGroups.scatter = { id: 'scatter', floorId: 'f-a1', editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: 'area' }, palette: [{ key: 'table', propDefinitionRef: { id: 'definition', version: 1 }, weight: 1 }], seed: 'stable', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 0, y: 0 }, cellSizeMm: 1000, densityFactor: 0.5, minDistanceMm: 100, rotationRangeDeg: { min: 0, max: 359 }, members: { [key]: { propId: null, state: 'deleted', overrideFields: [] } }, exclusions: [] }
    expect(codes(scene)).toContain('MISSING_DELETE_EXCLUSION')
    scene.scatterGroups.scatter.exclusions.push({ id: 'exclusion', boundaryMm: rect(2000, 2000, 1000, 1000), reason: 'delete', sourceCandidateKey: key })
    const before = structuredClone(scene)
    expect(codes(scene)).toEqual([]); expect(scene).toEqual(before); expect(scene.props).toEqual({})
    scene.scatterGroups.scatter.algorithmVersion = 'future-version'
    const checked = validateSceneV2(scene)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.warnings.map(issue => issue.code)).toContain('UNSUPPORTED_SCATTER_ALGORITHM')
  })
  it('checks new note anchors and cyclic anchor chains', () => {
    const scene = empty(); scene.terrainAreas.area = area('area', rect(1000, 1000, 8000, 8000))
    scene.notes.n = { id: 'n', floorId: 'f-a1', editLocked: false, visibility: 'gm', kind: 'note', text: 'secret', anchor: { type: 'entity', entityKind: 'terrainArea', entityId: 'area' } }
    expect(codes(scene)).toEqual([])
    scene.notes.n.anchor = { type: 'entity', entityKind: 'note', entityId: 'n' }
    expect(codes(scene)).toContain('CYCLIC_ANCHOR')
  })
  it('validates managed scatter spacing against manual members and persistent exclusions', () => {
    const scene = empty(); assets(scene); scene.terrainAreas.area = area('area', rect(1000, 1000, 10000, 10000))
    scene.props.a = prop('a', 4000, 4000); scene.props.b = prop('b', 4500, 4000)
    for (const p of Object.values(scene.props)) { p.definitionRef = { id: 'definition', version: 1 }; p.supportRef = { kind: 'terrainArea', id: 'area' } }
    scene.scatterGroups.scatter = { id: 'scatter', floorId: 'f-a1', editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: 'area' }, palette: [{ key: 'table', propDefinitionRef: { id: 'definition', version: 1 }, weight: 1 }], seed: 'stable', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 0, y: 0 }, cellSizeMm: 1000, densityFactor: 0.5, minDistanceMm: 200, rotationRangeDeg: { min: 0, max: 359 }, members: { ['a'.repeat(64)]: { propId: 'a', state: 'managed', overrideFields: [] }, ['b'.repeat(64)]: { propId: 'b', state: 'manual', overrideFields: ['positionMm'] } }, exclusions: [] }
    expect(codes(scene)).toContain('SCATTER_SPACING')
    scene.props.b.positionMm.x = 6000
    expect(codes(scene)).toEqual([])
    scene.scatterGroups.scatter.exclusions.push({ id: 'exclude', boundaryMm: rect(4500, 3500, 100, 1000), reason: 'manual', sourceCandidateKey: null })
    expect(codes(scene)).toContain('SCATTER_EXCLUSION')
  })
})
