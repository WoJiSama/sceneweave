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
  const nx = -dx * (grid.columns - 1) / bounds.width, ny = -dy * (grid.rows - 1) / bounds.height
  const length = Math.hypot(nx, ny, 1)
  return { offsetMm: a + x * dx + y * dy, normal: { x: nx / length, y: ny / length, z: 1 / length } }
}

export function createTerrainRelief(bounds: BoundsMm, heightAt: (point: PointMm) => number, cellSizeMm = 350): TerrainRelief {
  const count = (span: number) => Math.min(TERRAIN_RELIEF_GRID_LIMIT, Math.max(2, Math.ceil(span / cellSizeMm) + 1))
  const grid: TerrainRelief = { version: 1, columns: count(bounds.width), rows: count(bounds.height), offsetsMm: [] }
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) grid.offsetsMm.push(Math.round(heightAt(reliefGridPoint(grid, bounds, col, row))))
  }
  return terrainReliefSchema.parse(grid)
}
