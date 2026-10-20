import { describe, expect, it } from 'vitest'
import { createHouse } from '../seed'
import { applyCommandsV2, type SceneCommandV2 } from './commands'
import { openingEndpointsV2 } from './geometry'
import { migrateSceneV1 } from './migration'
import { validateSceneV2 } from './schema'
import type { PropV2, SceneDocumentV2 } from './types'

const origin = { kind: 'original' as const, attribution: 'Sceneweave command test original', canEmbed: true }
function fixture(): SceneDocumentV2 {
  const source = createHouse('source')
  source.vertices = {}; source.rooms = {}; source.walls = {}; source.openings = {}; source.props = {}; source.regions = {}; source.notes = {}; source.constraints.entranceOpeningIds = []
  source.floors['f-a1'].boundsMm = { x: 0, y: 0, width: 20000, height: 20000 }
  source.exportBoundsMm = { x: 0, y: 0, width: 20000, height: 20000 }
  const scene = migrateSceneV1(source, { sceneId: 'commands', now: '2026-10-20T00:00:00.000Z' })
  const points = [{ x: 1000, y: 1000 }, { x: 8000, y: 1000 }, { x: 9000, y: 2000 }, { x: 9000, y: 7000 }, { x: 1000, y: 7000 }]
  points.forEach((point, i) => {
    const id = `v${i}`, wallId = `w${i}`
    scene.vertices[id] = { id, floorId: 'f-a1', editLocked: false, xMm: point.x, yMm: point.y }
    scene.walls[wallId] = { id: wallId, floorId: 'f-a1', editLocked: false, startVertexId: id, endVertexId: `v${(i + 1) % points.length}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
  })
  scene.rooms.study = { id: 'study', floorId: 'f-a1', editLocked: false, boundaryVertexIds: points.map((_, i) => `v${i}`), purpose: '书房', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: 'f-a1' }, groundElevationMm: 0, floorStyle: null }
  scene.openings.window = { id: 'window', floorId: 'f-a1', editLocked: false, wallId: 'w1', offsetReferenceVertexId: 'v1', offsetMm: 400, widthMm: 600, kind: 'window', state: 'closed', locked: false, secret: false, revealed: false }
  const prop = (id: string, x: number, y: number): PropV2 => ({ id, floorId: 'f-a1', editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 }, visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 }, positionMm: { x, y }, rotationDeg: 0, footprintMm: { width: 200, height: 200 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: false, visibility: 'public', roomId: 'study', supportRef: { kind: 'room', id: 'study' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'furniture', shadowOverride: null })
  scene.props.desk = prop('desk', 3000, 3000); scene.props.book = prop('book', 3400, 3000)
  const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, roomId: _room, supportRef: _support, ...template } = scene.props.desk
  scene.prefabDefinitions.groupDefinition = { id: 'groupDefinition', catalogId: 'test.group', version: 1, licenseRef: 'MIT', origin, name: '书桌与书', tags: [], members: [{ key: 'desk', propTemplate: template }, { key: 'book', propTemplate: template }, { key: 'removed', propTemplate: template }] }
  scene.prefabInstances.group = { id: 'group', floorId: 'f-a1', editLocked: false, visibility: 'public', definitionRef: { id: 'groupDefinition', version: 1 }, anchorMm: { x: 3000, y: 3000 }, rotationDeg: 0, members: { desk: { propId: 'desk', overrideFields: [] }, book: { propId: 'book', overrideFields: [] }, removed: { propId: null, overrideFields: ['positionMm'] } } }
  scene.assets.texture = { id: 'texture', sha256: 'a'.repeat(64), mimeType: 'image/png', pixelWidth: 256, pixelHeight: 256, logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'MIT', origin }
  scene.materials.wood = { id: 'wood', catalogId: 'test.wood', version: 1, licenseRef: 'MIT', origin, name: '木纹', tags: [], textureAssetId: 'texture', defaultTileSizeMm: { width: 1000, height: 2000 }, applicableSurfaces: ['room', 'terrain', 'wall'] }
  scene.materials.lightwood = { ...structuredClone(scene.materials.wood), id: 'lightwood', catalogId: 'test.lightwood', name: '浅木纹', defaultTileSizeMm: { width: 2000, height: 4000 } }
  scene.rooms.study.floorStyle = { base: { materialRef: { id: 'wood', version: 1 }, tileSizeMm: { width: 1000, height: 2000 }, rotationDeg: 0, alignment: 'surface', originMm: { x: 123, y: 456 }, tint: null, opacity: 1 }, overlays: [] }
  scene.propDefinitions.variant = { id: 'variant', catalogId: 'test.chair-variant', version: 1, licenseRef: 'MIT', origin, name: '外观变体', tags: [], defaultAppearance: { kind: 'image', assetId: 'texture', tint: null, opacity: 0.8 }, defaultVisualBoundsMm: { x: -1000, y: -1000, width: 2000, height: 2000 }, defaultFootprintMm: { width: 1900, height: 1900 }, defaultFootprintOffsetMm: { x: 100, y: 100 }, defaultBlocksMovement: false, defaultBlocksSight: true, defaultRenderLayer: 'canopy', defaultShadowClass: 'vegetation' }
  return scene
}
const apply = (scene: SceneDocumentV2, ...commands: SceneCommandV2[]) => applyCommandsV2(scene, commands)

describe('v2 atomic architectural editing', () => {
  it('returns a separate preview candidate without mutating a cancelled scene or revision', () => {
    const scene = fixture(), before = structuredClone(scene)
    const preview = apply(scene, { type: 'moveVertex', id: 'v1', positionMm: { x: 8100, y: 1000 } })
    expect(preview.vertices.v1.xMm).toBe(8100)
    expect(preview.revision).toBe(scene.revision); expect(preview.updatedAt).toBe(scene.updatedAt)
    expect(scene).toEqual(before)
  })
  it('rejects an entire batch after an invalid boundary, without applying its earlier prop edit', () => {
    const scene = fixture(), before = structuredClone(scene)
    expect(() => apply(scene, { type: 'updateProp', id: 'book', changes: { rotationDeg: 30 } }, { type: 'moveVertex', id: 'v1', positionMm: { x: 1000, y: 1000 } })).toThrow(/事务未采用/)
    expect(scene).toEqual(before)
  })
  it('validates the final whole transaction instead of rejecting a temporary collapsed wall', () => {
    const scene = fixture()
    const next = apply(scene, { type: 'moveVertex', id: 'v0', positionMm: { x: 8000, y: 1000 } }, { type: 'moveVertex', id: 'v0', positionMm: { x: 1200, y: 1200 } })
    expect(validateSceneV2(next).ok).toBe(true)
    expect(next.vertices.v0).toMatchObject({ xMm: 1200, yMm: 1200 })
  })
  it('reverses an irrational-length slanted wall repeatedly without changing the stable window reference', () => {
    const scene = fixture(), endpoints = openingEndpointsV2(scene, scene.openings.window)
    const commands: SceneCommandV2[] = Array.from({ length: 101 }, () => ({ type: 'reverseWall', id: 'w1' }))
    const next = applyCommandsV2(scene, commands)
    expect(next.walls.w1.startVertexId).toBe('v2')
    expect(next.openings.window).toEqual(scene.openings.window)
    expect(openingEndpointsV2(next, next.openings.window)).toEqual(endpoints)
  })
  it('splits beyond the diagonal window while preserving its original measuring endpoint exactly', () => {
    const scene = fixture(), endpoints = openingEndpointsV2(scene, scene.openings.window)
    const next = apply(scene, { type: 'splitWall', id: 'w1', positionMm: { x: 8800, y: 1800 }, newVertexId: 'splitV', newWallId: 'splitW' })
    expect(next.rooms.study.boundaryVertexIds).toEqual(['v0', 'v1', 'splitV', 'v2', 'v3', 'v4'])
    expect(next.openings.window).toEqual(scene.openings.window)
    expect(openingEndpointsV2(next, next.openings.window)).toEqual(endpoints)
    expect(next.walls.splitW).toMatchObject({ startVertexId: 'splitV', endVertexId: 'v2' })
  })
  it('rebinds a diagonal window across the split with only one nearest-mm quantization', () => {
    const scene = fixture(), before = openingEndpointsV2(scene, scene.openings.window)
    const next = apply(scene, { type: 'splitWall', id: 'w1', positionMm: { x: 8100, y: 1100 }, newVertexId: 'splitV', newWallId: 'splitW' })
    expect(next.openings.window).toMatchObject({ wallId: 'splitW', offsetReferenceVertexId: 'splitV', offsetMm: 259, widthMm: 600 })
    const after = openingEndpointsV2(next, next.openings.window)
    expect(Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y)).toBeLessThanOrEqual(0.5)
    const reversed = apply(next, { type: 'reverseWall', id: 'splitW' })
    expect(openingEndpointsV2(reversed, reversed.openings.window)).toEqual(after)
  })
  it('handles a reversed wall and a window measured from the original far endpoint', () => {
    const scene = fixture(); scene.openings.window.offsetReferenceVertexId = 'v2'
    const reversed = apply(scene, { type: 'reverseWall', id: 'w1' })
    const before = openingEndpointsV2(reversed, reversed.openings.window)
    const next = apply(reversed, { type: 'splitWall', id: 'w1', positionMm: { x: 8900, y: 1900 }, newVertexId: 'splitV', newWallId: 'splitW' })
    expect(next.openings.window).toMatchObject({ wallId: 'splitW', offsetReferenceVertexId: 'splitV', offsetMm: 259 })
    const after = openingEndpointsV2(next, next.openings.window)
    expect(Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y)).toBeLessThanOrEqual(0.5)
  })
  it('rejects crossing openings, unsafe split points, reused IDs and newly insufficient clearance', () => {
    const scene = fixture(), before = structuredClone(scene)
    for (const [point, error] of [
      [{ x: 8500, y: 1500 }, /跨越拆分点/],
      [{ x: 8100, y: 1101 }, /整数毫米内点/],
      [{ x: 8000, y: 1000 }, /整数毫米内点/],
      [{ x: 8250, y: 1250 }, /安全间隙/],
    ] as const) expect(() => apply(scene, { type: 'splitWall', id: 'w1', positionMm: point, newVertexId: 'splitV', newWallId: 'splitW' })).toThrow(error)
    expect(() => apply(scene, { type: 'splitWall', id: 'w1', positionMm: { x: 8800, y: 1800 }, newVertexId: 'book', newWallId: 'splitW' })).toThrow(/未占用/)
    expect(scene).toEqual(before)
  })
  it('validates thick-wall bands and joins against the floor after changing wall thickness', () => {
    const scene = fixture(), before = structuredClone(scene)
    expect(apply(scene, { type: 'setWallThickness', id: 'w1', thicknessMm: 400 }).walls.w1.thicknessMm).toBe(400)
    expect(() => apply(scene, { type: 'setWallThickness', id: 'w0', thicknessMm: 3000 })).toThrow(/世界边界/)
    expect(scene).toEqual(before)
  })
})

describe('v2 complete dependency lock checks', () => {
  it.each(['vertex', 'wall', 'neighborWall', 'room', 'window', 'supportedProp', 'group'] as const)('cannot change a wall through its locked %s dependency', dependency => {
    const scene = fixture()
    const entity = { vertex: scene.vertices.v1, wall: scene.walls.w1, neighborWall: scene.walls.w0, room: scene.rooms.study, window: scene.openings.window, supportedProp: scene.props.book, group: scene.prefabInstances.group }[dependency]
    entity.editLocked = true
    const before = structuredClone(scene)
    expect(() => apply(scene, { type: 'moveVertex', id: 'v1', positionMm: { x: 8100, y: 1000 } })).toThrow(/锁定/)
    expect(scene).toEqual(before)
  })
  it('checks locked recursively anchored notes without treating an unrelated locked prop as changed', () => {
    const scene = fixture()
    scene.notes.first = { id: 'first', floorId: 'f-a1', editLocked: false, visibility: 'gm', kind: 'note', text: '跟随窗', anchor: { type: 'entity', entityKind: 'opening', entityId: 'window' } }
    scene.notes.second = { id: 'second', floorId: 'f-a1', editLocked: true, visibility: 'gm', kind: 'note', text: '跟随注记', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    expect(() => apply(scene, { type: 'reverseWall', id: 'w1' })).toThrow(/second/)
    scene.notes.second.editLocked = false
    scene.props.outside = { ...structuredClone(scene.props.book), id: 'outside', roomId: undefined, supportRef: { kind: 'floor', id: 'f-a1' }, positionMm: { x: 15000, y: 15000 }, editLocked: true }
    delete scene.props.outside.roomId
    expect(() => apply(scene, { type: 'moveVertex', id: 'v1', positionMm: { x: 8100, y: 1000 } })).not.toThrow()
  })
  it('does not bypass parent or individual member locks during local edits, transforms or unpacking', () => {
    const scene = fixture(); scene.prefabInstances.group.editLocked = true
    expect(() => apply(scene, { type: 'updateProp', id: 'book', changes: { rotationDeg: 30 } })).toThrow(/group/)
    expect(() => apply(scene, { type: 'replacePropAppearance', id: 'book', definitionRef: { id: 'variant', version: 1 } })).toThrow(/group/)
    scene.prefabInstances.group.editLocked = false; scene.props.book.editLocked = true
    expect(() => apply(scene, { type: 'transformPrefab', id: 'group', rotationDeg: 90 })).toThrow(/book/)
    expect(() => apply(scene, { type: 'unpackPrefab', id: 'group' })).toThrow(/book/)
  })
})

describe('v2 persisted prefab edits and material invariants', () => {
  it('retains direct member overrides and tombstones while transforming actual persisted members once', () => {
    const scene = fixture()
    const local = apply(scene, { type: 'updateProp', id: 'book', changes: { positionMm: { x: 3500, y: 3200 }, rotationDeg: 30 } })
    expect(local.prefabInstances.group.members.book.overrideFields).toEqual(['positionMm', 'rotationDeg'])
    const moved = apply(local, { type: 'transformPrefab', id: 'group', anchorMm: { x: 5000, y: 4000 }, rotationDeg: 90 })
    expect(moved.props.desk.positionMm).toEqual({ x: 5000, y: 4000 })
    expect(moved.props.book).toMatchObject({ positionMm: { x: 4800, y: 4500 }, rotationDeg: 120 })
    expect(moved.prefabInstances.group.members).toEqual(local.prefabInstances.group.members)
    expect(moved.props.desk.footprintMm).toEqual(scene.props.desk.footprintMm)
  })
  it('quantizes exact negative half millimetres away from zero and never quantizes again on load', () => {
    const scene = fixture()
    scene.floors['f-a1'].boundsMm = { x: -10000, y: -10000, width: 30000, height: 30000 }
    scene.prefabInstances.group.anchorMm = { x: 0, y: 0 }
    for (const prop of Object.values(scene.props)) { prop.supportRef = { kind: 'floor', id: 'f-a1' }; prop.positionMm = { x: 0, y: 0 } }
    scene.props.book.positionMm = { x: 1, y: 0 }
    const next = apply(scene, { type: 'transformPrefab', id: 'group', rotationDeg: 120 })
    expect(next.props.book.positionMm).toEqual({ x: -1, y: 1 })
    expect(applyCommandsV2(next, []).props).toEqual(next.props)
  })
  it('unpacks stable members without changing their positions, physical properties or effective private audience', () => {
    const scene = fixture(); scene.prefabInstances.group.visibility = 'gm'
    const next = apply(scene, { type: 'unpackPrefab', id: 'group' })
    expect(next.prefabInstances).toEqual({})
    expect(next.props.book).toEqual({ ...scene.props.book, visibility: 'gm' })
    expect(next.props.desk).toEqual({ ...scene.props.desk, visibility: 'gm' })
    expect(Object.keys(next.props)).toEqual(['desk', 'book'])
    expect(apply(next, { type: 'updateProp', id: 'book', changes: { rotationDeg: 45 } }).props.book.rotationDeg).toBe(45)
  })
  it('keeps member note anchors valid and rejects a group note anchor instead of orphaning it', () => {
    const scene = fixture()
    scene.notes.booknote = { id: 'booknote', floorId: 'f-a1', editLocked: false, visibility: 'gm', kind: 'note', text: '书内线索', anchor: { type: 'entity', entityKind: 'prop', entityId: 'book' } }
    expect(apply(scene, { type: 'unpackPrefab', id: 'group' }).notes.booknote).toEqual(scene.notes.booknote)
    scene.notes.groupnote = { ...scene.notes.booknote, id: 'groupnote', anchor: { type: 'entity', entityKind: 'prefabInstance', entityId: 'group' } }
    expect(() => apply(scene, { type: 'unpackPrefab', id: 'group' })).toThrow(/groupnote/)
  })
  it('changes only reference and appearance even when variant defaults have different scale, gameplay and shadows', () => {
    const scene = fixture(), next = apply(scene, { type: 'replacePropAppearance', id: 'book', definitionRef: { id: 'variant', version: 1 } })
    expect(next.props.book).toEqual({ ...scene.props.book, definitionRef: { id: 'variant', version: 1 }, appearance: scene.propDefinitions.variant.defaultAppearance })
    expect(next.prefabInstances.group.members.book.overrideFields).toEqual(['definitionRef', 'appearance'])
    expect(() => apply(scene, { type: 'replacePropAppearance', id: 'book', definitionRef: { id: 'variant', version: 2 } })).toThrow(/版本/)
  })
  it('keeps world paint origin and physical tile sizes during boundary edits, material changes and rotation', () => {
    const scene = fixture(), next = apply(scene,
      { type: 'moveVertex', id: 'v1', positionMm: { x: 8100, y: 1000 } },
      { type: 'setSurfaceMaterial', kind: 'room', id: 'study', materialRef: { id: 'lightwood', version: 1 } },
      { type: 'setSurfacePaint', kind: 'room', id: 'study', changes: { rotationDeg: 90 } },
    )
    expect(next.rooms.study.floorStyle!.base).toEqual({ ...scene.rooms.study.floorStyle!.base, materialRef: { id: 'lightwood', version: 1 }, rotationDeg: 90 })
    expect(next.props).toEqual(scene.props); expect(next.openings).toEqual(scene.openings)
  })
  it('uses the same atomic checks for terrain point IDs, clipping, dependencies and preserved paint origin', () => {
    const scene = fixture()
    scene.terrainAreas.terrace = { id: 'terrace', floorId: 'f-a1', editLocked: false, visibility: 'public', boundaryMm: [{ x: 12000, y: 1000 }, { x: 18000, y: 1000 }, { x: 18000, y: 7000 }, { x: 12000, y: 7000 }].map((positionMm, i) => ({ id: `t${i}`, segmentId: `ts${i}`, positionMm })), groundElevationMm: 0, coveragePriority: 1, surfaceStyle: structuredClone(scene.rooms.study.floorStyle), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    const next = apply(scene, { type: 'moveTerrainPoint', areaId: 'terrace', pointId: 't1', positionMm: { x: 19000, y: 1000 } })
    expect(next.terrainAreas.terrace.boundaryMm.map(point => [point.id, point.segmentId])).toEqual(scene.terrainAreas.terrace.boundaryMm.map(point => [point.id, point.segmentId]))
    expect(next.terrainAreas.terrace.surfaceStyle).toEqual(scene.terrainAreas.terrace.surfaceStyle)
    expect(() => apply(scene, { type: 'moveTerrainPoint', areaId: 'terrace', pointId: 't1', positionMm: { x: 12000, y: 7000 } })).toThrow(/轮廓/)
    scene.terrainEdges.edge = { id: 'edge', floorId: 'f-a1', editLocked: true, visibility: 'public', source: { areaId: 'terrace', segmentId: 'ts0' }, neighborAreaId: null, kind: 'materialTransition', shoreline: false, blocksMovement: false, blocksSight: false, surfaceStyle: null, styleOverride: null }
    expect(() => apply(scene, { type: 'moveTerrainPoint', areaId: 'terrace', pointId: 't1', positionMm: { x: 19000, y: 1000 } })).toThrow(/edge/)
  })
  it('includes locked lower-priority terrain when a moved boundary changes its effective coverage', () => {
    const scene = fixture()
    const area = (id: string, priority: number, points: { x: number; y: number }[]) => ({ id, floorId: 'f-a1', editLocked: false, visibility: 'public' as const, boundaryMm: points.map((positionMm, i) => ({ id: `${id}-v${i}`, segmentId: `${id}-s${i}`, positionMm })), groundElevationMm: 0, coveragePriority: priority, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 })
    scene.terrainAreas.low = area('low', 1, [{ x: 11000, y: 1000 }, { x: 19000, y: 1000 }, { x: 19000, y: 9000 }, { x: 11000, y: 9000 }])
    scene.terrainAreas.high = area('high', 2, [{ x: 13000, y: 3000 }, { x: 17000, y: 3000 }, { x: 17000, y: 7000 }, { x: 13000, y: 7000 }])
    scene.terrainAreas.low.editLocked = true
    expect(() => apply(scene, { type: 'moveTerrainPoint', areaId: 'high', pointId: 'high-v1', positionMm: { x: 18000, y: 3000 } })).toThrow(/low/)
    scene.terrainAreas.low.editLocked = false
    expect(() => apply(scene, { type: 'moveTerrainPoint', areaId: 'high', pointId: 'high-v1', positionMm: { x: 18000, y: 3000 } })).not.toThrow()
  })
  it('explicitly rejects scatter-member edits while preserving its manual records', () => {
    const scene = fixture()
    delete scene.prefabInstances.group
    scene.props.book.definitionRef = { id: 'variant', version: 1 }
    scene.terrainAreas.scatterDomain = { id: 'scatterDomain', floorId: 'f-a1', editLocked: false, visibility: 'public', boundaryMm: [{ x: 12000, y: 1000 }, { x: 18000, y: 1000 }, { x: 18000, y: 7000 }, { x: 12000, y: 7000 }].map((positionMm, i) => ({ id: `scatter-v${i}`, segmentId: `scatter-s${i}`, positionMm })), groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.scatterGroups.scatter = { id: 'scatter', floorId: 'f-a1', editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: 'scatterDomain' }, palette: [{ key: 'book', propDefinitionRef: { id: 'variant', version: 1 }, weight: 1 }], seed: 'test', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 0, y: 0 }, cellSizeMm: 1000, densityFactor: 0.5, minDistanceMm: 100, rotationRangeDeg: { min: 0, max: 359 }, members: { ['a'.repeat(64)]: { propId: 'book', state: 'manual', overrideFields: ['positionMm'] } }, exclusions: [] }
    const before = structuredClone(scene)
    expect(() => apply(scene, { type: 'updateProp', id: 'book', changes: { rotationDeg: 30 } })).toThrow(/散布成员/)
    expect(() => apply(scene, { type: 'replacePropAppearance', id: 'book', definitionRef: { id: 'variant', version: 1 } })).toThrow(/散布成员/)
    expect(scene).toEqual(before)
  })
  it('rejects unknown mutation keys, fractional world positions and non-JSON commands', () => {
    const scene = fixture()
    expect(() => applyCommandsV2(scene, [{ type: 'updateProp', id: 'book', changes: { visibility: 'public' } }] as unknown as SceneCommandV2[])).toThrow(/编辑指令无效/)
    expect(() => apply(scene, { type: 'moveVertex', id: 'v1', positionMm: { x: 8100.5, y: 1000 } })).toThrow(/安全整数/)
    const getter = { type: 'reverseWall', get id() { throw new Error('must not execute') } }
    expect(() => applyCommandsV2(scene, [getter] as unknown as SceneCommandV2[])).toThrow(/访问器/)
    expect(() => apply(scene, { type: 'moveVertex', id: 'missing', positionMm: { x: 0, y: 0 } })).toThrow(/不存在/)
  })
})
