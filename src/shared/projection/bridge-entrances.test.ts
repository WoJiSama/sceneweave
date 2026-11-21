import { describe, expect, it } from 'vitest'
import { pointInPolygon } from '../geometry/geometry.js'
import type { Path, PointMm } from '../model/scene.js'
import { DEFAULT_BRIDGE_STRUCTURE } from '../path-assembly/contracts.js'
import { bridgeWalkCap, planBridgeEntrances, replacePathCaps } from './bridge-entrances.js'
import { projectPath } from './paths.js'
import type { ProjectedSurface } from './types.js'

const p = (x: number, y: number) => ({ x, y })
const surface = (id: string, x: number, right: number, elevationMm = 1000): ProjectedSurface => ({ id,
  points: [p(x, -5000), p(right, -5000), p(right, 5000), p(x, 5000)], style: null, priority: 1, elevationMm,
})
const ref = (id: string) => ({ kind: 'terrainArea' as const, id })
const path = (id: string, widthMm: number, centerlineMm: PointMm[], supportRefs: Path['supportRefs']): Path => ({ id, floorId: 'floor', editLocked: false,
  visibility: 'public', centerlineMm, widthMm, supportRefs, renderOrder: 0, movementCostMultiplier: 1, surfaceStyle: null,
})
function fixture(bent = false) {
  const bridge = path('bridge', 2200, bent ? [p(5000, 0), p(8500, 0), p(12000, 1400), p(15500, 1400)] : [p(5000, 0), p(15500, 0)], [ref('deck')])
  bridge.assembly = { version: 1, routeFingerprint: '', members: {},
    bridge: { deckId: 'deck', elevationMm: 1000, finish: 'steel', visibility: 'public' },
    recipe: { sides: 'both', shoulderMm: 720, endClearanceMm: 200, section: { kind: 'steel', lengthMm: 2400 }, structure: DEFAULT_BRIDGE_STRUCTURE },
  }
  const west = path('in-west', 2900, [p(-800, -1700), p(4000, -170)], [ref('west'), ref('deck')])
  const east = path('in-east', 1800, [p(16500, bent ? 1420 : 20), p(21500, bent ? 2350 : 950)], [ref('east'), ref('deck')])
  const rows = [west, east, bridge].map(source => ({ source, projected: projectPath(source, null), elevationMm: 1000 }))
  const deck = { ...surface('deck', 0, 1), points: rows[2].projected.bridge!.outline, bridgeSupport: true as const }
  return { rows, terrain: [surface('west', -3000, 4400), surface('east', 16100, 23500), deck] }
}

describe('projected bridge entrances', () => {
  it.each([false, true])('connects two supported approaches with width transitions (bent %s)', bent => {
    const { rows, terrain } = fixture(bent)
    const before = JSON.stringify([rows, terrain]), joins = planBridgeEntrances(rows, terrain, [])
    expect(joins.map(join => [join.end, join.platform?.id, join.approach?.pathId])).toEqual([['start', 'west', 'in-west'], ['end', 'east', 'in-east']])
    expect(joins[0].platform?.contactMm.x).toBeCloseTo(4400)
    expect(joins[1].platform?.contactMm.x).toBeCloseTo(16100)
    for (const join of joins) {
      const approach = join.approach!, path = rows.find(row => row.source.id === approach.pathId)!.projected
      expect(join.platform?.shoulderCut.length).toBe(1)
      const [right, left] = approach.sides
      expect(Math.hypot(right[0].x - left[0].x, right[0].y - left[0].y)).toBeCloseTo(2200)
      expect(Math.hypot(right.at(-1)!.x - left.at(-1)!.x, right.at(-1)!.y - left.at(-1)!.y)).toBeCloseTo(rows.find(row => row.source.id === path.id)!.source.widthMm)
      expect(pointInPolygon(approach.from, replacePathCaps(path.points, [approach]))).toBe(true)
      expect(bridgeWalkCap(rows[2].projected.bridge!, join.end).every(p => pointInPolygon(p, rows[2].projected.points))).toBe(true)
    }
    expect(JSON.stringify([rows, terrain])).toBe(before)
  })

  it('leaves other heights, unavailable roads and unbound crossings independent', () => {
    const { rows: [west, east, bridge], terrain } = fixture(true)
    const distant = { ...west, source: { ...west.source, supportRefs: [ref('elsewhere')] } }
    const high = { ...east, elevationMm: 2500 }
    const joins = planBridgeEntrances([bridge, distant, high], terrain.map(area => area.id === 'east' ? { ...area, elevationMm: 2500 } : area), [])
    expect(joins.map(join => [join.end, join.platform?.id, join.approach])).toEqual([['start', 'west', undefined]])
    expect(planBridgeEntrances([bridge], [], [])).toEqual([])
  })
})
