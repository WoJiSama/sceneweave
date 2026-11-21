import { describe, expect, it } from 'vitest'
import { pointInPolygon } from '../../../shared/geometry/geometry.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedTerrainEdge } from '../../../shared/projection/types.js'
import { cliffBandWidth, terrainBandCells, terrainEdgeRuns } from './terrain-edge-bands.js'

const p = (x: number, y: number) => ({ x, y })
const edges = (points: PointMm[]): ProjectedTerrainEdge[] => points.map((start, i) => ({
  id: 'edge-' + i, start, end: points[(i + 1) % points.length], sourceAreaId: 'top', neighborAreaId: null,
  elevationMm: 1000, neighborElevationMm: 0, kind: 'cliff', shoreline: false,
  style: { strokeWidthMm: 80, bandWidthMm: 200, color: '#253138' }, customFinish: true, surfaceStyle: null,
}))
const face = ({ top: [a, b], foot: [c, d] }: ReturnType<typeof terrainBandCells>[number]) => [a, b, d, c]

describe('continuous terrain edge bands', () => {
  it('joins the closing corner and a canonical low-side carrier at the same high outline', () => {
    const points = [p(0, 0), p(1000, 0), p(1000, 1000), p(0, 1000)]
    const [a, b, c, d] = edges(points)
    const fromLow = { ...b, start: b.end, end: b.start, sourceAreaId: 'lower', neighborAreaId: 'top', elevationMm: 0, neighborElevationMm: 1000 }
    const [run] = terrainEdgeRuns([a, c, fromLow, d])
    expect(run).toMatchObject({ points, closed: true, highAreaId: 'top' })
    const cells = terrainBandCells(run, edge => cliffBandWidth(edge, null), 1)
    for (let i = 0; i < cells.length; i++) expect(cells[i].foot[1]).toEqual(cells[(i + 1) % cells.length].foot[0])
    expect(cells[0].foot).toEqual([p(-200, -200), p(1200, -200)])
  })

  it('bounds sharp corners and keeps coverage at short inside turns', () => {
    const points = [p(0, 0), p(1400, 0), p(1400, 1400), p(850, 1400), p(850, 600), p(820, 600), p(820, 1400), p(0, 1400)]
    const [run] = terrainEdgeRuns(edges(points))
    const cells = terrainBandCells(run, () => 200, 1)
    expect(cells.every(cell => cell.foot.every((foot, i) => Math.hypot(foot.x - cell.top[i].x, foot.y - cell.top[i].y) <= 320))).toBe(true)
    expect(cells.some(cell => pointInPolygon(p(835, 650), face(cell)))).toBe(true)
    const [pointed] = terrainEdgeRuns(edges([p(0, 0), p(2000, 100), p(0, 200)]))
    expect(terrainBandCells(pointed, () => 200, 1).flatMap(cell => cell.bevels).length).toBeGreaterThan(0)
  })

  it('uses an edited width and leaves omitted boundary segments open', () => {
    const source = edges([p(0, 0), p(1400, 0), p(1600, 900), p(0, 1000)])
    source[0].style.bandWidthMm = 375
    const [run] = terrainEdgeRuns([source[0], source[2], source[3]])
    expect(run.closed).toBe(false)
    expect(run.edges.map(row => row.edge.id)).toEqual(['edge-2', 'edge-3', 'edge-0'])
    const strip = terrainBandCells(run, edge => cliffBandWidth(edge, null), 1)
    expect(strip.at(-1)?.foot[1]).toEqual(p(1400, -375))
    expect(cliffBandWidth({ ...source[0], customFinish: undefined }, null)).toBe(180)
  })
})
