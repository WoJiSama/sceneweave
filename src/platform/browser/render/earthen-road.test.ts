import { describe, expect, it } from 'vitest'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedPath } from '../../../shared/projection/types.js'
import { defaultStaircase } from '../../../shared/stairs/contracts.js'
import { planStaircase } from '../../../shared/stairs/geometry.js'
import { planEarthenRoad } from './earthen-road.js'
import { planSpatialEarthenRoads } from './oblique-surfaces.js'

const route = [{ x: 0, y: 0 }, { x: 2600, y: 0 }, { x: 4400, y: 1000 }]
const terrain = (p: PointMm) => .32 * p.x + .55 * p.y
const config = { ...defaultStaircase(), layout: { kind: 'stretch' as const, stepCount: 8 } }

describe('earthen road mesh', () => {
  it('joins both banks and the landings at their actual heights without enclosing every tread with walls', () => {
    const stairs = planStaircase(route, 1400, config)
    const { treads, risers } = planEarthenRoad(stairs, terrain)
    for (const tread of treads) {
      for (const wall of tread.at((tread.start + tread.end) / 2).filter((_, i, lanes) => i === 0 || i === lanes.length - 1)) expect(wall.z).toBe(terrain(wall))
      if (tread.start >= 480 && tread.end <= stairs.lengthMm - 480) {
        const middle = tread.at((tread.start + tread.end) / 2)
        expect(middle[2].z).toBeCloseTo(tread.z)
        expect(middle[4].z).toBeCloseTo(tread.z)
      }
    }
    for (const point of [...treads[0].at(0), ...treads.at(-1)!.at(stairs.lengthMm)]) expect(point.z).toBe(terrain(point))
    for (const { before, after } of risers) {
      expect(before.map(({ x, y }) => [x, y])).toEqual(after.map(({ x, y }) => [x, y]))
      expect(before[0].z).toBe(after[0].z)
      expect(before.at(-1)!.z).toBe(after.at(-1)!.z)
      expect(before[3].z).toBeLessThan(after[3].z)
    }
  })

  it('changes each riser direction when the author draws downhill, and leaves flat treads without a face', () => {
    const stairs = planStaircase([...route].reverse(), 1400, config)
    expect(planEarthenRoad(stairs, terrain).risers.every(row => row.rise < 0)).toBe(true)
    expect(planEarthenRoad(stairs, () => 720).risers.every(row => row.rise === 0)).toBe(true)
  })

  it('keeps privacy coverage out of the spatial earth cuts and avoids overlapping replacements', () => {
    const stairs = { centerlineMm: route, widthMm: 1400, config: { ...config, preset: 'carved-rock' as const, material: 'earth' as const } }
    const path: ProjectedPath = { id: 'road', points: [], style: null, edgeStyle: { color: '#999999', strokeWidthMm: 0, bandWidthMm: 0 }, groundBlendMm: 90, stairs }
    const projection = { bounds: { x: -1500, y: -1500, width: 7500, height: 5500 }, paths: [path, { ...path, id: 'crossing' }], connections: [], masks: [] }
    expect([...planSpatialEarthenRoads(projection).keys()]).toEqual(['road'])
    const masks = [[{ x: 1200, y: -900 }, { x: 1700, y: -900 }, { x: 1700, y: 400 }, { x: 1200, y: 400 }]]
    expect(planSpatialEarthenRoads({ ...projection, masks }).size).toBe(0)
  })
})
