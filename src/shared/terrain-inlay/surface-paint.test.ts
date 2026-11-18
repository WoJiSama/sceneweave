import { describe, expect, it } from 'vitest'
import type { ProjectedTerrainInlay } from '../projection/types.js'
import { terrainInlayFinishSchema } from './persistence.js'
import { terrainSlopeShades, terrainSlopeTreads } from './surface-paint.js'

function slope(): ProjectedTerrainInlay {
  const a = { x: 0, y: -1000 }, b = { x: 4000, y: -1000 }, c = { x: 4000, y: 1000 }, d = { x: 0, y: 1000 }, m = { x: 2000, y: 0 }
  return { id: 'slope', finish: { kind: 'steps', treadDepthMm: 350 }, finishRoute: { centerlineMm: [{ x: 0, y: 0 }, { x: 4000, y: 0 }], widthMm: 1000 },
    footprintMm: [a, b, c, d], walkFootprintMm: [a, b, c, d], apronSurfaces: [], walls: [], changedCarriers: [], paintBoundsMm: { x: 0, y: -1000, width: 4000, height: 2000 },
    patches: [{ kind: 'walk', pointsMm: [a, b, m], elevationsMm: [0, 1000, 500] }, { kind: 'apron', pointsMm: [b, c, m], elevationsMm: [1000, 1000, 500] },
      { kind: 'walk', pointsMm: [c, d, m], elevationsMm: [1000, 0, 500] }, { kind: 'apron', pointsMm: [d, a, m], elevationsMm: [0, 0, 500] }] }
}
describe('saved slope surface treatment', () => {
  it('uses shared actual normals across clearance classification and preserves geometry', () => {
    const inlay = slope(), before = structuredClone(inlay), shades = terrainSlopeShades(inlay, 0)
    expect(shades.every(row => row.opacity[0] === 0 && row.opacity[1] === 0)).toBe(true)
    expect(shades[0].opacity[2]).toBeGreaterThan(0)
    expect(new Set(shades.map(row => row.opacity[2])).size).toBe(1)
    const reclassified = structuredClone(inlay); for (const patch of reclassified.patches) patch.kind = 'walk'
    expect(terrainSlopeShades(reclassified, 0)).toEqual(shades)
    expect(inlay).toEqual(before)
  })
  it('stations treads along the complete route, reverses safely and keeps the slope as authoritative', () => {
    const inlay = slope(); for (const patch of inlay.patches) patch.kind = 'walk'
    const before = structuredClone(inlay), treads = terrainSlopeTreads(inlay)
    expect(treads).toHaveLength(11)
    expect(treads.every(row => row.dropMm > 0 && row.pointsMm.every(p => Math.abs(p.y) <= 500))).toBe(true)
    expect(inlay).toEqual(before)
    inlay.finishRoute!.centerlineMm.reverse()
    expect(terrainSlopeTreads(inlay)).toHaveLength(11)
    inlay.finish = { kind: 'slope' }; expect(terrainSlopeTreads(inlay)).toEqual([])
  })
  it('rejects unsupported finish fields and excessive marks instead of truncating', () => {
    expect(terrainInlayFinishSchema.safeParse({ kind: 'steps', treadDepthMm: 0 }).success).toBe(false)
    expect(terrainInlayFinishSchema.safeParse({ kind: 'slope', treadDepthMm: 350 }).success).toBe(false)
    const inlay = slope(); inlay.finish = { kind: 'steps', treadDepthMm: 50 }; inlay.finishRoute!.centerlineMm[1].x = 30000
    expect(() => terrainSlopeTreads(inlay)).toThrow(/512/)
  })
})
