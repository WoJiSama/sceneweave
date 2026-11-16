import { z } from 'zod'
import type { PointMm, TerrainArea } from '../model/scene.js'
import { inspectJsonInput } from '../validation/json.js'
import { rockShellSchema, type RockShell } from '../rock-shell/contracts.js'

/** Finite first-slice envelope, independent of saved project or task versions. */
export const CARVED_ROCK_LIMITS = Object.freeze({
  hostPoints: 128, stations: 64, vertices: 512, faces: 512, cutCells: 512,
  strips: 8, rawSegments: 4096, intersectionPairs: 2_000_000,
  coordinateAbsMm: 1_000_000_000, hostSpanMm: 1_000_000,
})
const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留 ID')
const integer = z.number().finite().refine(Number.isSafeInteger, '坐标须为安全整数毫米')
const coordinate = integer.refine(value => Math.abs(value) <= CARVED_ROCK_LIMITS.coordinateAbsMm, '岩体坐标超过有限范围')
export const carvedPointSchema = z.object({ x: coordinate, y: coordinate, z: coordinate }).strict()
export const rockBodySchema = z.object({ baseElevationMm: coordinate, shell: rockShellSchema.optional() }).strict()
export type RockBody = z.infer<typeof rockBodySchema>
const station = z.object({ id, sMm: integer.refine(value => value >= 0), centerVertexId: id, leftVertexId: id, rightVertexId: id,
  state: z.enum(['managed', 'manual']) }).strict()
const face = z.object({ id, vertexIds: z.tuple([id, id, id]) }).strict()
const cell = z.object({ id, lowerFaceId: id, sourceAreaId: id, kind: z.enum(['walk', 'apron']) }).strict()
const stripShape = z.object({
  algorithmId: z.literal('carved-strip1'), algorithmVersion: z.literal(1),
  hostAreaId: id, attachmentId: id, walkSurfaceId: id,
  sourceSegmentIds: z.array(id).min(1).max(CARVED_ROCK_LIMITS.hostPoints), cutSide: z.enum(['left', 'right']),
  widthMm: integer.refine(value => value > 0 && value <= CARVED_ROCK_LIMITS.hostSpanMm),
  stations: z.array(station).min(2).max(CARVED_ROCK_LIMITS.stations),
  verticesMm: z.record(id, carvedPointSchema), faces: z.record(id, face),
  walkFaceIds: z.array(id).min(1).max(CARVED_ROCK_LIMITS.faces),
  cutCells: z.array(cell).min(1).max(CARVED_ROCK_LIMITS.cutCells),
}).strict()
export type CarvedStrip = z.infer<typeof stripShape>
export type CarvedPointMm = z.infer<typeof carvedPointSchema>
export type CarvedStation = CarvedStrip['stations'][number]
export type CarvedFace = CarvedStrip['faces'][string]
export type CarvedCutCell = CarvedStrip['cutCells'][number]

/** Capture before Zod reads properties: schemas never execute caller getters. */
export const carvedStripSchema = z.preprocess((input, context) => {
  const issue = inspectJsonInput(input)
  if (issue) { context.addIssue({ code: 'custom', message: issue.message }); return z.NEVER }
  return input
}, stripShape.superRefine((strip, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message })
  if (Object.keys(strip.verticesMm).length > CARVED_ROCK_LIMITS.vertices || Object.keys(strip.faces).length > CARVED_ROCK_LIMITS.faces) fail('岩体山路完整几何超过有限预算。')
  const allocated = [...Object.keys(strip.verticesMm), ...Object.keys(strip.faces), ...strip.stations.map(row => row.id), ...strip.cutCells.map(row => row.id)]
  if (new Set(allocated).size !== allocated.length) fail('山路顶点、面、站点与切削单元 ID 须唯一。')
  const reserved = [strip.hostAreaId, strip.attachmentId, strip.walkSurfaceId, ...strip.sourceSegmentIds]
  if (new Set(reserved).size !== reserved.length || allocated.some(value => reserved.includes(value))) fail('山路实际几何ID不能复用宿主、附着、表面或源边身份。')
  if (new Set(strip.sourceSegmentIds).size !== strip.sourceSegmentIds.length || new Set(strip.walkFaceIds).size !== strip.walkFaceIds.length) fail('源边链或步行面引用不能重复。')
  for (const [key, row] of Object.entries(strip.faces)) if (key !== row.id || new Set(row.vertexIds).size !== 3 || row.vertexIds.some(value => !Object.hasOwn(strip.verticesMm, value))) fail('三角面须具有确切 ID 和三个现存不同顶点。')
  for (const row of strip.stations) if ([row.centerVertexId, row.leftVertexId, row.rightVertexId].some(value => !Object.hasOwn(strip.verticesMm, value))) fail('站点完整中心及左右顶点必须存在。')
  for (const value of strip.walkFaceIds) if (!Object.hasOwn(strip.faces, value)) fail('步行面引用缺失。')
  const cells = new Set<string>()
  for (const row of strip.cutCells) {
    if (!Object.hasOwn(strip.faces, row.lowerFaceId) || row.sourceAreaId !== strip.hostAreaId || cells.has(row.lowerFaceId)) fail('实际切削单元须唯一引用当前岩体的完整下表面。')
    cells.add(row.lowerFaceId)
    if ((row.kind === 'walk') !== strip.walkFaceIds.includes(row.lowerFaceId)) fail('步行面与实际切削下表面必须精确一致。')
  }
  if (strip.walkFaceIds.some(value => !cells.has(value)) || Object.keys(strip.faces).some(value => !cells.has(value))) fail('每个实际面须属于确切切削单元，不得保存未校验孤面。')
}))

export type CarvedRockHost = Pick<TerrainArea, 'id' | 'floorId' | 'boundaryMm' | 'groundElevationMm'> & { rockBody: { baseElevationMm: number; shell?: RockShell } }
export interface CreateCarvedStripIntent {
  attachmentId: string; walkSurfaceId: string; sourceSegmentIds: string[]; cutSide: 'left' | 'right'
  widthMm: number; pointsMm: CarvedPointMm[]
}
export interface CarvedSample {
  inside: true; zMm: number; normal: { x: number; y: number; z: number }; faceId: string
}
export interface CarvedRockPatch {
  surfaceId: string; faceId: string; kind: 'walk' | 'apron'; verticesMm: [CarvedPointMm, CarvedPointMm, CarvedPointMm]
}
export interface CarvedRockWall {
  a: PointMm; b: PointMm; normal: PointMm
  kind: 'cliff' | 'cut' | 'outer'
  highSurfaceId: string; lowSurfaceId: string | null
  highMm: [number, number]; lowMm: [number, number]
  verticesMm: [CarvedPointMm, CarvedPointMm, CarvedPointMm, CarvedPointMm]
}
export interface CarvedRockPlan {
  hostAreaId: string; baseElevationMm: number; topElevationMm: number
  /** Same XY geometry as physics. These disposable regions never grant support. */
  topRegionsMm: import('polygon-clipping').MultiPolygon
  footprintMm: PointMm[]; cutFootprintsMm: PointMm[][]
  patches: CarvedRockPatch[]; walls: CarvedRockWall[]
}
