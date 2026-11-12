import { describe, expect, it } from 'vitest'
import { polygonDistance, polygonInside, polygonsOverlap } from '../../../geometry/geometry.js'
import { furnitureBoundsPolygon, type FurnishingShape } from './furnishing-poses.js'
import { bedroomStorageCandidates, planBedroomAccess } from './furnishing-bedroom.js'

const bed: FurnishingShape = { visualBoundsMm: { x: -750, y: -1250, width: 1500, height: 2500 },
  footprintMm: { width: 1100, height: 2100 }, footprintOffsetMm: { x: 100, y: 50 } }
const cabinet: FurnishingShape = { visualBoundsMm: { x: -875, y: -500, width: 1750, height: 1000 },
  footprintMm: { width: 1400, height: 600 }, footprintOffsetMm: { x: 0, y: 0 } }
const room = [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 8000 }, { x: 0, y: 8000 }]

describe('complete bedside access and finite storage suggestions', () => {
  it.each([0, 90, 180, 270, 37])('keeps a full usable strip and connected route around an actual bed at %s degrees', rotationDeg => {
    const pose = { positionMm: { x: 2200, y: 2300 }, rotationDeg }, physical = furnitureBoundsPolygon({ x: -450, y: -1000, width: 1100, height: 2100 }, pose)
    const painted = furnitureBoundsPolygon(bed.visualBoundsMm, pose)
    let work = 0
    const access = planBedroomAccess({ shape: bed, pose, roomPolygon: room, centerMm: { x: 4000, y: 4000 }, blockers: [physical, painted], rank: key => key,
      checkCancelled() {}, chargeCandidate() { work++ }, chargePair() { work++ } })
    expect(access).toBeDefined()
    for (const polygon of [access!.usePolygon, access!.routePolygon]) {
      expect(polygonInside(polygon, room)).toBe(true)
      expect(polygonsOverlap(polygon, physical)).toBe(false)
      expect(polygonsOverlap(polygon, painted)).toBe(false)
    }
    expect(polygonDistance(access!.usePolygon, painted)).toBeCloseTo(100, 5)
    expect(access!.pointsMm[0]).toEqual({ x: 4000, y: 4000 })
    expect(work).toBeGreaterThan(0)
  })

  it('refuses an obstructed centre, insufficient bed length and cancellation without changing the input', () => {
    const pose = { positionMm: { x: 2000, y: 2000 }, rotationDeg: 0 }
    const settings = { shape: bed, pose, roomPolygon: room, centerMm: { x: 4000, y: 4000 }, blockers: [room], rank: (key: string) => key,
      checkCancelled() {}, chargeCandidate() {}, chargePair() {} }
    const before = JSON.stringify(settings)
    expect(planBedroomAccess(settings)).toBeUndefined()
    expect(JSON.stringify(settings)).toBe(before)
    expect(() => planBedroomAccess({ ...settings, checkCancelled() { throw new Error('cancelled') } })).toThrow('cancelled')
    expect(planBedroomAccess({ ...settings, shape: { ...bed, visualBoundsMm: { x: -200, y: -200, width: 400, height: 400 }, footprintMm: { width: 400, height: 400 } } })).toBeUndefined()
  })

  it.each([0, 90, 180, 270])('groups full storage by a real cardinal bed at %s degrees without moving it', rotationDeg => {
    const anchor = { ...bed, positionMm: { x: 4000, y: 4000 }, rotationDeg }, before = JSON.stringify(anchor)
    const poses = bedroomStorageCandidates({ x: 0, y: 0, width: 8000, height: 8000 }, cabinet, 100, [anchor], key => key)
    expect(poses).toHaveLength(2)
    for (const pose of poses) {
      expect(polygonDistance(furnitureBoundsPolygon(bed.visualBoundsMm, anchor), furnitureBoundsPolygon(cabinet.visualBoundsMm, pose))).toBe(100)
      expect(polygonInside(furnitureBoundsPolygon(cabinet.visualBoundsMm, pose), room)).toBe(true)
    }
    expect(JSON.stringify(anchor)).toBe(before)
    expect(bedroomStorageCandidates({ x: 0, y: 0, width: 8000, height: 8000 }, cabinet, 100, [{ ...anchor, rotationDeg: 37 }], key => key)).toEqual([])
  })
})
