import { describe, expect, it } from 'vitest'
import { polygonDistance, polygonsOverlap } from '../../../geometry/geometry.js'
import { kitchenFurnitureGroupCandidates, type KitchenFurnitureAnchor } from './furnishing-groups.js'
import { kitchenParallelRunCandidates, kitchenWallRowCandidates } from './furnishing-kitchen-rows.js'
import { furnitureBoundsPolygon, type FurnishingShape } from './furnishing-poses.js'
import { furnitureWorkingSpacePolygon } from './furnishing-use-space.js'

const bounds = { x: 0, y: 0, width: 24000, height: 24000 }
const work: FurnishingShape = { visualBoundsMm: { x: -1450, y: -575, width: 2900, height: 1150 },
  footprintMm: { width: 2690, height: 980 }, footprintOffsetMm: { x: 0, y: 0 } }
const hearth: FurnishingShape = { visualBoundsMm: { x: -1000, y: -875, width: 2000, height: 1750 },
  footprintMm: { width: 1780, height: 1550 }, footprintOffsetMm: { x: 0, y: 0 } }
// Its physical back extends beyond the painted box, and its root is offset.
const storage: FurnishingShape = { visualBoundsMm: { x: -800, y: -300, width: 1850, height: 1000 },
  footprintMm: { width: 1650, height: 1100 }, footprintOffsetMm: { x: 170, y: -70 } }
const options = { bounds, inset: 200, role: 'storage' as const, shape: storage, shapes: [work, hearth, storage],
  rank: (key: string) => key, checkCancelled: () => {}, charge: () => {} }

describe('opposing kitchen runs with full fixed depths', () => {
  it.each([0, 90, 180, 270])('keeps a shared back and full operating strips when deeper stations join at %s degrees', rotationDeg => {
    const first: KitchenFurnitureAnchor = { ...work, role: 'work', positionMm: { x: 12000, y: 12000 }, rotationDeg }
    const second = { ...hearth, role: 'hearth' as const,
      ...kitchenFurnitureGroupCandidates(bounds, hearth, 200, 'hearth', [first], key => key)[0] }
    const anchors = [first, second], before = JSON.stringify({ anchors, storage })
    const poses = kitchenParallelRunCandidates({ ...options, anchors })
    expect(poses.length).toBeGreaterThan(1)
    for (const pose of poses) {
      const cupboard: KitchenFurnitureAnchor = { ...storage, ...pose, role: 'storage' }
      const continuations = kitchenFurnitureGroupCandidates(bounds, work, 200, 'work', [cupboard], key => key)
      expect(continuations.length).toBeGreaterThan(0)
      for (const next of continuations) {
        for (const anchor of anchors) {
          const band = furnitureWorkingSpacePolygon(work, next), original = furnitureWorkingSpacePolygon(anchor, anchor)
          expect(polygonsOverlap(band, original)).toBe(false)
          expect(polygonDistance(band, original)).toBeGreaterThanOrEqual(400)
        }
        expect(polygonsOverlap(furnitureWorkingSpacePolygon(cupboard, cupboard), furnitureWorkingSpacePolygon(work, next))).toBe(false)
        const painted = furnitureBoundsPolygon(work.visualBoundsMm, next)
        expect(painted.every(p => p.x >= 200 && p.x <= bounds.width - 200 && p.y >= 200 && p.y <= bounds.height - 200)).toBe(true)
      }
    }
    expect(JSON.stringify({ anchors, storage })).toBe(before)
    expect(kitchenParallelRunCandidates({ ...options, anchors: [...anchors].reverse() })).toEqual(poses)
  })

  it('uses only actual cardinal primary stations and keeps retained rotations and small rooms explicit', () => {
    const anchor = { ...work, role: 'work' as const, positionMm: { x: 10000, y: 10000 }, rotationDeg: 0 }
    expect(kitchenParallelRunCandidates({ ...options, anchors: [{ ...anchor, role: 'shelf' }] })).toEqual([])
    expect(kitchenParallelRunCandidates({ ...options, anchors: [{ ...anchor, rotationDeg: 37 }] })).toEqual([])
    expect(kitchenParallelRunCandidates({ ...options, anchors: [anchor], retainedRotation: 37 })).toEqual([])
    expect(kitchenParallelRunCandidates({ ...options, anchors: [anchor], role: 'seat' })).toEqual([])
    expect(kitchenParallelRunCandidates({ ...options, anchors: [anchor], bounds: { x: 9000, y: 9000, width: 4000, height: 2000 } })).toEqual([])
    expect(kitchenParallelRunCandidates({ ...options, anchors: [anchor], retainedRotation: 180 }).every(p => p.rotationDeg === 180)).toBe(true)
  })

  it('places an alternative against the actual opposite wall, including physical offsets', () => {
    const anchor = { ...work, role: 'work' as const, positionMm: { x: 2000, y: 775 }, rotationDeg: 0 }
    const poses = kitchenWallRowCandidates({ ...options, anchors: [anchor] })
    expect(poses.length).toBeGreaterThan(1)
    for (const pose of poses) {
      expect(pose.rotationDeg).toBe(180)
      const physical = { x: storage.footprintOffsetMm.x - storage.footprintMm.width / 2,
        y: storage.footprintOffsetMm.y - storage.footprintMm.height / 2, ...storage.footprintMm }
      const points = [storage.visualBoundsMm, physical].flatMap(box => furnitureBoundsPolygon(box, pose))
      expect(Math.max(...points.map(p => p.y))).toBe(bounds.height - 200)
    }
    expect(kitchenWallRowCandidates({ ...options, anchors: [anchor], retainedRotation: 37 })).toEqual([])
  })

  it('charges bounded work and propagates cancellation and budget failure', () => {
    const anchor = { ...work, role: 'work' as const, positionMm: { x: 12000, y: 12000 }, rotationDeg: 0 }
    for (const candidates of [kitchenParallelRunCandidates, kitchenWallRowCandidates]) {
      let charges = 0
      expect(candidates({ ...options, anchors: [anchor], charge: () => { charges++ } }).length).toBeGreaterThan(0)
      expect(charges).toBeGreaterThan(0)
      expect(() => candidates({ ...options, anchors: [anchor], charge: () => { throw Error('budget exceeded') } })).toThrow('budget exceeded')
      expect(() => candidates({ ...options, anchors: [anchor], checkCancelled: () => { throw Error('cancelled') } })).toThrow('cancelled')
    }
  })
})
