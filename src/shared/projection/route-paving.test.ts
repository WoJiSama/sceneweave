import { describe, expect, it } from 'vitest'
import { createVisualBlankDocument } from '../../platform/browser/content/visual-samples.js'
import { VisualAuthoringOperationSchema } from '../ai/visual-protocol.js'
import { applyCommands } from '../commands/commands.js'
import { pathPolygon, pointInPolygon } from '../geometry/geometry.js'
import type { MaterialPaint, Path, PointMm } from '../model/scene.js'
import { sceneSchema } from '../validation/scene.js'
import { visualCommandSchema } from '../visual/commands.js'
import { projectPath } from './paths.js'
import { joinedPavingPaint } from './route-paving.js'

const p = (x: number, y: number) => ({ x, y })
const base: MaterialPaint = { materialRef: { id: 'plate', version: 2 }, tileSizeMm: { width: 1600, height: 2000 },
  rotationDeg: 90, alignment: 'route', originMm: p(150, 260), tint: null, opacity: 1 }
const road = (centerlineMm: PointMm[]): Path => ({ id: 'road', floorId: 'floor', editLocked: false, visibility: 'public',
  centerlineMm, widthMm: 1200, surfaceStyle: { base, overlays: [] }, movementCostMultiplier: 1,
  supportRefs: [{ kind: 'floor', id: 'floor' }], renderOrder: 0 })
const areaOf = (ring: PointMm[]) => Math.abs(ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length]
  return sum + a.x * b.y - a.y * b.x
}, 0) / 2)

function tilePosition(appearance: MaterialPaint, at: PointMm) {
  const angle = -appearance.rotationDeg * Math.PI / 180, x = at.x - appearance.originMm.x, y = at.y - appearance.originMm.y
  return p(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle))
}

describe('route-aligned paving', () => {
  it('shares a real miter and phase along a tapered elbow, then tracks both changed width and direction', () => {
    const source = road([p(1000, 1000), p(8000, 1000), p(8000, 8000), p(8000, 12000)])
    source.widthSections = [{ startPpm: 230000, endPpm: 640000, widthMm: 2100 }]
    const projected = projectPath(source, null)
    const [first, last] = projected.paving!
    expect(projected.paving).toHaveLength(2)
    expect(first.points).toContainEqual(last.points[0])
    expect(first.points).toContainEqual(last.points.at(-1))
    expect(areaOf(first.points) + areaOf(last.points)).toBeCloseTo(areaOf(pathPolygon(source)))
    expect([...first.points, ...last.points].every(point => pointInPolygon(point, projected.points))).toBe(true)
    const center = source.centerlineMm[1]
    const [before, after] = [tilePosition(first.paint, center), tilePosition(last.paint, center)]
    expect(before.x).toBeCloseTo(after.x); expect(before.y).toBeCloseTo(after.y)
    expect([first.paint.rotationDeg, last.paint.rotationDeg]).toEqual([90, 180])
    source.centerlineMm[1] = p(8200, 1500)
    source.widthSections[0].widthMm = 2700
    const changed = projectPath(source, null)
    expect(changed.paving?.[0].paint.rotationDeg).toBeGreaterThan(90)
    expect(areaOf(changed.points)).toBeGreaterThan(areaOf(projected.points))
    expect(source.surfaceStyle?.base).toEqual(base)
  })

  it('carries a bridge phase forward for differently oriented and reversed approaches', () => {
    const bridge = projectPath(road([p(0, 0), p(6000, 0)]), null).paving![0]
    const approach = projectPath(road([p(13000, 3500), p(6100, 0)]), null).paving![0]
    const straight = projectPath(road([p(12000, 0), p(6100, 0)]), null).paving![0]
    const join = p(6300, 90), paint = joinedPavingPaint(bridge, approach, join)
    expect(joinedPavingPaint(bridge, straight, join)).toBe(bridge.paint)
    expect(paint.rotationDeg).toBeGreaterThan(90)
    const [before, after] = [tilePosition(bridge.paint, join), tilePosition(paint, join)]
    expect(before.x).toBeCloseTo(after.x); expect(before.y).toBeCloseTo(after.y)
  })

  it('accepts route base paint in saved paths and model tools, and rejects it on a non-route surface', () => {
    const source = road([p(1000, 1400), p(6800, 1400)])
    expect(sceneSchema.shape.paths.valueType.parse(source)).toEqual(source)
    expect(sceneSchema.shape.rooms.valueType.shape.floorStyle.safeParse(source.surfaceStyle).success).toBe(false)
    expect(() => visualCommandSchema.parse({ type: 'setVisualSurface', kind: 'room', id: 'room', style: source.surfaceStyle }))
      .toThrow(/沿路线铺装仅适用于道路和桥面/)
    expect(visualCommandSchema.safeParse({ type: 'setVisualSurface', kind: 'path', id: source.id, style: source.surfaceStyle }).success).toBe(true)
    expect(VisualAuthoringOperationSchema.safeParse({ kind: 'visualSurface', surfaceKind: 'path', id: source.id, style: source.surfaceStyle }).success).toBe(true)
    for (const alignment of ['world', 'surface'] as const) {
      source.surfaceStyle = { base: { ...base, alignment }, overlays: [] }
      expect(projectPath(source, null).paving).toBeUndefined()
    }
  })

  it('uses the fixed material default when creating a road and preserves its planar terrain use', () => {
    const now = '2026-11-22T00:00:00.000Z'
    const scene = createVisualBlankDocument({ sceneId: 'route-defaults', title: 'Route defaults', widthMm: 24000, heightMm: 18000, preset: 'narrative', now })
    const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
    const materialRef = { id: 'visual-material-wood', version: 1 }
    scene.materials[materialRef.id].defaultPathPaint = { alignment: 'route', rotationDeg: 90 }
    let id = 0
    const changed = applyCommands(scene, [
      { type: 'createPath', id: 'road', floorId, layerId, widthMm: 1200,
        centerlineMm: [p(1000, 2500), p(6000, 2500), p(9000, 4400)],
        supportRefs: [{ kind: 'floor', id: floorId }], materialRef },
      { type: 'createTerrainArea', id: 'platform', floorId, layerId,
        boundaryMm: [p(13000, 3000), p(17000, 3000), p(17000, 9000), p(13000, 9000)], materialRef },
    ], { clock: { now: () => now }, ids: { nextId: () => `route-default-${++id}` } })
    expect(changed.paths.road.surfaceStyle?.base).toMatchObject({ materialRef, alignment: 'route', rotationDeg: 90 })
    expect(changed.terrainAreas.platform.surfaceStyle?.base).toMatchObject({ materialRef, alignment: 'world', rotationDeg: 0 })
    expect(projectPath(changed.paths.road, null).paving).toHaveLength(2)
  })
})
