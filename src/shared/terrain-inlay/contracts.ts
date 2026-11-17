import { z } from 'zod'
import type { PointMm } from '../model/scene.js'
import { captureJson } from '../validation/json.js'

/** Bounded geometry algorithm, independent of the project container version.
 * Adoption captures complete geometry and source evidence in the current v1. */
export const TERRAIN_INLAY_LIMITS = Object.freeze({
  sources: 2, sourcePoints: 2048, vertices: 512, faces: 512,
  segments: 4096, intersectionPairs: 2_000_000,
  coordinateAbsMm: 1_000_000_000, spanMm: 1_000_000,
})
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const integer = z.number().finite().refine(Number.isSafeInteger)
const coordinate = integer.refine(value => Math.abs(value) <= TERRAIN_INLAY_LIMITS.coordinateAbsMm)
const point = z.object({ x: coordinate, y: coordinate }).strict()
const point3 = point.extend({ z: coordinate }).strict()
const uniqueIds = z.array(id).refine(values => new Set(values).size === values.length, '引用不能重复')
const source = z.object({ id, floorId: id, groundElevationMm: coordinate,
  coveragePriority: integer.min(-10000).max(10000),
  boundaryMm: z.array(z.object({ id, segmentId: id, positionMm: point }).strict()).min(3).max(TERRAIN_INLAY_LIMITS.sourcePoints),
}).strict()
const face = z.object({ id, kind: z.enum(['walk', 'apron']), vertexIds: z.tuple([id, id, id]) }).strict()
export const terrainInlayRequestSchema = z.object({
  sources: z.array(source).min(2).max(TERRAIN_INLAY_LIMITS.sources),
  verticesMm: z.record(id, point3), faces: z.record(id, face),
  footprintVertexIds: uniqueIds.min(3).max(TERRAIN_INLAY_LIMITS.vertices),
  walkBoundaryVertexIds: uniqueIds.min(3).max(TERRAIN_INLAY_LIMITS.vertices),
}).strict()
export type TerrainInlayRequest = z.infer<typeof terrainInlayRequestSchema>
export type TerrainInlaySource = TerrainInlayRequest['sources'][number]
export type TerrainInlayPoint = z.infer<typeof point3>
export type TerrainInlayFace = z.infer<typeof face>

/** Copy descriptors before parsing, so even getters on nested caller input
 * cannot execute. The returned object grants no scene/identity authority. */
export function captureTerrainInlayRequest(input: TerrainInlayRequest): TerrainInlayRequest {
  return terrainInlayRequestSchema.parse(captureJson(input))
}
export interface TerrainInlayCell {
  sourceAreaId: string
  faceId: string
  kind: 'walk' | 'apron'
  mode: 'fill' | 'cut' | 'level'
  sourceElevationMm: number
  /** Disposable intersections of original integer planes and source rings. */
  ringMm: TerrainInlayPoint[]
  areaMm2: number
  volumeMm3: number
}
export interface TerrainInlaySourceInterval {
  sourceAreaId: string
  outsideSourceAreaId: string
  sourceSegmentId: string
  a: PointMm
  b: PointMm
  originalInsideHeightMm: number
  originalOutsideHeightMm: number
  insideHeightMm: [number, number]
  outsideHeightMm: [number, number]
  insideFaceId: string | null
  outsideFaceId: string | null
}
/** Boundary of the signed added/removed material. It is NOT the final exposed
 * after-surface wall; that wall also needs the visible ground on its other side. */
export interface TerrainInlayMaterialBoundary {
  a: PointMm; b: PointMm
  actualHeightMm: [number, number]
  originalHeightMm: [number, number]
  sourceAreaId: string
  faceId: string
  kind: 'fill' | 'cut'
}
export type TerrainInlayWallSurface = { kind: 'actual'; faceId: string } | { kind: 'source'; areaId: string }
/** Exposed AFTER wall between an actual face and the untouched visible ground
 * outside the full influence region. Heights can swap sides along an edge;
 * that crossing is split before an outward-facing wall is returned. */
export interface TerrainInlayExposedWall {
  a: PointMm; b: PointMm
  high: TerrainInlayWallSurface
  low: TerrainInlayWallSurface
  highMm: [number, number]
  lowMm: [number, number]
  normal: PointMm
  verticesMm: [TerrainInlayPoint, TerrainInlayPoint, TerrainInlayPoint, TerrainInlayPoint]
}
export interface TerrainInlayPlan {
  cells: TerrainInlayCell[]
  materialBoundaries: TerrainInlayMaterialBoundary[]
  exposedWalls: TerrainInlayExposedWall[]
  sourceIntervals: TerrainInlaySourceInterval[]
  sharedWalkApronEdges: { a: TerrainInlayPoint; b: TerrainInlayPoint }[]
  fillVolumeMm3: number
  cutVolumeMm3: number
  footprintAreaMm2: number
  walkAreaMm2: number
}
