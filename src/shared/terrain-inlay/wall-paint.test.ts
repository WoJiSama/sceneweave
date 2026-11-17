import { describe, expect, it } from 'vitest'
import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { terrainInlayWallPaint, type InlayPaintWall } from './wall-paint.js'

const poly = (points: { x: number; y: number }[]): MultiPolygon => [[points.map(p => [p.x, p.y])]]
const area = (regions: MultiPolygon) => regions.reduce((sum, polygon) => sum + polygon.reduce((s, ring, i) => s + (i ? -1 : 1) * Math.abs(ring.reduce((a, p, j) => a + p[0] * ring[(j + 1) % ring.length][1] - ring[(j + 1) % ring.length][0] * p[1], 0) / 2), 0), 0)
const walls = (): InlayPaintWall[] => [
  { a: { x: -1000, y: 0 }, b: { x: 0, y: 0 }, highMm: [2000, 2000], lowMm: [1000, 1000], normal: { x: 0, y: -1 }, lowSourceAreaId: 'low' },
  { a: { x: 0, y: 0 }, b: { x: 0, y: 1000 }, highMm: [2000, 2000], lowMm: [1000, 1000], normal: { x: 1, y: 0 }, lowSourceAreaId: 'low' },
]

describe('actual inlay wall paint junctions', () => {
  it('fills a convex low-side gap using only the original reach hull and preserves the saved wall inputs', () => {
    const input = walls(), before = structuredClone(input)
    expect(terrainInlayWallPaint(input)).toHaveLength(3)
    // A gentle 45-degree bend: a visible wedge between outgoing offsets.
    input[1].b = { x: 1000, y: 1000 }; input[1].normal = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }
    const pieces = terrainInlayWallPaint(input), wedge = pieces.at(-1)!
    expect(pieces).toHaveLength(3)
    const missing = poly([{ x: 0, y: 0 }, { x: 0, y: -180 }, { x: 180 * Math.SQRT1_2, y: -180 * Math.SQRT1_2 }])
    const raw = polygonClipping.union(poly(pieces[0].pointsMm), poly(pieces[1].pointsMm))
    expect(area(polygonClipping.difference(missing, raw))).toBeGreaterThan(10000)
    expect(area(polygonClipping.xor(poly(wedge.pointsMm), missing))).toBeCloseTo(0, 6)
    expect(area(polygonClipping.difference(poly(wedge.pointsMm), poly([{ x: 0, y: 0 }, { x: 0, y: -180 }, { x: 180, y: -180 }, { x: 180, y: 0 }])))).toBe(0)
    expect(terrainInlayWallPaint([...input].reverse()).at(-1)).toEqual(wedge)
    expect(input[0]).toEqual(before[0])
    expect(input[1].a).toEqual(before[1].a)
    const residue = structuredClone(input); residue[1].highMm = [2000 + 1e-10, 2000]
    expect(terrainInlayWallPaint(residue)).toHaveLength(3)
  })

  it('does not bridge height, owner, branch or re-entrant discontinuities', () => {
    const input = walls(); input[1].b = { x: 1000, y: 1000 }; input[1].normal = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }
    const changedHeight = structuredClone(input); changedHeight[1].highMm = [2100, 2100]
    expect(terrainInlayWallPaint(changedHeight)).toHaveLength(2)
    changedHeight[1].highMm = [2000 + 1e-6, 2000]
    expect(terrainInlayWallPaint(changedHeight)).toHaveLength(2)
    const changedSource = structuredClone(input); changedSource[1].lowSourceAreaId = null
    expect(terrainInlayWallPaint(changedSource)).toHaveLength(2)
    expect(terrainInlayWallPaint([...input, { ...input[1], b: { x: 2000, y: 1000 } }])).toHaveLength(3)
    input[1].b = { x: 1000, y: -1000 }; input[1].normal = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }
    expect(terrainInlayWallPaint(input)).toHaveLength(2)
  })
})
