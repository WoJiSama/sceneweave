import { describe, expect, it } from 'vitest'
import { polygonDistance } from '../../../geometry/geometry.js'
import { furnitureBoundsPolygon, type FurnishingShape } from './furnishing-poses.js'
import { kitchenFurnitureGroupCandidates, type KitchenFurnitureAnchor } from './furnishing-groups.js'

const bounds = { x: 0, y: 0, width: 20000, height: 18000 }
const shape: FurnishingShape = { visualBoundsMm: { x: -450, y: -300, width: 1100, height: 800 },
  footprintMm: { width: 800, height: 600 }, footprintOffsetMm: { x: 120, y: 60 } }

describe('finite kitchen work-group suggestions', () => {
  it('starts a kitchen run at the ends of the longer wall with its front facing into the room', () => {
    const poses = kitchenFurnitureGroupCandidates(bounds, shape, 100, 'work', [], key => key)
    expect(poses).toHaveLength(8)
    expect(poses.slice(0,4).every(pose=>pose.rotationDeg===0||pose.rotationDeg===180)).toBe(true)
    for(const pose of poses.slice(0,4)){
      const painted=furnitureBoundsPolygon(shape.visualBoundsMm,pose)
      const xs=painted.map(p=>p.x),ys=painted.map(p=>p.y)
      expect(Math.min(...xs)===100||Math.max(...xs)===bounds.width-100).toBe(true)
      expect(pose.rotationDeg===0?Math.min(...ys):bounds.height-Math.max(...ys)).toBe(100)
    }
  })

  it.each([0, 90, 180, 270])('joins full off-centre shapes at rotation %s without mutating the anchor', rotationDeg => {
    const anchor: KitchenFurnitureAnchor = { ...shape, role: 'work', rotationDeg, positionMm: { x: 10000, y: 9000 } }
    const before = JSON.stringify(anchor)
    const poses = kitchenFurnitureGroupCandidates(bounds, shape, 100, 'storage', [anchor], key => key)
    expect(poses).toHaveLength(2)
    for (const pose of poses) {
      expect(pose.rotationDeg).toBe(rotationDeg)
      const a = furnitureBoundsPolygon(shape.visualBoundsMm, anchor), b = furnitureBoundsPolygon(shape.visualBoundsMm, pose)
      expect(polygonDistance(a, b)).toBe(100)
      // Same back edge in the authored local frame, including an offset root.
      const angle = rotationDeg * Math.PI / 180
      const localY = (point: { x: number; y: number }) => Math.round(-point.x * Math.sin(angle) + point.y * Math.cos(angle))
      expect(Math.min(...a.map(localY))).toBe(Math.min(...b.map(localY)))
    }
    expect(JSON.stringify(anchor)).toBe(before)
  })

  it('keeps bounds, retained rotation, role and non-cardinal limitations explicit', () => {
    const anchor: KitchenFurnitureAnchor = { ...shape, role: 'work', rotationDeg: 0, positionMm: { x: 600, y: 500 } }
    const constrained = kitchenFurnitureGroupCandidates({ x: 0, y: 0, width: 2600, height: 1800 }, shape, 100, 'hearth', [anchor], key => key)
    expect(constrained).toHaveLength(1)
    expect(constrained[0].positionMm.x).toBeGreaterThan(anchor.positionMm.x)
    expect(kitchenFurnitureGroupCandidates(bounds, shape, 100, 'work', [{ ...anchor, rotationDeg: 37 }], key => key)).toEqual([])
    expect(kitchenFurnitureGroupCandidates(bounds, shape, 100, 'work', [anchor], key => key, 37)).toEqual([])
    expect(kitchenFurnitureGroupCandidates(bounds, shape, 100, 'seat', [anchor], key => key)).toEqual([])
    expect(kitchenFurnitureGroupCandidates(bounds, shape, 100, 'bed', [anchor], key => key)).toEqual([])
  })
})
