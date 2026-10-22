import { describe, expect, it } from 'vitest'
import type { PropV2, SceneDocumentV2 } from '../../core/v2/types'
import { projectSceneV2 } from '../../render/v2/projection'
import { wallGeometryV2 } from '../../render/v2/renderer'
import { createBlankDocumentV2 } from './blank-project'
import { validateSceneSnapshotV2 } from '../../core/v2/snapshots'
import { pointInPolygonV2, polygonDistance } from '../../core/v2/geometry'
import { effectiveEditLockedV2, hitTestAllV2, normalizeSelectionV2, propVisualPolygonV2, selectInBoundsV2, selectionGeometryV2, selectionUnitIdV2 } from './selection'

function scene(): SceneDocumentV2 {
  return createBlankDocumentV2({ title: 'selection', widthMm: 14000, heightMm: 10000, preset: 'investigation', sceneId: 'selection', now: '2026-10-21T00:00:00.000Z' })
}
function prop(id: string, x = 4000, y = 4000): PropV2 {
  return { id, floorId: 'blank-floor', editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
    visualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 }, positionMm: { x, y }, rotationDeg: 0,
    footprintMm: { width: 100, height: 100 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false,
    supportRef: { kind: 'floor', id: 'blank-floor' }, visibility: 'public', renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
}
function groupScene(): SceneDocumentV2 {
  const document = scene()
  document.props.left = prop('left', 3000, 4000); document.props.right = prop('right', 6000, 4000)
  document.prefabInstances.group = { id: 'group', floorId: 'blank-floor', editLocked: false, visibility: 'public', definitionRef: { id: 'unused-by-selection', version: 1 },
    anchorMm: { x: 4500, y: 4000 }, rotationDeg: 0, members: { left: { propId: 'left', overrideFields: [] }, right: { propId: 'right', overrideFields: [] }, removed: { propId: null, overrideFields: [] } } }
  return document
}
function withWall(document = scene()): SceneDocumentV2 {
  document.vertices.a = { id: 'a', floorId: 'blank-floor', editLocked: false, xMm: 1000, yMm: 4000 }
  document.vertices.b = { id: 'b', floorId: 'blank-floor', editLocked: false, xMm: 9000, yMm: 4000 }
  document.walls.wall = { id: 'wall', floorId: 'blank-floor', editLocked: false, startVertexId: 'a', endVertexId: 'b', thicknessMm: 400, blocksMovement: true, blocksSight: true, topStyle: null }
  document.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall', offsetReferenceVertexId: 'a', offsetMm: 3500, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
  return document
}

describe('C1b visual geometry and boundary-inclusive selection', () => {
  it('keeps spatial candidates identical to an independent exact scan of rotated props', () => {
    const input = scene()
    for (let i = 0; i < 300; i++) {
      const current = prop(`spatial-${i}`, 800 + i * 271 % 12000, 800 + i * 367 % 8000)
      current.rotationDeg = i * 17 % 360; current.renderOrder = i % 11
      input.props[current.id] = current
    }
    const checked = validateSceneSnapshotV2(input)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    const document = checked.document
    const ordered = Object.values(document.props).sort((a, b) => b.renderOrder - a.renderOrder || b.id.localeCompare(a.id))
    for (let i = 0; i < 25; i++) {
      const point = { x: 400 + i * 719 % 13000, y: 400 + i * 433 % 9000 }
      const hits = ordered.filter(item => pointInPolygonV2(point, propVisualPolygonV2(item), true) || polygonDistance(propVisualPolygonV2(item), [point]) <= 1e-6).map(item => item.id)
      expect(hitTestAllV2(document, point, 0)).toEqual(hits)
      const bounds = { x: point.x - 230, y: point.y - 180, width: 700, height: 560 }
      const corners = [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]
      const inBounds = (p: { x: number; y: number }) => p.x >= bounds.x - 1e-6 && p.x <= bounds.x + bounds.width + 1e-6 && p.y >= bounds.y - 1e-6 && p.y <= bounds.y + bounds.height + 1e-6
      const expectedContain = ordered.filter(item => propVisualPolygonV2(item).every(inBounds)).map(item => item.id)
      const expectedIntersect = ordered.filter(item => { const shape = propVisualPolygonV2(item); return shape.some(inBounds) || corners.some(corner => pointInPolygonV2(corner, shape, true)) || polygonDistance(shape, corners) <= 1e-6 }).map(item => item.id)
      expect(selectInBoundsV2(document, bounds, 'contain').ids).toEqual(expectedContain)
      expect(selectInBoundsV2(document, bounds, 'intersect').ids).toEqual(expectedIntersect)
    }
  })

  it('falls back safely for giant bounds and keeps large shapes and tolerance near cell boundaries', () => {
    const document = scene(); document.props.item = prop('item'); document.props.item.visualBoundsMm = { x: -3900, y: -3900, width: 7800, height: 7800 }
    const checked = validateSceneSnapshotV2(document)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    expect(hitTestAllV2(checked.document, { x: 4000, y: 4000 }, 0)).toEqual(['item'])
    expect(selectInBoundsV2(checked.document, { x: -1e100, y: -1e100, width: 2e100, height: 2e100 }, 'contain').ids).toEqual(['item'])
    expect(selectInBoundsV2(checked.document, { x: 100, y: 4000, width: 1e-7, height: 10 }, 'intersect').ids).toEqual(['item'])
  })

  it('bounds grid walks for huge finite point cells and caller-owned distant geometry', () => {
    const document = scene(); document.props.item = prop('item')
    expect(hitTestAllV2(document, { x: 1e100, y: 1e100 }, 0)).toEqual([])
    expect(selectInBoundsV2(document, { x: 1e100, y: 1e100, width: 1, height: 1 }, 'intersect').ids).toEqual([])
    document.props.distant = prop('distant', 1e100, 1e100)
    expect(hitTestAllV2(document, { x: 4000, y: 4000 }, 0)).toEqual(['item'])
  })

  it('reuses only certified snapshots and observes caller-owned nested mutations after a shallow freeze', () => {
    const input = scene(); input.props.item = prop('item')
    const checked = validateSceneSnapshotV2(input)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    expect(hitTestAllV2(checked.document, { x: 4000, y: 4000 }, 0)).toEqual(['item'])
    const shapes = selectionGeometryV2(checked.document, 'item'); shapes[0][0].x = -999
    expect(selectionGeometryV2(checked.document, 'item')[0][0].x).toBe(3500)
    Object.freeze(input)
    expect(hitTestAllV2(input, { x: 4000, y: 4000 }, 0)).toEqual(['item'])
    input.props.item.positionMm.x = 8000; input.props.item.editLocked = true
    expect(hitTestAllV2(input, { x: 4000, y: 4000 }, 0)).toEqual([])
    expect(selectInBoundsV2(input, input.exportBoundsMm, 'contain')).toMatchObject({ ids: [], excludedLocked: 1 })
    expect(hitTestAllV2(checked.document, { x: 4000, y: 4000 }, 0)).toEqual(['item'])
    expect(effectiveEditLockedV2(checked.document, 'item')).toBe(false)
  })

  it('rotates the complete visual rectangle with its offset, independently of footprint and shadow', () => {
    const item = prop('item'); item.rotationDeg = 90
    item.visualBoundsMm = { x: -100, y: -300, width: 800, height: 400 }
    const points = propVisualPolygonV2(item)
    expect(points[0].x).toBeCloseTo(4300); expect(points[0].y).toBeCloseTo(3900)
    expect(points[2].x).toBeCloseTo(3900); expect(points[2].y).toBeCloseTo(4700)
    points[0].x = -1
    expect(item.positionMm).toEqual({ x: 4000, y: 4000 })
    expect(item.visualBoundsMm.x).toBe(-100)
  })

  it('does not hit the empty corner of a rotated AABB and includes its actual edge', () => {
    const document = scene(); document.props.rotated = prop('rotated'); document.props.rotated.rotationDeg = 45
    expect(hitTestAllV2(document, { x: 4600, y: 4600 }, 0)).toEqual([])
    expect(hitTestAllV2(document, { x: 4600, y: 4600 }, 500)).toEqual([])
    expect(hitTestAllV2(document, { x: 4000 + Math.SQRT1_2 * 1000, y: 4000 }, 0)).toEqual(['rotated'])
    expect(hitTestAllV2(document, { x: 4000, y: 4000 }, 0)).toEqual(['rotated'])
    expect(selectInBoundsV2(document, { x: 4580, y: 4580, width: 30, height: 30 }, 'intersect').ids).toEqual([])
  })

  it('requires every visual corner for containment, accepts reverse drags, and intersects a box inside a prop', () => {
    const document = scene(); document.props.item = prop('item')
    expect(selectInBoundsV2(document, { x: 3500, y: 3500, width: 999, height: 1000 }, 'contain').ids).toEqual([])
    expect(selectInBoundsV2(document, { x: 4500, y: 4500, width: -1000, height: -1000 }, 'contain').ids).toEqual(['item'])
    expect(selectInBoundsV2(document, { x: 3900, y: 3900, width: 100, height: 100 }, 'intersect').ids).toEqual(['item'])
    expect(selectInBoundsV2(document, { x: 4500, y: 4000, width: 100, height: 100 }, 'intersect').ids).toEqual(['item'])
    expect(selectInBoundsV2(document, { x: 4501, y: 4000, width: 100, height: 100 }, 'intersect').ids).toEqual([])
  })

  it('uses the true wall band and opening span instead of the centerline or an uncut wall', () => {
    const document = withWall()
    expect(hitTestAllV2(document, { x: 3000, y: 4199 }, 0)).toEqual(['wall'])
    expect(hitTestAllV2(document, { x: 3000, y: 4201 }, 0)).toEqual([])
    expect(hitTestAllV2(document, { x: 5000, y: 4000 }, 0)).toEqual(['door'])
    expect(selectInBoundsV2(document, { x: 3000, y: 4200, width: 100, height: 20 }, 'intersect').ids).toEqual(['wall'])
    expect(selectInBoundsV2(document, { x: 4900, y: 3900, width: 200, height: 200 }, 'intersect').ids).toEqual(['door'])
    expect(selectInBoundsV2(document, { x: 900, y: 3990, width: 8200, height: 20 }, 'contain').ids).not.toContain('wall')
  })

  it('includes real miter joins and returns detached wall geometry', () => {
    const document = withWall(); document.openings = {}
    document.vertices.c = { ...document.vertices.b, id: 'c', xMm: 9000, yMm: 8000 }
    document.walls.side = { ...document.walls.wall, id: 'side', startVertexId: 'b', endVertexId: 'c' }
    expect(hitTestAllV2(document, { x: 9150, y: 3850 }, 0)).toContain('wall')
    const shapes = selectionGeometryV2(document, 'wall'); shapes[0][0].x = -999
    expect(selectionGeometryV2(document, 'wall')[0][0].x).not.toBe(-999)
    expect(document.vertices.a.xMm).toBe(1000)
  })

  it('keeps wall hits, shared joins and opening hits in GM draw order when record insertion order changes', () => {
    const document = withWall()
    document.vertices.c = { ...document.vertices.b, id: 'c', xMm: 9000, yMm: 8000 }
    document.walls.side = { ...document.walls.wall, id: 'side', startVertexId: 'b', endVertexId: 'c' }
    document.openings.door.offsetMm = 7000; document.openings.door.widthMm = 600
    document.openings['side-door'] = { ...document.openings.door, id: 'side-door', wallId: 'side', offsetReferenceVertexId: 'b', offsetMm: 500 }
    const permuted = structuredClone(document)
    permuted.walls = Object.fromEntries(Object.entries(permuted.walls).reverse())
    permuted.openings = Object.fromEntries(Object.entries(permuted.openings).reverse())
    for (const current of [document, permuted]) {
      expect(hitTestAllV2(current, { x: 8900, y: 4100 }, 0)).toEqual(['side', 'wall'])
      expect(hitTestAllV2(current, { x: 9150, y: 3850 }, 0)).toEqual(['wall'])
      expect(hitTestAllV2(current, { x: 8800, y: 4400 }, 600).filter(id => id === 'door' || id === 'side-door')).toEqual(['side-door', 'door'])
      const renderedWalls = wallGeometryV2(projectSceneV2(current, 'gm').walls)
      for (const rendered of renderedWalls) expect(selectionGeometryV2(current, rendered.wall.id)).toEqual(rendered.polygons)
    }
    expect(selectionGeometryV2(permuted, 'wall')).toEqual(selectionGeometryV2(document, 'wall'))
  })

  it('keeps overlapping terrain connections in GM ID draw order after insertion-order changes', () => {
    const document = scene()
    document.terrainConnections['z-bridge'] = { id: 'z-bridge', floorId: 'blank-floor', editLocked: false, visibility: 'public', kind: 'ramp', from: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 9000, y: 2000 } }, to: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 9000, y: 8000 } }, widthMm: 800, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    document.terrainConnections['a-bridge'] = { ...structuredClone(document.terrainConnections['z-bridge']), id: 'a-bridge' }
    const permuted = structuredClone(document)
    permuted.terrainConnections = Object.fromEntries(Object.entries(permuted.terrainConnections).reverse())
    for (const current of [document, permuted]) {
      expect(projectSceneV2(current, 'gm').connections.map(connection => connection.id)).toEqual(['a-bridge', 'z-bridge'])
      expect(hitTestAllV2(current, { x: 9000, y: 4000 }, 0)).toEqual(['z-bridge', 'a-bridge'])
    }
  })

  it('orders object/canopy above walls and ground below walls, retaining locked hits for inspection', () => {
    const document = withWall(); document.openings = {}
    for (const id of ['ground', 'object-a', 'object-z', 'canopy']) document.props[id] = prop(id)
    document.props.ground.renderLayer = 'ground'; document.props.ground.renderOrder = 999
    document.props.canopy.renderLayer = 'canopy'; document.props.canopy.editLocked = true
    expect(hitTestAllV2(document, { x: 4000, y: 4000 }, 0)).toEqual(['canopy', 'object-z', 'object-a', 'wall', 'ground'])
    document.props['object-a'].renderOrder = 5
    expect(hitTestAllV2(document, { x: 4000, y: 4000 }, 0)).toEqual(['canopy', 'object-a', 'object-z', 'wall', 'ground'])
  })

  it('uses terrain polygons, source segments and connection widths, including crossings without contained vertices', () => {
    const document = scene()
    document.terrainAreas.land = { id: 'land', floorId: 'blank-floor', editLocked: false, visibility: 'public', boundaryMm: [{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 8000 }, { x: 2000, y: 8000 }].map((positionMm, i) => ({ id: `v${i}`, segmentId: `s${i}`, positionMm })), groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    document.terrainEdges.edge = { id: 'edge', floorId: 'blank-floor', editLocked: false, visibility: 'public', source: { areaId: 'land', segmentId: 's0' }, neighborAreaId: null, kind: 'shore', shoreline: true, blocksMovement: false, blocksSight: false, surfaceStyle: null, styleOverride: null }
    document.terrainConnections.bridge = { id: 'bridge', floorId: 'blank-floor', editLocked: false, visibility: 'public', kind: 'ramp', from: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 9000, y: 2000 } }, to: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 9000, y: 8000 } }, widthMm: 800, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    expect(selectInBoundsV2(document, { x: 4900, y: 1900, width: 200, height: 200 }, 'intersect').ids).toEqual(['edge', 'land'])
    expect(selectInBoundsV2(document, { x: 9300, y: 4000, width: 100, height: 100 }, 'intersect').ids).toEqual(['bridge'])
    expect(hitTestAllV2(document, { x: 2000, y: 2000 }, 0)[0]).toBe('v0')
    document.terrainAreas.land.editLocked = true
    expect(effectiveEditLockedV2(document, 'v0')).toBe(true)
  })

  it('filters floors and rejects invalid pointer/rectangle inputs without touching the scene', () => {
    const document = scene(); document.props.item = prop('item'); const before = structuredClone(document)
    expect(hitTestAllV2(document, { x: 4000, y: 4000 }, 10, { floorId: 'other' })).toEqual([])
    expect(selectInBoundsV2(document, { x: 0, y: 0, width: 14000, height: 10000 }, 'contain', { floorId: 'other' }).ids).toEqual([])
    expect(() => hitTestAllV2(document, { x: NaN, y: 0 }, 0)).toThrow(/有限/)
    expect(() => hitTestAllV2(document, { x: 0, y: 0 }, -1)).toThrow(/非负/)
    expect(() => selectInBoundsV2(document, { x: 0, y: 0, width: Infinity, height: 1 }, 'contain')).toThrow(/有限/)
    expect(document).toEqual(before)
  })
})

describe('C1b prefab units, visibility and effective edit locks', () => {
  it('preserves group selection order even when its highest member lies outside the query cells', () => {
    const document = groupScene()
    document.props.middle = prop('middle', 3000, 4000)
    document.props.right.renderOrder = 10; document.props.middle.renderOrder = 5; document.props.left.renderOrder = 0
    expect(selectInBoundsV2(document, { x: 2500, y: 3500, width: 1000, height: 1000 }, 'intersect').ids).toEqual(['group', 'middle'])
    expect(hitTestAllV2(document, { x: 3000, y: 4000 }, 0)).toEqual(['middle', 'group'])
  })

  it('selects a prefab as the union of its members, with all members required for containment', () => {
    const document = groupScene()
    expect(hitTestAllV2(document, { x: 3000, y: 4000 }, 0)).toEqual(['group'])
    expect(hitTestAllV2(document, { x: 4500, y: 4000 }, 0)).toEqual([])
    expect(selectInBoundsV2(document, { x: 2500, y: 3500, width: 1000, height: 1000 }, 'contain').ids).toEqual([])
    expect(selectInBoundsV2(document, { x: 2500, y: 3500, width: 1000, height: 1000 }, 'intersect').ids).toEqual(['group'])
    expect(selectInBoundsV2(document, { x: 2500, y: 3500, width: 4000, height: 1000 }, 'contain').ids).toEqual(['group'])
    expect(selectInBoundsV2(document, { x: 4000, y: 3900, width: 1000, height: 200 }, 'intersect').ids).toEqual([])
    expect(selectionGeometryV2(document, 'group')).toHaveLength(2)
  })

  it('permits explicit member mode and always removes a child when its group is explicitly selected', () => {
    const document = groupScene()
    expect(selectionUnitIdV2(document, 'left')).toBe('group')
    expect(selectionUnitIdV2(document, 'left', true)).toBe('left')
    expect(selectionUnitIdV2(document, '__proto__')).toBeNull()
    expect(normalizeSelectionV2(document, ['left', 'right', 'left', 'missing'])).toEqual(['group'])
    expect(normalizeSelectionV2(document, ['left', 'group', 'right'], true)).toEqual(['group'])
    expect(normalizeSelectionV2(document, ['group', 'left', 'right'], true)).toEqual(['group'])
    expect(hitTestAllV2(document, { x: 3000, y: 4000 }, 0, { memberMode: true })).toEqual(['left'])
    expect(selectInBoundsV2(document, { x: 2500, y: 3500, width: 1000, height: 1000 }, 'contain', { memberMode: true }).ids).toEqual(['left'])
  })

  it('excludes whole hidden units and counts once, while member mode allows visible siblings', () => {
    const document = groupScene(), bounds = { x: 2500, y: 3500, width: 4000, height: 1000 }, hiddenIds = new Set(['right'])
    expect(selectInBoundsV2(document, bounds, 'contain', { hiddenIds })).toEqual({ ids: [], excludedLocked: 0, excludedHidden: 1 })
    expect(hitTestAllV2(document, { x: 3000, y: 4000 }, 0, { hiddenIds })).toEqual([])
    expect(selectInBoundsV2(document, bounds, 'contain', { hiddenIds, memberMode: true })).toEqual({ ids: ['left'], excludedLocked: 0, excludedHidden: 1 })
    expect(hitTestAllV2(document, { x: 3000, y: 4000 }, 0, { hiddenIds: new Set(['group']), memberMode: true })).toEqual([])
  })

  it('excludes groups with a locked member, inherits container locks, and keeps clicked units inspectable', () => {
    const document = groupScene(), bounds = { x: 2500, y: 3500, width: 4000, height: 1000 }
    document.props.right.editLocked = true
    expect(effectiveEditLockedV2(document, 'group')).toBe(true)
    expect(selectInBoundsV2(document, bounds, 'contain')).toEqual({ ids: [], excludedLocked: 1, excludedHidden: 0 })
    expect(selectInBoundsV2(document, bounds, 'contain', { memberMode: true })).toEqual({ ids: ['left'], excludedLocked: 1, excludedHidden: 0 })
    expect(hitTestAllV2(document, { x: 3000, y: 4000 }, 0)).toEqual(['group'])
    document.prefabInstances.group.editLocked = true
    expect(effectiveEditLockedV2(document, 'left')).toBe(true)
    expect(selectInBoundsV2(document, bounds, 'contain', { memberMode: true }).excludedLocked).toBe(2)
  })

  it('shares command dependency locks, including recursive anchored notes and adjacent architecture', () => {
    const document = withWall(groupScene())
    document.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'note', text: 'first', anchor: { type: 'entity', entityKind: 'prop', entityId: 'left' } }
    document.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: true, visibility: 'gm', kind: 'note', text: 'second', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    expect(effectiveEditLockedV2(document, 'left')).toBe(true)
    expect(effectiveEditLockedV2(document, 'right')).toBe(false)
    expect(effectiveEditLockedV2(document, 'group')).toBe(true)
    document.openings.door.editLocked = true
    expect(effectiveEditLockedV2(document, 'wall')).toBe(true)
    expect(effectiveEditLockedV2(document, 'a')).toBe(true)
    expect(effectiveEditLockedV2(document, 'missing')).toBe(false)
  })

  it('keeps scatter members independent while respecting their group lock and explicit group normalization', () => {
    const document = groupScene(); document.prefabInstances = {}
    document.scatterGroups.scatter = { id: 'scatter', floorId: 'blank-floor', editLocked: true, visibility: 'public', domain: { kind: 'area', areaId: 'unused-by-hit-test' }, palette: [], seed: 'test', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 0, y: 0 }, cellSizeMm: 1000, densityFactor: .5, minDistanceMm: 100, rotationRangeDeg: { min: 0, max: 359 }, members: { a: { propId: 'left', state: 'manual', overrideFields: [] } }, exclusions: [] }
    expect(selectionUnitIdV2(document, 'left')).toBe('left')
    expect(hitTestAllV2(document, { x: 3000, y: 4000 }, 0)).toEqual(['left'])
    expect(effectiveEditLockedV2(document, 'left')).toBe(true)
    expect(normalizeSelectionV2(document, ['left', 'scatter'], true)).toEqual(['scatter'])
  })
})
