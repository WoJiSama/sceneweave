import { describe, expect, it } from 'vitest'
import { polygonDistance, polygonInside } from '../../../geometry/geometry.js'
import { bedroomGroupPoseCandidates } from './furnishing-bedroom-group.js'
import { bedroomStorageCandidates } from './furnishing-bedroom.js'
import { furnitureWorkingSpacePolygon } from './furnishing-use-space.js'
import { furnitureBoundsPolygon, type FurnishingShape } from './furnishing-poses.js'

const bed: FurnishingShape = { visualBoundsMm: { x: -650, y: -1300, width: 1500, height: 2600 },
  footprintMm: { width: 1100, height: 2100 }, footprintOffsetMm: { x: 100, y: 50 } }
const cabinet: FurnishingShape = { visualBoundsMm: { x: -900, y: -500, width: 1800, height: 1000 },
  footprintMm: { width: 1400, height: 700 }, footprintOffsetMm: { x: 0, y: 0 } }
const bounds = { x: 1300, y: -2000, width: 7500, height: 5600 }
const polygon = furnitureBoundsPolygon({ ...bounds }, { positionMm: { x: 0, y: 0 }, rotationDeg: 0 })

describe('complete bed and storage candidate envelope', () => {
  it.each([0, 90, 180, 270])('leaves a full-sized cabinet and its front strip in bounds at bed rotation %s', rotationDeg => {
    const before = JSON.stringify({ bed, cabinet, bounds })
    const poses = bedroomGroupPoseCandidates(bounds, bed, [cabinet], 200, key => key, rotationDeg)
    expect(poses.length).toBeGreaterThan(0)
    for (const pose of poses) {
      expect(pose.rotationDeg).toBe(rotationDeg)
      const stores = bedroomStorageCandidates(bounds, cabinet, 200, [{ ...bed, ...pose }], key => key)
      expect(stores.some(store => polygonInside(furnitureWorkingSpacePolygon(cabinet, store), polygon))).toBe(true)
      expect(polygonInside(furnitureBoundsPolygon(bed.visualBoundsMm, pose), polygon)).toBe(true)
      for (const store of stores) expect(polygonDistance(furnitureBoundsPolygon(bed.visualBoundsMm, pose), furnitureBoundsPolygon(cabinet.visualBoundsMm, store))).toBe(100)
    }
    expect(JSON.stringify({ bed, cabinet, bounds })).toBe(before)
  })

  it('handles a horizontal authored bed and rejects an oversized complete group without shrinking it', () => {
    const horizontal = { ...bed, visualBoundsMm: { x: -1300, y: -650, width: 2600, height: 1500 }, footprintMm: { width: 2100, height: 1100 } }
    const poses = bedroomGroupPoseCandidates(bounds, horizontal, [cabinet], 200, key => key)
    expect(poses.length).toBeGreaterThan(0)
    for (const pose of poses) {
      const stores = bedroomStorageCandidates(bounds, cabinet, 200, [{ ...horizontal, ...pose }], key => key)
      expect(stores.some(store => polygonInside(furnitureWorkingSpacePolygon(cabinet, store), polygon))).toBe(true)
    }
    expect(bedroomGroupPoseCandidates({ ...bounds, width: 2000, height: 3000 }, bed, [cabinet], 200, key => key)).toEqual([])
    expect(bedroomGroupPoseCandidates(bounds, bed, [], 200, key => key)).toEqual([])
    expect(bedroomGroupPoseCandidates(bounds, bed, [cabinet], 200, key => key, 37)).toEqual([])
  })
})
