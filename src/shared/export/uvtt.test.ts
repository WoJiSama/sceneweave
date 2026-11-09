import { toCurrentSceneDocument } from '../model/current-scene.js'
import { describe, expect, it } from 'vitest'
import { collectUvttNativeEntities } from './entity-capabilities.js'
import type { Opening, PointMm, Prop, SceneDocument } from '../model/scene.js'
import { createAppearanceGraph } from '../appearance/graph.js'
import { openingEndpoints, propFootprint } from '../geometry/geometry.js'
import { projectScene } from '../projection/projection.js'
import { createEmptyGeneration } from '../terrain-generation/contracts.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { visualBase } from '../visual/base.js'
import { emptyVisualSystem, type VisualLight } from '../visual/types.js'
import { buildUvttPlan, UVTT_LIMITS } from './uvtt.js'

const p = (x: number, y: number): PointMm => ({ x, y })
function fixture(_internalFixture = 1): SceneDocument {
  const scene = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'uvtt-fixture', revision: 7, title: 'Private source title must not enter UVTT', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: true }, exportBoundsMm: { x: 0, y: 0, width: 12000, height: 10000 },
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: { x: -10000, y: -10000, width: 40000, height: 40000 } } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'geometry-only unit fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] } })
  return scene
}
function wall(scene: SceneDocument, a = p(1000, 2000), b = p(11000, 2000), id = 'wall') {
  for (const [name, value] of [['a', a], ['b', b]] as const) {
    const vertexId = `${id}-${name}`
    scene.vertices[vertexId] = { id: vertexId, floorId: 'floor', editLocked: false, xMm: value.x, yMm: value.y }; scene.entityLayers[vertexId] = 'layer'
  }
  scene.walls[id] = { id, floorId: 'floor', editLocked: false, startVertexId: `${id}-a`, endVertexId: `${id}-b`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
  scene.entityLayers[id] = 'layer'
}
function opening(scene: SceneDocument, id: string, changes: Partial<Opening> = {}) {
  scene.openings[id] = { id, floorId: 'floor', editLocked: false, wallId: 'wall', offsetReferenceVertexId: 'wall-a', offsetMm: 1000, widthMm: 1000,
    kind: 'door', state: 'closed', locked: false, secret: false, revealed: false, ...changes }
  scene.entityLayers[id] = 'layer'
}
function prop(scene: SceneDocument, id = 'physical-prop', changes: Partial<Prop> = {}) {
  scene.props[id] = { id, floorId: 'floor', editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 },
    positionMm: p(6000, 6000), rotationDeg: 90, footprintMm: { width: 2000, height: 1000 }, footprintOffsetMm: p(500, 0), visualBoundsMm: { x: -200, y: -200, width: 400, height: 400 },
    blocksMovement: true, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: 'floor' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null, ...changes }
  scene.entityLayers[id] = 'layer'
}
function light(scene: SceneDocument, id: string, changes: Partial<VisualLight> = {}) {
  visualBase(scene)!.lights[id] = { id, floorId: 'floor', layerId: 'layer', editLocked: false, visibility: 'public', enabled: true, positionMm: p(6000, 5000), radiusMm: 2500, intensity: 1, color: '#aB23f0', wallOcclusion: true, ...changes }
}
const warnings = (scene: SceneDocument) => buildUvttPlan(scene).report.warnings.join('\n')

describe('pure fixed-UBI UVTT layout and independent rendering plan', () => {
  it('dispatches native mapping through delivery capabilities and keeps physical props in the player projection', () => {
    const scene = fixture(); wall(scene); opening(scene, 'door'); prop(scene)
    const projection = projectScene(scene, 'player')
    const delivered = collectUvttNativeEntities(scene, projection)
    expect(delivered.walls).toEqual([scene.walls.wall]); expect(delivered.openings).toEqual([scene.openings.door])
    expect(delivered.props).toEqual(projection.props)
    expect(collectUvttNativeEntities(scene, { ...projection, props: [] }).props).toEqual([])
    expect(() => collectUvttNativeEntities(scene, { ...projection, audience: 'gm' })).toThrow(/玩家投影/)
  })

  it.each([1] as const)('reads strict scene %i without changing its persistent contract', version => {
    const scene = fixture(version), graph = createAppearanceGraph(scene), before = canonicalJson(scene), graphBefore = canonicalJson(graph)
    const result = buildUvttPlan(scene, graph)
    expect(result.report.blocked).toEqual([]); expect(result.geometry?.format).toBe(.2)
    expect(result.projection?.audience).toBe('player'); expect(result.widthPx).toBe(1680); expect(result.heightPx).toBe(1400)
    expect(canonicalJson(scene)).toBe(before); expect(canonicalJson(graph)).toBe(graphBefore)
    expect(JSON.stringify(result.geometry)).not.toContain(scene.title); expect(JSON.stringify(result.geometry)).not.toContain(scene.sceneId)
  })

  it('pads negative/non-grid-aligned bounds at world grid phase with exact square pixels and reports real feet', () => {
    const scene = fixture(); scene.exportBoundsMm = { x: -250, y: 450, width: 5100, height: 3200 }
    const result = buildUvttPlan(scene)
    expect(result.sourceBoundsMm).toEqual(scene.exportBoundsMm)
    expect(result.boundsMm).toEqual({ x: -1000, y: 0, width: 6000, height: 4000 })
    expect(result.geometry?.resolution).toEqual({ map_origin: p(-1, 0), map_size: p(6, 4), pixels_per_grid: 140 })
    expect(result.widthPx / result.boundsMm.width).toBe(result.heightPx / result.boundsMm.height)
    expect(result.projection?.bounds).toEqual(result.boundsMm)
    expect(result.report.warnings.join()).toMatch(/补边/)
    const visual = fixture(6); visual.exportBoundsMm = { ...scene.exportBoundsMm }
    const visualPlan = buildUvttPlan(visual)
    expect(visualPlan.projection?.visual?.boundsMm).toEqual(visual.exportBoundsMm)
    scene.units.display = 'ft'; scene.units.gridSizeMm = 1524; scene.units.gridVisible = false
    expect(buildUvttPlan(scene).units).toEqual({ display: 'ft', distanceUnit: 'ft', distancePerGrid: 5, gridSizeMm: 1524, gridVisible: false })
  })

  it('keeps small output at least 256px, admits 81 padded cells, and refuses 82 without lowering the protection', () => {
    const scene = fixture(); scene.exportBoundsMm = { x: 0, y: 0, width: 100, height: 100 }
    const small = buildUvttPlan(scene)
    expect(small.widthPx).toBe(256); expect(small.heightPx).toBe(256); expect(small.pixelsPerGrid).toBe(256)
    scene.exportBoundsMm.width = 81000; scene.exportBoundsMm.height = 2000
    const largest = buildUvttPlan(scene)
    expect(largest.geometry).not.toBeNull(); expect(largest.pixelsPerGrid).toBe(UVTT_LIMITS.minPixelsPerGrid); expect(largest.widthPx).toBe(4050)
    scene.exportBoundsMm.x = 1
    const tooWide = buildUvttPlan(scene)
    expect(tooWide.geometry).toBeNull(); expect(tooWide.widthPx).toBe(0); expect(tooWide.report.blocked.join()).toMatch(/81 格/)
    scene.exportBoundsMm = { x: Number.MIN_SAFE_INTEGER + 1, y: 0, width: 1000, height: 1000 }
    expect(buildUvttPlan(scene).report.blocked.join()).toMatch(/安全整数/)
  })

  it('changes only its disposable paint projection, preserving ordinary PNG grid, notes, symbols and lights', () => {
    const scene = fixture(6); wall(scene); opening(scene, 'door'); light(scene, 'light')
    scene.notes.public = { id: 'public', floorId: 'floor', editLocked: false, kind: 'label', text: 'public label', visibility: 'public', anchor: { type: 'point', positionMm: p(6000, 8000) } }; scene.entityLayers.public = 'layer'
    scene.notes.private = { ...scene.notes.public, id: 'private', text: 'do not export this secret', visibility: 'gm' }; scene.entityLayers.private = 'layer'
    const original = projectScene(scene, 'player'), before = canonicalJson(scene), result = buildUvttPlan(scene)
    expect(result.geometry).not.toBeNull(); expect(result.projection).toMatchObject({ gridSizeMm: null, notes: [], regions: [], visual: { lights: [] } })
    expect(result.projection!.walls.flatMap(value => value.openings).every(value => value.paintSymbol === false)).toBe(true)
    expect(projectScene(scene, 'player')).toEqual(original); expect(canonicalJson(scene)).toBe(before)
    expect(original.gridSizeMm).toBe(1000); expect(original.visual!.lights).toHaveLength(1); expect(original.notes[0].text).toBe('public label')
    expect(JSON.stringify(result.geometry)).not.toMatch(/public label|do not export this secret|door|wall-a|physical-prop/)
  })
})

describe('wall, opening and rotated physical footprint mapping', () => {
  it('cuts real reversed-reference door and window gaps and keeps an unrevealed secret completely continuous', () => {
    const scene = fixture(); wall(scene)
    opening(scene, 'reverse-door', { offsetReferenceVertexId: 'wall-b', offsetMm: 2000, state: 'open', locked: true })
    opening(scene, 'window', { offsetMm: 1000, kind: 'window' })
    opening(scene, 'private-door-must-not-leak', { offsetMm: 4000, secret: true })
    const result = buildUvttPlan(scene), geometry = result.geometry!
    expect(result.report.blocked).toEqual([])
    expect(geometry.line_of_sight).toEqual([[p(1, 2), p(2, 2)], [p(3, 2), p(8, 2)], [p(9, 2), p(11, 2)]])
    expect(geometry.portals).toHaveLength(2)
    const door = geometry.portals.find(value => value.closed)!, window = geometry.portals.find(value => !value.closed)!
    expect(door.bounds).toEqual([p(9, 2), p(8, 2)]); expect(door.position).toEqual(p(8.5, 2)); expect(door.closed).toBe(true)
    expect(window.bounds).toEqual([p(2, 2), p(3, 2)])
    expect(result.report.counts.hiddenSecretOpenings).toBe(1)
    expect(result.report.warnings.join()).toMatch(/开关状态/); expect(result.report.warnings.join()).toMatch(/重新设置门锁/)
    expect(JSON.stringify(geometry)).not.toContain('private-door-must-not-leak')
    expect(result.report.warnings.join()).not.toContain('private-door-must-not-leak')
    expect(result.projection!.walls.flatMap(value => value.openings)).toHaveLength(2)
  })

  it('uses real diagonal endpoints without integer re-snapping, and does not encode revealed secrets as secret target doors', () => {
    const scene = fixture(); wall(scene, p(1000, 1000), p(9000, 9000))
    opening(scene, 'revealed', { offsetReferenceVertexId: 'wall-b', offsetMm: 2000, widthMm: 1200, secret: true, revealed: true })
    const result = buildUvttPlan(scene), portal = result.geometry!.portals[0], expected = openingEndpoints(scene, scene.openings.revealed)
    for (let index = 0; index < 2; index++) {
      expect(portal.bounds[index].x * 1000).toBeCloseTo(expected[index].x, 7)
      expect(portal.bounds[index].y * 1000).toBeCloseTo(expected[index].y, 7)
    }
    expect(Math.hypot(portal.bounds[0].x - portal.bounds[1].x, portal.bounds[0].y - portal.bounds[1].y) * 1000).toBeCloseTo(1200, 7)
    expect(portal.closed).toBe(true); expect(portal).not.toHaveProperty('secret'); expect(result.report.warnings.join()).toMatch(/降级为普通门/)
  })

  it('erases hidden collinear split endpoints across equivalent wall segmentations while preserving real public portal gaps', () => {
    const whole = fixture(); wall(whole)
    const expected = buildUvttPlan(whole).geometry!
    for (const splitX of [3000, 6000, 8000]) {
      const scene = fixture(); wall(scene, p(1000, 2000), p(splitX, 2000)); wall(scene, p(splitX, 2000), p(11000, 2000), 'extension')
      scene.walls.extension.startVertexId = 'wall-b'; delete scene.vertices['extension-a']; delete scene.entityLayers['extension-a']
      const hostWall = splitX >= 5000 ? 'wall' : 'extension', hostStart = splitX >= 5000 ? 1000 : splitX
      opening(scene, 'hidden-not-a-portal', { wallId: hostWall, offsetReferenceVertexId: `${hostWall}-a`, offsetMm: 4000 - hostStart, widthMm: 1000, secret: true })
      if (hostWall === 'extension') scene.openings['hidden-not-a-portal'].offsetReferenceVertexId = 'wall-b'
      const result = buildUvttPlan(scene)
      expect(result.report.blocked).toEqual([]); expect(result.geometry).toEqual(expected)
      expect(result.geometry!.line_of_sight).toEqual([[p(1, 2), p(11, 2)]]); expect(result.geometry!.portals).toEqual([])
      opening(scene, 'public-portal', { wallId: 'extension', offsetReferenceVertexId: 'extension-b', offsetMm: 1000, widthMm: 1000 })
      const publicResult = buildUvttPlan(scene)
      expect(publicResult.geometry!.line_of_sight).toEqual([[p(1, 2), p(9, 2)], [p(10, 2), p(11, 2)]])
      expect(publicResult.geometry!.portals[0].bounds).toEqual([p(10, 2), p(9, 2)])
      scene.walls.extension.blocksSight = false
      expect(buildUvttPlan(scene).report.blocked.join()).toMatch(/不同的移动或视线语义/)
    }
  })

  it('clips diagonal LOS to the original crop and refuses a partial portal instead of moving its endpoints', () => {
    const scene = fixture(); wall(scene, p(1000, 1000), p(9000, 9000))
    scene.exportBoundsMm = { x: 2500, y: 2000, width: 4300, height: 5000 }
    const clipped = buildUvttPlan(scene)
    expect(clipped.geometry!.line_of_sight).toEqual([[p(2.5, 2.5), p(6.8, 6.8)]])
    expect(clipped.boundsMm.x).toBe(2000)
    opening(scene, 'cut-door', { offsetMm: 1800, widthMm: 1500 })
    const blocked = buildUvttPlan(scene)
    expect(blocked.geometry).toBeNull(); expect(blocked.report.blocked.join()).toMatch(/切过门窗/)
    expect(blocked.report.blocked.join()).not.toContain('cut-door')
  })

  it('refuses catastrophic cancellation at otherwise valid large absolute millimetre coordinates', () => {
    const scene = fixture(), x = Number.MAX_SAFE_INTEGER - 20000
    scene.floors.floor.boundsMm = { x: Number.MAX_SAFE_INTEGER - 30000, y: -10000, width: 30000, height: 40000 }
    scene.exportBoundsMm = { x, y: 0, width: 10000, height: 10000 }
    wall(scene, p(x, 2000), p(x + 8000, 2000))
    expect(validateSceneDocument(scene).ok).toBe(true)
    const result = buildUvttPlan(scene)
    expect(result.geometry).toBeNull(); expect(result.report.blocked.join()).toMatch(/0.05 像素/)
    expect(result.report.blocked.join()).not.toContain(String(x))
  })

  it('maps physical offset and rotation rather than visual bounds, and clips each prop segment without creating a crop wall', () => {
    const scene = fixture(); prop(scene)
    const full = buildUvttPlan(scene), expected = propFootprint(scene.props['physical-prop'])
    expect(full.report.counts.blockingProps).toBe(1); expect(full.geometry!.line_of_sight).toHaveLength(4)
    expect(full.geometry!.line_of_sight[0]).toEqual(expected.slice(0, 2).map(value => p(value.x / 1000, value.y / 1000)))
    expect(full.report.warnings.join()).toMatch(/部分物件仅阻挡移动或视线/)
    scene.exportBoundsMm = { x: 6000, y: 5000, width: 2000, height: 3000 }
    const clipped = buildUvttPlan(scene), segments = clipped.geometry!.line_of_sight
    expect(segments).toHaveLength(3)
    expect(segments.flat().every(value => value.x >= 6 && value.x <= 8 && value.y >= 5 && value.y <= 8)).toBe(true)
    expect(segments.some(segment => segment.every(value => value.x === 6))).toBe(false)
  })

  it('conservatively combines movement/sight flags and explicitly reports omitted terrain blocking rules', () => {
    const scene = fixture(); wall(scene); scene.walls.wall.blocksSight = false
    scene.terrainAreas.swamp = { id: 'swamp', floorId: 'floor', editLocked: false, visibility: 'public', groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: true, blocksSight: false, movementCostMultiplier: 2,
      boundaryMm: [p(1000, 5000), p(4000, 5000), p(4000, 8000), p(1000, 8000)].map((positionMm, index) => ({ id: `swamp-p${index}`, segmentId: `swamp-s${index}`, positionMm })) }
    scene.entityLayers.swamp = 'layer'
    scene.terrainEdges.edge = { id: 'edge', floorId: 'floor', editLocked: false, visibility: 'public', source: { areaId: 'swamp', segmentId: 'swamp-s0' }, neighborAreaId: null, kind: 'materialTransition', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: null, styleOverride: null }; scene.entityLayers.edge = 'layer'
    const result = buildUvttPlan(scene)
    expect(result.geometry!.line_of_sight).toHaveLength(1); expect(result.report.counts.terrainBlockersOmitted).toBe(2)
    expect(result.report.warnings.join()).toMatch(/部分墙仅阻挡移动或视线/)
    expect(result.report.warnings.join()).toMatch(/地形面及边缘.*未映射为原生规则/)
    expect(result.report.warnings.join()).toMatch(/墙厚仅保留在底图/)
    scene.walls.wall.blocksMovement = false
    expect(buildUvttPlan(scene).geometry!.line_of_sight).toEqual([])
    opening(scene, 'nonblocking-door')
    const nonblocking = buildUvttPlan(scene)
    expect(nonblocking.geometry!.line_of_sight).toEqual([]); expect(nonblocking.geometry!.portals).toHaveLength(1)
    expect(nonblocking.report.warnings.join()).toMatch(/原本不阻挡移动或视线/)
    scene.openings['nonblocking-door'].secret = true
    const secret = buildUvttPlan(scene)
    expect(secret.geometry).toBeNull(); expect(secret.report.blocked.join()).toMatch(/非阻挡墙上的未揭示秘密门/)
    expect(nonblocking.report.warnings.join()).toMatch(/环境、阴影、雾与滤镜保留为静态底图/)
  })
})

describe('explicit native light conversion and fail-closed privacy', () => {
  it('converts only explicit public enabled nonzero point lights using the audited importer formulas', () => {
    const scene = fixture(6); scene.exportBoundsMm = { x: 500, y: 500, width: 10000, height: 8000 }
    light(scene, 'public', { intensity: 2, wallOcclusion: false })
    light(scene, 'disabled', { enabled: false }); light(scene, 'zero', { intensity: 0 }); light(scene, 'private', { visibility: 'gm' })
    light(scene, 'outside-original-crop', { positionMm: p(250, 6000) })
    const result = buildUvttPlan(scene), converted = result.geometry!.lights
    expect(converted).toEqual([{ position: p(6, 5), range: 2.5, intensity: 20, color: 'FFAB23F0', shadows: false }])
    expect(.05 * converted[0].intensity).toBe(1); expect(`#${converted[0].color.substring(2)}`).toBe('#AB23F0')
    expect(result.report.warnings.join()).toMatch(/忽略 shadows/); expect(result.report.warnings.join()).toMatch(/默认每格距离/)
    expect(result.report.warnings.join()).toMatch(/范围外的点光不导出/)
    expect(result.projection!.visual!.lights).toEqual([])
    light(scene, 'public', { positionMm: p(600, 500), radiusMm: 1000 })
    expect(warnings(scene)).toMatch(/原生点光不截短半径/)
    expect(JSON.stringify(converted)).not.toMatch(/private|disabled|outside-original-crop/)
  })

  it('blocks all fixed-mask structure packages and private geometry without identifying it in the report', () => {
    const scene = fixture(); scene.regions['mask-private-name'] = { id: 'mask-private-name', floorId: 'floor', editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1, boundaryMm: [p(3000, 3000), p(10000, 3000), p(10000, 10000), p(3000, 10000)] }; scene.entityLayers['mask-private-name'] = 'layer'
    prop(scene, 'secret-location-label', { visibility: 'gm' })
    const masked = buildUvttPlan(scene)
    expect(masked.geometry).toBeNull(); expect(masked.report.blocked.join()).toMatch(/固定私密遮罩/)
    expect(masked.report.blocked.join()).toMatch(/私密几何/)
    expect(JSON.stringify(masked.report)).not.toMatch(/mask-private-name|secret-location-label|6000/)
    delete scene.regions['mask-private-name']; delete scene.entityLayers['mask-private-name']
    const unsafe = buildUvttPlan(scene)
    expect(unsafe.geometry).toBeNull(); expect(unsafe.projection).toBeNull(); expect(unsafe.report.blocked.join()).toMatch(/安全的玩家投影/)
  })

  it('returns a structured single-Floor refusal and rejects invalid/unowned source values before any conversion', () => {
    const scene = fixture(); scene.floors.second = { id: 'second', name: 'Do not reveal', boundsMm: { x: 0, y: 0, width: 1000, height: 1000 } }
    const multi = buildUvttPlan(scene)
    expect(multi.projection).toBeNull(); expect(multi.geometry).toBeNull(); expect(multi.report.blocked.join()).toMatch(/单 Floor/)
    expect(JSON.stringify(multi.report)).not.toContain('Do not reveal')
    const invalid = fixture(); wall(invalid); invalid.walls.wall.startVertexId = 'missing-source'
    expect(() => buildUvttPlan(invalid)).toThrow(/完整模型校验/)
    let calls = 0
    const accessor = fixture(); Object.defineProperty(accessor, 'title', { enumerable: true, get: () => { calls++; return 'private' } })
    expect(() => buildUvttPlan(accessor)).toThrow(/完整模型校验/); expect(calls).toBe(0)
    expect(validateSceneDocument(fixture()).ok).toBe(true)
  })
})
