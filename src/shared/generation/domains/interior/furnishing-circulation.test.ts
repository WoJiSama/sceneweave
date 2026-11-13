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

describe('explicit bounded reached-node furniture graph', () => {
  const barriers = [box(2000, 0, 1000, 7400), box(5000, 2600, 1000, 7400), box(7500, 0, 1000, 7400)]
  // These solids are wholly inside an existing barrier. They add coordinates
  // without changing the actual free space or the required three-barrier zigzag.
  const crowded = [...barriers, ...Array.from({ length: 32 }, (_, i) => box(2100 + i * 10, 400 + i * 41, 3, 3))]
  const options = (blockers = crowded) => ({
    roomPolygon: room, blockers, ports: [{ openingId: 'door', pointMm: { x: 1000, y: 1000 } }], targetMm: { x: 9000, y: 9000 },
    graphMode: 'bounded-lazy' as const, checkCancelled() {}, chargeNode() {}, chargePair() {}, checkNative: () => true,
  })

  it('finds a complete zigzag above the legacy Cartesian admission limit, deterministically and without input changes', () => {
    const input = options(), before = JSON.stringify(input)
    expect(findFurnitureAccess({ ...input, graphMode: undefined })).toBeUndefined()
    const route = findFurnitureAccess(input)!
    expect(route).toBeDefined()
    expect(route.pointsMm.length).toBeGreaterThan(4)
    expect(polygonInside(route.polygon, room)).toBe(true)
    for (const blocker of crowded) expect(polygonsOverlap(route.polygon, blocker)).toBe(false)
    expect(findFurnitureAccess({ ...input, blockers: [...crowded].reverse() })).toEqual(route)
    const shift = (p: PointMm) => ({ x: p.x + 11000, y: p.y - 7000 })
    const translated = findFurnitureAccess({ ...input, roomPolygon: room.map(shift), blockers: crowded.map(p => p.map(shift)),
      targetMm: shift(input.targetMm), ports: input.ports.map(p => ({ ...p, pointMm: shift(p.pointMm) })) })!
    expect(translated.pointsMm).toEqual(route.pointsMm.map(shift))
    expect(JSON.stringify(input)).toBe(before)
  })

  it('exhausts at most 4096 admitted nodes when native travel rejects every completed route', () => {
    let nodes = 0, pairs = 0, native = 0
    const blockers = Array.from({ length: 20 }, (_, i) => box(2000 + i * 1500, 2000 + i * 1500, 1, 1))
    expect(findFurnitureAccess({ ...options(blockers), roomPolygon: box(0, 0, 50000, 50000), targetMm: { x: 49000, y: 49000 },
      chargeNode() { nodes++ }, chargePair() { pairs++ }, checkNative() { native++; return false } })).toBeUndefined()
    // Three direct candidates plus the whole admitted graph. This fixture must
    // actually reach the ceiling, rather than merely finish below it.
    expect(nodes).toBe(4096 + 3)
    expect(pairs).toBeGreaterThan(blockers.length)
    expect(native).toBeGreaterThan(0)
  })

  it('retains full 600mm clearance, actual room boundaries, doors and native support', () => {
    const gap = (width: number) => [box(4000, 0, 1000, 4500), box(4000, 4500 + width, 1000, 5500 - width)]
    expect(findFurnitureAccess(options(gap(599)))).toBeUndefined()
    const route = findFurnitureAccess(options(gap(600)))!
    expect(route).toBeDefined()
    for (const blocker of gap(600)) expect(polygonsOverlap(route.polygon, blocker)).toBe(false)
    expect(findFurnitureAccess({ ...options([]), ports: [] })).toBeUndefined()
    expect(findFurnitureAccess({ ...options([]), checkNative: () => false })).toBeUndefined()
    const concave = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 4000 }, { x: 4000, y: 4000 }, { x: 4000, y: 10000 }, { x: 0, y: 10000 }]
    expect(findFurnitureAccess({ ...options([]), roomPolygon: concave })).toBeUndefined()
    const rotated = [[{ x: 4500, y: 3500 }, { x: 6500, y: 5500 }, { x: 5500, y: 6500 }, { x: 3500, y: 4500 }]]
    const around = findFurnitureAccess(options(rotated))!
    expect(around).toBeDefined()
    expect(polygonsOverlap(around.polygon, rotated[0])).toBe(false)
  })

  it('rechecks retained routes against changed geometry and the actual current door', () => {
    const retainedRoute = findFurnitureAccess(options())!
    const changed = findFurnitureAccess({ ...options(), retainedRoute, ports: [{ openingId: 'replacement', pointMm: { x: 1000, y: 1000 } }] })!
    expect(changed.openingId).toBe('replacement')
    expect(findFurnitureAccess({ ...options([...crowded, box(8500, 8000, 1500, 2000)]), retainedRoute })).toBeUndefined()
    expect(findFurnitureAccess({ ...options(), retainedRoute, checkNative: () => false })).toBeUndefined()
  })

  it('propagates node, geometry and cancellation limits during sparse graph work', () => {
    let nodes = 0, pairs = 0, checks = 0
    expect(() => findFurnitureAccess({ ...options(), chargeNode() { if (++nodes > 12) throw Error('node budget') } })).toThrow('node budget')
    expect(() => findFurnitureAccess({ ...options(), chargePair() { if (++pairs > 100) throw Error('pair budget') } })).toThrow('pair budget')
    expect(() => findFurnitureAccess({ ...options(), checkCancelled() { if (++checks > 100) throw Error('cancelled') } })).toThrow('cancelled')
    expect(nodes).toBe(13)
  })
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
