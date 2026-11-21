import { describe, expect, it } from 'vitest'
import { TERRAIN_FACADES } from '../appearance/terrain-facade.js'
import { emptyVisualSystem } from '../visual/types.js'
import { pointInPolygon } from '../geometry/geometry.js'
import type { BoundsMm, PointMm } from '../model/scene.js'
import { planFloorShadows } from './floor-shadows.js'
import type { ProjectedFloorShadow, ProjectedSurface, Projection } from './types.js'

const p = (x: number, y: number) => ({ x, y })
const rect = (left: number, top: number, right: number, bottom: number) => [p(left, top), p(right, top), p(right, bottom), p(left, bottom)]
const world = { x: 0, y: 0, width: 80000, height: 55000 }
function floor(bounds: BoundsMm = world): Projection {
  return { audience: 'gm', sourceRevision: 1, bounds, gridSizeMm: null,
    rooms: [], terrain: [], walls: [], props: [], edges: [], paths: [], connections: [], notes: [], regions: [], masks: [],
    theme: null, materials: {}, assetIds: [], limitations: [], diagnostics: [] }
}
function terrain(id: string, points: PointMm[], elevationMm: number): ProjectedSurface {
  return { id, points, style: null, elevationMm, priority: 1 }
}
function caster(): Projection {
  const source = floor(), outline = rect(6000, 9000, 10000, 11000)
  source.paths.push({ id: 'bridge', points: outline, style: null, edgeStyle: { strokeWidthMm: 0, color: '#304659', bandWidthMm: 0 },
    bridge: { outline, finish: 'steel', centerlineMm: [p(6000, 10000), p(10000, 10000)], widthMm: 2000,
      relief: { depthMm: 1100, shadowOpacity: .55, elevationMm: 5000, ribSpacingMm: 4000 } } })
  return source
}
const receives = (shadow: ProjectedFloorShadow, point: PointMm) => shadow.receiver.some(({ outerMm, holesMm }) =>
  pointInPolygon(point, outerMm, false) && !holesMm.some(hole => pointInPolygon(point, hole)))

describe('shadows on aligned lower floors', () => {
  it('casts a façade shadow onto a lower carrier, skips a masked caster and leaves the artwork without a shadow', () => {
    const source = floor(), lower = floor()
    const facade = { ...terrain('factory', rect(6000, 9000, 10000, 11000), 5000), facade: { ...TERRAIN_FACADES['glazed-v1'] } }
    source.terrain = [facade]
    source.visual = { environment: { ...emptyVisualSystem().environment, contactShadowOpacity: .5 }, boundsMm: world,
      boundaries: [], edgeLooks: [], lights: [], fogs: [], filters: [], occluderRings: [], contactRings: [], suppressedTerrainEdgeIds: [] }
    expect(planFloorShadows(source, [lower])).toEqual([])
    lower.terrain = [terrain('street', rect(4000, 4000, 16000, 14000), 1000)]
    const [shadow] = planFloorShadows(source, [lower])
    expect(shadow.opacity).toBeCloseTo(.44)
    expect(shadow.caster[0].outerMm).toEqual(facade.points)
    source.audience = lower.audience = 'player'
    source.masks = [rect(6100, 9100, 6200, 9200)]
    expect(planFloorShadows(source, [lower])).toEqual([])
  })
  it('uses actual lower heights, drops in the scene shadow direction and preserves receiver holes', () => {
    const source = caster(), lower = floor()
    lower.terrain = [terrain('base', rect(5000, 5500, 14000, 11800), 1000), terrain('ledge', rect(8800, 6000, 14000, 10500), 3000),
      terrain('same-height', rect(9000, 7500, 11500, 8500), 5000)]
    const shadows = planFloorShadows(source, [lower])
    expect(shadows).toHaveLength(2)
    expect(shadows.every(shadow => shadow.offsetMm.x > 0 && shadow.offsetMm.y < 0 && shadow.opacity === .55)).toBe(true)
    const low = shadows.find(shadow => Math.hypot(shadow.offsetMm.x, shadow.offsetMm.y) > 1600)!
    const ledge = shadows.find(shadow => shadow !== low)!
    expect(Math.hypot(low.offsetMm.x, low.offsetMm.y)).toBeCloseTo(2400)
    expect(Math.hypot(ledge.offsetMm.x, ledge.offsetMm.y)).toBeCloseTo(1200)
    expect(receives(low, p(8200, 9100))).toBe(true)
    expect(receives(low, p(9700, 9000))).toBe(false)
    expect(receives(ledge, p(9700, 9000))).toBe(true)
    expect(shadows.some(shadow => receives(shadow, p(9700, 8000)))).toBe(false)
  })

  it('clips to aligned visible output, including a caster beyond the editor view', () => {
    const source = caster(), lower = floor({ x: 10300, y: 5700, width: 900, height: 4000 })
    lower.terrain = [terrain('base', rect(4000, 2000, 19500, 14500), 0)]
    const view = { x: 10200, y: 7300, width: 3000, height: 900 }
    const [shadow] = planFloorShadows(source, [lower], view)
    expect(shadow.caster[0].outerMm).toEqual(source.paths[0].bridge!.outline)
    expect(receives(shadow, p(11000, 7700))).toBe(true)
    expect(receives(shadow, p(11500, 7700))).toBe(false)
    expect(receives(shadow, p(11000, 8600))).toBe(false)
    expect(planFloorShadows(source, [], view)).toEqual([])
    expect(planFloorShadows(source, [floor()], view)).toEqual([])
    source.paths[0].bridge!.relief!.shadowOpacity = 0
    expect(planFloorShadows(source, [lower], view)).toEqual([])
  })

  it('respects the player mask and its public room hole, even above another aligned canvas', () => {
    const source = caster(), base = floor(), above = floor()
    source.audience = base.audience = above.audience = 'player'
    base.terrain = [terrain('road', rect(7000, 6000, 14000, 11000), 0)]
    const room = rect(9450, 7500, 10100, 9500)
    above.rooms = [terrain('room', room, 1200)]
    above.masks = [rect(9000, 7100, 10700, 10000)]
    above.maskPublicRooms = [[room]]
    const shadows = planFloorShadows(source, [base, above])
    expect(shadows).toHaveLength(2)
    expect(shadows.filter(shadow => receives(shadow, p(9600, 8700)))).toHaveLength(1)
    expect(shadows.some(shadow => receives(shadow, p(9200, 8700)))).toBe(false)
    expect(shadows.some(shadow => receives(shadow, p(11000, 8700)))).toBe(true)
  })

  it('keeps distant geometry outside the shadow work and skips a hidden receiver', () => {
    const source = caster(), lower = floor(), road = terrain('road', rect(7700, 7000, 14000, 11000), 0)
    const distant = Array.from({ length: 257 }, (_, i) => terrain('far-' + i, rect(55000 + i * 30, 25000, 55028 + i * 30, 25500), 1000))
    const expected = planFloorShadows(source, [{ ...lower, terrain: [road] }])
    expect(expected).toHaveLength(1)
    expect(planFloorShadows(source, [{ ...lower, terrain: [...distant, road] }])).toEqual(expected)
    expect(planFloorShadows(source, [{ ...lower, terrain: distant }])).toEqual([])
  })
})
