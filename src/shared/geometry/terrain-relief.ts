import { z } from 'zod'
import type { BoundsMm, PointMm } from '../model/scene.js'

export const TERRAIN_RELIEF_GRID_LIMIT = 97
const gridSize = z.number().int().min(2).max(TERRAIN_RELIEF_GRID_LIMIT)
export const terrainReliefSchema = z.object({
  version: z.literal(1),
  columns: gridSize,
  rows: gridSize,
  offsetsMm: z.array(z.number().int().min(-500_000).max(500_000)).max(TERRAIN_RELIEF_GRID_LIMIT ** 2),
}).strict().refine(grid => grid.offsetsMm.length === grid.columns * grid.rows, '起伏地形必须保存每个格点的高度。')
export type TerrainRelief = z.infer<typeof terrainReliefSchema>

export function reliefBounds(points: readonly PointMm[]): BoundsMm {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const point of points) {
    x = Math.min(x, point.x)
    y = Math.min(y, point.y)
    right = Math.max(right, point.x)
    bottom = Math.max(bottom, point.y)
  }
  return { x, y, width: right - x, height: bottom - y }
}

export function reliefGridPoint(grid: TerrainRelief, bounds: BoundsMm, column: number, row: number): PointMm {
  return { x: bounds.x + bounds.width * column / (grid.columns - 1), y: bounds.y + bounds.height * row / (grid.rows - 1) }
}

/** Clockwise world XY with two planar halves per cell. The same diagonal is used by the mesh. */
export function sampleTerrainRelief(grid: TerrainRelief, bounds: BoundsMm, point: PointMm) {
  const u = Math.max(0, Math.min(grid.columns - 1, (point.x - bounds.x) / bounds.width * (grid.columns - 1)))
  const v = Math.max(0, Math.min(grid.rows - 1, (point.y - bounds.y) / bounds.height * (grid.rows - 1)))
  const col = Math.min(grid.columns - 2, Math.floor(u)), row = Math.min(grid.rows - 2, Math.floor(v))
  const x = u - col, y = v - row, index = row * grid.columns + col
  const a = grid.offsetsMm[index], b = grid.offsetsMm[index + 1]
  const c = grid.offsetsMm[index + grid.columns + 1], d = grid.offsetsMm[index + grid.columns]
  const dx = x >= y ? b - a : c - d, dy = x >= y ? c - b : d - a
  const nx = (0 - dx) * (grid.columns - 1) / bounds.width, ny = (0 - dy) * (grid.rows - 1) / bounds.height
  const length = Math.hypot(nx, ny, 1)
  return { offsetMm: a + x * dx + y * dy, normal: { x: nx / length, y: ny / length, z: 1 / length } }
}

/** Segment parameters at which the piecewise planar relief can change slope. */
export function reliefSegmentCuts(grid: TerrainRelief, bounds: BoundsMm, a: PointMm, b: PointMm): number[] {
  const u = (p: PointMm) => (p.x - bounds.x) * (grid.columns - 1) / bounds.width
  const v = (p: PointMm) => (p.y - bounds.y) * (grid.rows - 1) / bounds.height
  const au = u(a), av = v(a), bu = u(b), bv = v(b)
  const cuts = [0, 1]
  const add = (from: number, to: number, min: number, max: number, start: number, end: number) => {
    if (from === to) return
    for (let i = Math.max(min, Math.ceil(Math.min(from, to))); i <= Math.min(max, Math.floor(Math.max(from, to))); i++) {
      const t = start + (end - start) * (i - from) / (to - from)
      if (t > start + 1e-10 && t < end - 1e-10) cuts.push(t)
    }
  }
  add(au, bu, 0, grid.columns - 1, 0, 1)
  add(av, bv, 0, grid.rows - 1, 0, 1)
  // The diagonal in grid coordinates satisfies u - v = integer. The outer
  // rectangle cuts above also cover transitions to a clamped sample.
  const spans = [...new Set(cuts)].sort((x, y) => x - y)
  const diagonal = (t: number) => Math.max(0, Math.min(grid.columns - 1, au + (bu - au) * t))
    - Math.max(0, Math.min(grid.rows - 1, av + (bv - av) * t))
  for (let i = 1; i < spans.length; i++) {
    const start = spans[i - 1], end = spans[i]
    add(diagonal(start), diagonal(end), 1 - grid.rows, grid.columns - 1, start, end)
  }
  return [...new Set(cuts)].sort((x, y) => x - y)
}

interface ReliefSurface { grid?: TerrainRelief; bounds: BoundsMm }

/** Between the union of both lattices' cuts, the height difference is affine. */
export function reliefMatchesAlong(current: ReliefSurface, previous: ReliefSurface, ring: readonly PointMm[]): boolean {
  const cutsAt = (surface: ReliefSurface, p: PointMm, q: PointMm) => surface.grid ? reliefSegmentCuts(surface.grid, surface.bounds, p, q) : []
  const heightAt = (surface: ReliefSurface, p: PointMm) => surface.grid ? sampleTerrainRelief(surface.grid, surface.bounds, p).offsetMm : 0
  return ring.every((a, i) => {
    const q = ring[(i + 1) % ring.length]
    return [0, ...cutsAt(current, a, q), ...cutsAt(previous, a, q)].every(t => {
      const p = { x: a.x + (q.x - a.x) * t, y: a.y + (q.y - a.y) * t }
      return Math.abs(heightAt(current, p) - heightAt(previous, p)) < 1e-6
    })
  })
}

export function reliefLevelAlong(grid: TerrainRelief, bounds: BoundsMm, ring: readonly PointMm[]): boolean {
  return reliefMatchesAlong({ grid, bounds }, { bounds }, ring)
}

export function createTerrainRelief(bounds: BoundsMm, heightAt: (point: PointMm) => number, cellSizeMm = 350): TerrainRelief {
  const count = (span: number) => Math.min(TERRAIN_RELIEF_GRID_LIMIT, Math.max(2, Math.ceil(span / cellSizeMm) + 1))
  const grid: TerrainRelief = { version: 1, columns: count(bounds.width), rows: count(bounds.height), offsetsMm: [] }
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) grid.offsetsMm.push(Math.round(heightAt(reliefGridPoint(grid, bounds, col, row))))
  }
  return terrainReliefSchema.parse(grid)
}
