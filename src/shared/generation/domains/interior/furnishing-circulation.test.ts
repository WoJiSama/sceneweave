import { describe, expect, it } from 'vitest'
import type { PointMm } from '../../../model/scene.js'
import { polygonInside, polygonsOverlap } from '../../../geometry/geometry.js'
import { findFurnitureAccess, furnitureAccessBand, furnitureApproachPoint } from './furnishing-circulation.js'

const box = (x: number, y: number, width: number, height: number): PointMm[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
const room = box(0, 0, 10000, 10000)
const find = (blockers: PointMm[][], targetMm = { x: 9000, y: 9000 }) => findFurnitureAccess({
  roomPolygon: room, blockers, ports: [{ openingId: 'real-door', pointMm: { x: 1000, y: 1000 } }], targetMm,
  checkCancelled() {}, chargeNode() {}, chargePair() {}, checkNative: () => true,
})

describe('full-width room furniture access', () => {
  it('does not let unrelated furniture in other rooms consume this room coordinate graph', () => {
    const blockers = [box(2000, 0, 1000, 7400), box(5000, 2600, 1000, 7400), box(7500, 0, 1000, 7400)]
    const unrelated = Array.from({ length: 200 }, (_, index) => box(-5000, 50 + index * 40, 500, 17))
    expect(find([...blockers, ...unrelated])).toEqual(find(blockers))
  })

  it('revalidates a retained full route before graph admission, but rejects a stale or changed door witness', () => {
    const original = find([box(2000, 0, 1000, 7400), box(5000, 2600, 1000, 7400), box(7500, 0, 1000, 7400)])!
    // Many thin solids away from this known bottom/top zigzag exhaust the
    // bounded Cartesian graph while the previously checked band stays usable.
    const crowded = Array.from({ length: 200 }, (_, index) => box(6100 + index * 5, 3500 + index * 12, 3, 3))
      .filter(polygon => !polygonsOverlap(polygon, original.polygon))
    expect(crowded.length).toBeGreaterThan(60)
    const blockers = [box(2000, 0, 1000, 7400), box(5000, 2600, 1000, 7400), box(7500, 0, 1000, 7400), ...crowded]
    const options = { roomPolygon: room, blockers, ports: [{ openingId: 'real-door', pointMm: { x: 1000, y: 1000 } }], targetMm: { x: 9000, y: 9000 },
      checkCancelled() {}, chargeNode() {}, chargePair() {}, checkNative: () => true }
    expect(findFurnitureAccess(options)).toBeUndefined()
    const retained = findFurnitureAccess({ ...options, retainedRoute: original })
    expect(retained).toEqual(original)
    expect(findFurnitureAccess({ ...options, retainedRoute: original, ports: [{ openingId: 'changed-door', pointMm: { x: 1000, y: 1000 } }] })).toBeUndefined()
    expect(findFurnitureAccess({ ...options, retainedRoute: original, blockers: [...blockers, box(8500, 8000, 1500, 2000)] })).toBeUndefined()
    expect(findFurnitureAccess({ ...options, retainedRoute: original, checkNative: () => false })).toBeUndefined()
  })

  it('routes around alternating obstacles when straight and both one-turn paths fail', () => {
    const blockers = [box(2000, 0, 1000, 7400), box(5000, 2600, 1000, 7400), box(7500, 0, 1000, 7400)]
    const result = find(blockers)!
    expect(result).toBeDefined()
    expect(result.pointsMm.length).toBeGreaterThan(4)
    expect(result.pointsMm[0]).toEqual({ x: 1000, y: 1000 })
    expect(result.pointsMm.at(-1)).toEqual({ x: 9000, y: 9000 })
    expect(polygonInside(result.polygon, room)).toBe(true)
    for (const blocker of blockers) expect(polygonsOverlap(result.polygon, blocker)).toBe(false)
    expect(find(blockers)).toEqual(result)
    const shifted = blockers.map(polygon => polygon.map(p => ({ x: p.x + 11000, y: p.y - 7000 })))
    const copy = findFurnitureAccess({ roomPolygon: room.map(p => ({ x: p.x + 11000, y: p.y - 7000 })), blockers: shifted,
      ports: [{ openingId: 'renamed-door', pointMm: { x: 12000, y: -6000 } }], targetMm: { x: 20000, y: 2000 },
      checkCancelled() {}, chargeNode() {}, chargePair() {}, checkNative: () => true })!
    expect(copy.pointsMm).toEqual(result.pointsMm.map(p => ({ x: p.x + 11000, y: p.y - 7000 })))
  })

  it('rejects a 599mm gap that a centreline can cross, and admits an actual 600mm gap', () => {
    const barrier = (gap: number) => [box(4000, 0, 1000, 4500), box(4000, 4500 + gap, 1000, 5500 - gap)]
    expect(find(barrier(599))).toBeUndefined()
    const result = find(barrier(600))!
    expect(result).toBeDefined()
    for (const blocker of barrier(600)) expect(polygonsOverlap(result.polygon, blocker)).toBe(false)
  })

  it('checks complete turn bands, concave room boundaries and a rotated blocking polygon', () => {
    const blockers = [[{ x: 1800, y: 700 }, { x: 9300, y: 8200 }, { x: 8700, y: 8800 }, { x: 1200, y: 1300 }]]
    const result = find(blockers)
    if (result) for (const blocker of blockers) expect(polygonsOverlap(result.polygon, blocker)).toBe(false)
    const concave = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 4000 }, { x: 4000, y: 4000 }, { x: 4000, y: 10000 }, { x: 0, y: 10000 }]
    expect(findFurnitureAccess({ roomPolygon: concave, blockers: [], ports: [{ openingId: 'door', pointMm: { x: 1000, y: 1000 } }],
      targetMm: { x: 9000, y: 9000 }, checkCancelled() {}, chargeNode() {}, chargePair() {}, checkNative: () => true })).toBeUndefined()
    const cornerCut = furnitureAccessBand([{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 5000 }])
    expect(polygonsOverlap(cornerCut, box(5200, 700, 200, 500))).toBe(true)
  })

  it('cannot turn missing doors or native support rejection into clear evidence', () => {
    const options = { roomPolygon: room, blockers: [], ports: [], targetMm: { x: 9000, y: 9000 },
      checkCancelled() {}, chargeNode() {}, chargePair() {}, checkNative: () => true }
    expect(findFurnitureAccess(options)).toBeUndefined()
    let native = 0
    expect(findFurnitureAccess({ ...options, ports: [{ openingId: 'door', pointMm: { x: 1000, y: 1000 } }], checkNative() { native++; return false } })).toBeUndefined()
    expect(native).toBeGreaterThan(0)
  })

  it('charges and cancels during actual graph work without mutating its input', () => {
    const blockers = [box(2000, 0, 1000, 7400), box(5000, 2600, 1000, 7400)], before = JSON.stringify(blockers)
    let nodes = 0, pairs = 0
    const options = { roomPolygon: room, blockers, ports: [{ openingId: 'door', pointMm: { x: 1000, y: 1000 } }], targetMm: { x: 9000, y: 9000 },
      checkCancelled() {}, chargeNode() { nodes++; if (nodes > 12) throw new Error('node budget') }, chargePair() { pairs++ }, checkNative: () => true }
    expect(() => findFurnitureAccess(options)).toThrow('node budget')
    expect(pairs).toBeGreaterThan(0)
    let checks = 0
    expect(() => findFurnitureAccess({ ...options, chargeNode() {}, checkCancelled() { if (++checks > 20) throw new Error('cancelled') } })).toThrow('cancelled')
    expect(JSON.stringify(blockers)).toBe(before)
  })

  it('derives approach points from offset real envelopes and retained local rotation', () => {
    const shape = { visualBoundsMm: { x: -600, y: -400, width: 1500, height: 1000 }, footprintOffsetMm: { x: 0, y: 0 }, footprintMm: { width: 800, height: 800 } }
    expect(furnitureApproachPoint(shape, { positionMm: { x: 2000, y: 3000 }, rotationDeg: 90 }, false)).toEqual({ x: 1100, y: 3150 })
    expect(furnitureApproachPoint(shape, { positionMm: { x: 2000, y: 3000 }, rotationDeg: 90 }, true)).toEqual({ x: 2700, y: 3150 })
  })
})
