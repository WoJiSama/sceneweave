import { describe, expect, it } from 'vitest'
import { polygonDistance } from '../../../geometry/geometry.js'
import type { PropDefinition } from '../../../model/scene.js'
import { diningGroupCandidates, isDiningPurpose, isSeatedGroupPurpose, preferDiningOrientation, singleSidedSeatRotation } from './furnishing-composition.js'
import { kitchenOpposingCandidates } from './furnishing-groups.js'
import { furnitureBoundsPolygon, furniturePoseCandidates, type FurnitureAnchor, type FurnishingPose, type FurnishingShape } from './furnishing-poses.js'
import { furnitureWorkingSpacePolygon, furnitureUseSpacePolygon, planFurnitureSeats } from './furnishing-use-space.js'

const shape: FurnishingShape = { visualBoundsMm: { x: -1300, y: -450, width: 2600, height: 1000 },
  footprintMm: { width: 2800, height: 1100 }, footprintOffsetMm: { x: 200, y: 100 } }
const seat = { defaultVisualBoundsMm: { x: -400, y: -400, width: 800, height: 900 },
  defaultFootprintMm: { width: 700, height: 900 }, defaultFootprintOffsetMm: { x: 100, y: 200 } } as PropDefinition
const bounds = { x: 0, y: 0, width: 30000, height: 30000 }
const anchor: FurnitureAnchor = { ...shape, role: 'table', positionMm: { x: 15000, y: 15000 }, rotationDeg: 0 }
const options = { bounds, inset: 100, shape, seats: [seat], anchors: [anchor], tableCount: 4, rank: (key: string) => key,
  checkCancelled() {}, charge() {} }
const body = (value: FurnishingShape, pose: FurnishingPose) => [value.visualBoundsMm,
  { x: value.footprintOffsetMm.x - value.footprintMm.width / 2, y: value.footprintOffsetMm.y - value.footprintMm.height / 2, ...value.footprintMm }]
  .flatMap(box => furnitureBoundsPolygon(box, pose))

describe('finite dining composition and opposing kitchen rows', () => {
  it.each([0, 90, 180, 270])('keeps complete single-sided work seats inside the proposed group at %s degrees', rotationDeg => {
    const poses = diningGroupCandidates({ ...options, anchors: [], tableCount: 1, retainedRotation: rotationDeg,
      singleSided: true, alignToBounds: true })
    expect(poses.length).toBeGreaterThan(1)
    const before = JSON.stringify(options)
    for (const pose of poses) {
      const anchor: FurnitureAnchor = { ...shape, ...pose, role: 'work' }
      const seatRotationDeg = singleSidedSeatRotation(shape, pose)
      expect(seatRotationDeg).toBe([180, 90, 0, 270][rotationDeg / 90])
      const planned = planFurnitureSeats({ anchorKey: 'work', anchor, seats: [{ ...seat, id: 'seat', version: 1 }], count: 1,
        bounds, inset: 100, roomPolygon: [{ x: 0, y: 0 }, { x: 30000, y: 0 }, { x: 30000, y: 30000 }, { x: 0, y: 30000 }],
        blockers: [], routeBands: [], rank: key => key, seatRotationDeg,
        checkCancelled() {}, chargeCandidate() {}, chargePair() {} })
      expect(planned).toHaveLength(1)
      expect(planned[0].rotationDeg).toBe(seatRotationDeg)
      const fullSeat = furnitureUseSpacePolygon({ visualBoundsMm: seat.defaultVisualBoundsMm,
        footprintMm: seat.defaultFootprintMm, footprintOffsetMm: seat.defaultFootprintOffsetMm }, planned[0])
      expect(fullSeat.every(p => p.x >= 100 && p.x <= 29900 && p.y >= 100 && p.y <= 29900)).toBe(true)
    }
    expect(JSON.stringify(options)).toBe(before)
    expect(singleSidedSeatRotation(shape, { positionMm: { x: 0, y: 0 }, rotationDeg: 37 })).toBeUndefined()
  })

  it('does not invent a side for square work surfaces or expand unrelated purposes', () => {
    const square = { visualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 },
      footprintMm: { width: 1000, height: 1000 }, footprintOffsetMm: { x: 0, y: 0 } }
    expect(singleSidedSeatRotation(square, { positionMm: { x: 0, y: 0 }, rotationDeg: 0 })).toBeUndefined()
    for (const purpose of ['研究办公室', '接待会客室', 'Consultation office', 'Reception lounge']) expect(isSeatedGroupPurpose(purpose)).toBe(true)
    for (const purpose of ['厨房', '卧室', '储藏室', '餐厅']) expect(isSeatedGroupPurpose(purpose)).toBe(false)
  })

  it.each([0, 90, 180, 270])('fits a full bench to real long edges at %s degrees and preserves legacy short-edge fallbacks', rotationDeg => {
    const table: FurnitureAnchor = { role: 'table', visualBoundsMm: { x: -1350, y: -650, width: 2700, height: 1300 },
      footprintMm: { width: 2500, height: 1100 }, footprintOffsetMm: { x: 50, y: 10 }, positionMm: { x: 15000, y: 15000 }, rotationDeg }
    const bench: FurnishingShape = { visualBoundsMm: { x: -1100, y: -350, width: 2300, height: 700 },
      footprintMm: { width: 2100, height: 500 }, footprintOffsetMm: { x: 100, y: 0 } }
    const old = furniturePoseCandidates(bounds, bench, 100, 'seat', [table], key => key)
    const next = furniturePoseCandidates(bounds, bench, 100, 'seat', [table], key => key, undefined, true, true)
    expect(old.some(p => (p.rotationDeg - rotationDeg + 360) % 180 === 90)).toBe(true)
    expect(next.length).toBeGreaterThan(0)
    expect(next.every(p => (p.rotationDeg - rotationDeg + 360) % 180 === 0)).toBe(true)
    const horizontal = rotationDeg % 180 === 0, coordinate = horizontal ? 'x' : 'y'
    const tablePoints = body(table, table), low = Math.min(...tablePoints.map(p => p[coordinate])), high = Math.max(...tablePoints.map(p => p[coordinate]))
    for (const pose of next) for (const point of body(bench, pose)) {
      expect(point[coordinate]).toBeGreaterThanOrEqual(low)
      expect(point[coordinate]).toBeLessThanOrEqual(high)
    }
    expect(furniturePoseCandidates(bounds, bench, 100, 'seat', [table], key => key, undefined, true, false)).toEqual(old)
    expect(furniturePoseCandidates(bounds, bench, 100, 'seat', [{ ...table, rotationDeg: 37 }], key => key, undefined, true, true))
      .toEqual(furniturePoseCandidates(bounds, bench, 100, 'seat', [{ ...table, rotationDeg: 37 }], key => key))
  })

  it('keeps whole bank envelopes within real bounds while trying centre and both spare-margin edges', () => {
    const value = { ...options, anchors: [], tableCount: 2, alignToBounds: true }
    const before = JSON.stringify(value), next = diningGroupCandidates(value), old = diningGroupCandidates({ ...value, alignToBounds: false })
    expect(next.length).toBeGreaterThan(old.length)
    expect(next.length).toBeLessThanOrEqual(96)
    for (const pose of old) expect(next).toContainEqual(pose)
    for (const pose of next) {
      const group = furnitureBoundsPolygon({ x: -1300, y: -2280, width: 2900, height: 4760 }, pose)
      expect(group.every(p => p.x >= 100 && p.x <= 29900 && p.y >= 100 && p.y <= 29900)).toBe(true)
    }
    expect(JSON.stringify(value)).toBe(before)
  })
  it('ranks the actual long axis across all group and independent fallback poses, keeping every fallback', () => {
    const vertical: FurnishingShape = { visualBoundsMm: { x: -500, y: -1400, width: 1000, height: 2800 },
      footprintMm: { width: 900, height: 2600 }, footprintOffsetMm: { x: 0, y: 0 } }
    const poses = [0, 90, 270, 180].map(rotationDeg => ({ positionMm: { x: 4000, y: 5000 }, rotationDeg }))
    const input = { poses, shape: vertical, anchors: [anchor], checkCancelled() {}, charge() {} }, before = JSON.stringify(input)
    const ordered = preferDiningOrientation(input)
    expect(ordered.map(p => p.rotationDeg)).toEqual([90, 270, 0, 180])
    expect(new Set(ordered)).toEqual(new Set(poses))
    expect(JSON.stringify(input)).toBe(before)
    const other = { ...anchor, positionMm: { x: 15000, y: 16000 }, rotationDeg: 90 }
    expect(preferDiningOrientation({ ...input, anchors: [other, anchor] })).toEqual(ordered)
    expect(preferDiningOrientation({ ...input, anchors: [anchor, other] })).toEqual(ordered)
  })

  it('does not guess an axis from square tables or non-cardinal manual anchors, and preserves arbitrary retained poses', () => {
    const square: FurnishingShape = { visualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 },
      footprintMm: { width: 1000, height: 1000 }, footprintOffsetMm: { x: 0, y: 0 } }
    const poses = [90, 0, 37].map(rotationDeg => ({ positionMm: { x: 4000, y: 5000 }, rotationDeg }))
    const input = { poses, shape, anchors: [anchor], checkCancelled() {}, charge() {} }
    expect(preferDiningOrientation({ ...input, anchors: [{ ...anchor, ...square }] })).toEqual(poses)
    expect(preferDiningOrientation({ ...input, anchors: [{ ...anchor, rotationDeg: 37 }] })).toEqual(poses)
    expect(preferDiningOrientation({ ...input, shape: square })).toEqual(poses)
    expect(preferDiningOrientation({ ...input, poses: [poses[2]] })).toEqual([poses[2]])
    let checks = 0, charges = 0
    expect(() => preferDiningOrientation({ ...input, charge() { charges++ }, checkCancelled() { if (++checks === 3) throw Error('cancelled') } })).toThrow('cancelled')
    expect(charges).toBeGreaterThan(0)
  })

  it('aligns whole table groups using off-centre physical and painted bounds, chair depth and rear use space', () => {
    const before = JSON.stringify(options), poses = diningGroupCandidates(options)
    // Body union: x[-1300,1600], y[-450,650]. Seat union depth is 1050mm.
    // Each long edge needs 180mm table gap + 1050mm chair + 600mm rear space.
    const group = (pose: FurnishingPose) => furnitureBoundsPolygon({ x: -1300, y: -2280, width: 2900, height: 4760 }, pose)
    expect(poses.length).toBeGreaterThan(4)
    for (const pose of poses.slice(0, 4)) {
      expect(pose.rotationDeg).toBe(0)
      expect(pose.positionMm.x === anchor.positionMm.x || pose.positionMm.y === anchor.positionMm.y).toBe(true)
      expect(polygonDistance(group(anchor), group(pose))).toBe(800)
    }
    for (const pose of poses) for (const point of body(shape, pose)) {
      expect(point.x).toBeGreaterThanOrEqual(100); expect(point.x).toBeLessThanOrEqual(29900)
      expect(point.y).toBeGreaterThanOrEqual(100); expect(point.y).toBeLessThanOrEqual(29900)
    }
    expect(JSON.stringify(options)).toBe(before)
  })

  it('is deterministic across anchor order and keeps retained angles and missing seats explicit', () => {
    const anchors = [anchor, { ...anchor, positionMm: { x: 6000, y: 8000 }, rotationDeg: 90 }]
    expect(diningGroupCandidates({ ...options, anchors })).toEqual(diningGroupCandidates({ ...options, anchors: [...anchors].reverse() }))
    expect(diningGroupCandidates({ ...options, retainedRotation: 90 }).every(p => p.rotationDeg === 90)).toBe(true)
    expect(diningGroupCandidates({ ...options, retainedRotation: 37 })).toEqual([])
    expect(diningGroupCandidates({ ...options, seats: [] })).toEqual([])
    expect(diningGroupCandidates({ ...options, anchors: [{ ...anchor, rotationDeg: 37 }] }))
      .toEqual(diningGroupCandidates({ ...options, anchors: [] }))
    expect(['旅店餐厅', 'Dining hall', 'tavern', '食堂'].every(isDiningPurpose)).toBe(true)
    expect(isDiningPurpose('客房')).toBe(false)
  })

  it('bounds recommendations and charges work before cancellation', () => {
    let charges = 0
    const poses = diningGroupCandidates({ ...options, tableCount: 100000, anchors: Array.from({ length: 100 }, (_, i) => ({
      ...anchor, positionMm: { x: 5000 + i * 100, y: 5000 + i * 100 },
    })), charge() { charges++ } })
    expect(poses.length).toBeLessThanOrEqual(96)
    expect(charges).toBeGreaterThan(32); expect(charges).toBeLessThan(1000)
    let checks = 0
    expect(() => diningGroupCandidates({ ...options, checkCancelled() { if (++checks === 5) throw Error('cancelled') } }))
      .toThrow('cancelled')
  })

  it.each([0, 90, 180, 270])('keeps both complete operating strips between fixed opposite bodies at %s degrees', rotationDeg => {
    const station = { ...shape, role: 'work' as const, positionMm: { x: 15000, y: 15000 }, rotationDeg }
    const opposite: FurnishingShape = { visualBoundsMm: { x: -850, y: -600, width: 1900, height: 1400 },
      footprintMm: { width: 2100, height: 1500 }, footprintOffsetMm: { x: 100, y: 50 } }
    const before = JSON.stringify(station)
    const poses = kitchenOpposingCandidates(bounds, opposite, 100, 'storage', [station], key => key)
    expect(poses).toHaveLength(3)
    for (const pose of poses) {
      expect(pose.rotationDeg).toBe((rotationDeg + 180) % 360)
      // Compare the full axis-aligned envelopes, not just physical roots.
      const envelope = (points: { x: number; y: number }[]) => furnitureBoundsPolygon({
        x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
        width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)),
        height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)),
      }, { positionMm: { x: 0, y: 0 }, rotationDeg: 0 })
      expect(polygonDistance(envelope(body(station, station)), envelope(body(opposite, pose)))).toBe(1600)
      expect(polygonDistance(furnitureWorkingSpacePolygon(station, station), furnitureWorkingSpacePolygon(opposite, pose))).toBe(400)
    }
    expect(JSON.stringify(station)).toBe(before)
    expect(kitchenOpposingCandidates(bounds, shape, 100, 'work', [station], key => key, 37)).toEqual([])
    expect(kitchenOpposingCandidates(bounds, shape, 100, 'work', [{ ...station, rotationDeg: 37 }], key => key)).toEqual([])
    expect(kitchenOpposingCandidates(bounds, shape, 100, 'seat', [station], key => key)).toEqual([])
    expect(kitchenOpposingCandidates({ x: 0, y: 0, width: 1000, height: 1000 }, shape, 100, 'work', [station], key => key)).toEqual([])
  })
})
