import { describe, expect, it } from 'vitest'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedSurface, ProjectedVisualBoundary } from '../../../shared/projection/types.js'
import { cliffHighGround } from './cliff-high-ground.js'

const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const area = (id: string, elevationMm: number, priority: number, points: PointMm[]): ProjectedSurface => ({ id, elevationMm, priority, points, style: null })
const bounds = { x: -5000, y: -5000, width: 30000, height: 30000 }
const boundary = (points: PointMm[], terrainAreaIds: string[]): Pick<ProjectedVisualBoundary, 'points' | 'closed' | 'terrainAreaIds'> => ({ points, terrainAreaIds, closed: true })
const excludes = (result: ReturnType<typeof cliffHighGround>, x: number, y: number) => result.excludedRings.reduce((inside, ring) => pointInPolygon({ x, y }, ring, false) ? !inside : inside, false)

describe('cliff clipping from visible coverage and real elevation', () => {
  it('keeps an outer plateau face below its high surface and finds its actual exposed Floor drop', () => {
    const plateau = area('plateau', 1800, 1, rect(0, 0, 10000, 10000)), source = { bounds, terrain: [plateau] }
    const before = structuredClone(source), result = cliffHighGround(source, boundary(plateau.points, ['plateau']))
    expect(result.dropMm).toBe(1800)
    expect(excludes(result, 1000, 1000)).toBe(true)
    expect(excludes(result, -1000, 1000)).toBe(false)
    expect(source).toEqual(before)
  })

  it.each([-400, 800])('opens an inward crater at %i without treating a singly bound low area as high', elevation => {
    const mountain = area('mountain', 1800, 1, rect(0, 0, 12000, 12000))
    const crater = area('crater', elevation, 2, rect(3000, 3000, 6000, 6000))
    const result = cliffHighGround({ bounds, terrain: [mountain, crater] }, boundary(crater.points, ['crater']))
    expect(result.dropMm).toBe(1800 - elevation)
    expect(excludes(result, 2000, 5000)).toBe(true)
    expect(excludes(result, 3500, 5000)).toBe(false)
    expect(excludes(result, 6000, 6000)).toBe(false)
  })

  it('uses coverage priority rather than input elevation or id ordering and preserves visible holes', () => {
    const mountain = area('mountain', 1800, 1, rect(0, 0, 12000, 12000)), crater = area('crater', 800, 2, rect(3000, 3000, 6000, 6000))
    const overlay = area('low-cover', 100, 3, rect(1000, 4000, 3000, 2000))
    const source = { bounds, terrain: [overlay, crater, mountain] }, result = cliffHighGround(source, boundary(crater.points, ['mountain', 'crater']))
    expect(excludes(result, 2000, 2000)).toBe(true)
    expect(excludes(result, 2000, 5000)).toBe(true)
    expect(excludes(result, 6000, 6000)).toBe(false)
  })

  it('does not consult missing hidden terrain or retain hidden geometry/identifiers', () => {
    const crater = area('public-crater', 800, 2, rect(3000, 3000, 6000, 6000))
    const publicOnly = cliffHighGround({ bounds, terrain: [crater] }, boundary(crater.points, ['public-crater', 'secret-mountain']))
    expect(publicOnly.dropMm).toBe(800)
    expect(excludes(publicOnly, 4000, 4000)).toBe(true)
    expect(JSON.stringify(publicOnly)).not.toMatch(/secret|mountain|terrainAreaIds/)
    const renamed = { ...crater, id: 'different-id' }
    expect(cliffHighGround({ bounds, terrain: [renamed] }, boundary(crater.points, [renamed.id]))).toEqual(publicOnly)
  })


  it('clips exposed Floor ground outside a negative pit while leaving its low interior visible', () => {
    const pit = area('pit', -900, 2, rect(3000, 3000, 6000, 6000))
    const result = cliffHighGround({ bounds, terrain: [pit] }, boundary(pit.points, ['pit']))
    expect(result.dropMm).toBe(900)
    expect(excludes(result, 2000, 5000)).toBe(true)
    expect(excludes(result, 3500, 5000)).toBe(false)
  })

  it('retains a narrow later cover as an occluder and hides a fully covered bound edge', () => {
    const plateau = area('plateau', 1800, 1, rect(0, 0, 10000, 10000))
    const narrow = area('narrow', 100, 2, rect(1234, -2000, 30, 4000))
    const partial = cliffHighGround({ bounds, terrain: [plateau, narrow] }, boundary(plateau.points, ['plateau']))
    expect(excludes(partial, 1240, -300)).toBe(true)
    const cover = area('cover', 100, 2, rect(-1000, -1000, 12000, 12000))
    const hidden = cliffHighGround({ bounds, terrain: [plateau, cover] }, boundary(plateau.points, ['plateau']))
    expect(excludes(hidden, -500, 5000)).toBe(true)
    expect(excludes(hidden, 500, 5000)).toBe(true)
    expect(hidden.dropMm).toBeUndefined()
  })

  it('does not erase the low side when one terrain is high along another stretch', () => {
    const mountain = area('mountain', 1800, 0, rect(-5000, -5000, 7000, 20000))
    const terrace = area('terrace', 800, 1, rect(0, 0, 10000, 10000))
    const result = cliffHighGround({ bounds, terrain: [mountain, terrace] }, boundary(terrace.points, ['terrace']), 1000)
    expect(excludes(result, -500, 5000)).toBe(true)
    expect(excludes(result, 500, 5000)).toBe(false)
    expect(excludes(result, 9500, 5000)).toBe(true)
    expect(excludes(result, 10500, 5000)).toBe(false)
  })

  it('does not mistake an exposed lower-priority base beneath an offset decorative curve for a later cover', () => {
    const base = area('base', 0, 0, rect(-5000, -5000, 20000, 20000))
    const plateau = area('plateau', 1800, 1, rect(0, 0, 10000, 10000))
    const curve = boundary([{ x: -10, y: 1000 }, { x: -10, y: 9000 }], ['plateau']); curve.closed = false
    expect(cliffHighGround({ bounds, terrain: [base, plateau] }, curve)).toEqual({ excludedRings: [] })
  })

  it('keeps equal-height decorative boundaries unclassified rather than inventing a drop', () => {
    const flat = area('flat', 0, 1, rect(0, 0, 10000, 10000))
    expect(cliffHighGround({ bounds, terrain: [flat] }, boundary(flat.points, ['flat']))).toEqual({ excludedRings: [] })
    expect(cliffHighGround({ bounds, terrain: [flat] }, boundary(flat.points, []))).toEqual({ excludedRings: [] })
  })
})
