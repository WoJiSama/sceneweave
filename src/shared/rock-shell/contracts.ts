import { z } from 'zod'
import type { PointMm, SurfaceRef, TerrainPoint } from '../model/scene.js'
import { inspectJsonInput } from '../validation/json.js'

export const ROCK_SHELL_LIMITS = Object.freeze({ sections: 20, vertices: 80, faces: 120, transactionCost: 256,
  coordinateAbsMm: 1_000_000_000, hostSpanMm: 1_000_000 })
const id = z.string().min(1).max(256).refine(v => v !== '__proto__', '保留 ID')
const integer = z.number().finite().refine(Number.isSafeInteger, '须为安全整数毫米')
const coordinate = integer.refine(v => Math.abs(v) <= ROCK_SHELL_LIMITS.coordinateAbsMm, '侧壳坐标超过有限范围')
const xy = z.object({ x: coordinate, y: coordinate }).strict()
const xyz = z.object({ x: coordinate, y: coordinate, z: coordinate }).strict()
const terrainPoint = z.object({ id, segmentId: id, positionMm: xy }).strict()
const state = z.enum(['managed', 'manual'])
const direction = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const shape = z.object({
  algorithmId: z.literal('rock-shell1'), algorithmVersion: z.literal(1), hostAreaId: id,
  sourceBoundaryMm: z.array(terrainPoint).min(4).max(ROCK_SHELL_LIMITS.sections),
  topElevationMm: coordinate, baseElevationMm: coordinate,
  footSurfaceRef: z.object({ kind: z.literal('floor'), id }).strict(), footElevationMm: z.literal(0),
  recipe: z.object({ widthMm: integer.refine(v => v > 0 && v <= ROCK_SHELL_LIMITS.hostSpanMm), direction,
    seed: z.string().max(1024), excludedSegmentIds: z.array(id).max(ROCK_SHELL_LIMITS.sections) }).strict(),
  verticesMm: z.record(id, xyz),
  faces: z.record(id, z.object({ id, vertexIds: z.tuple([id, id, id]), sourceSegmentId: id,
    sectionIds: z.tuple([id, id]), zone: z.enum(['shoulder', 'wall', 'foot']), state }).strict()),
  sections: z.array(z.object({ id, sourceSegmentId: id, offsetMm: integer.refine(v => v >= 0),
    topVertexId: id, shoulderVertexId: id, kneeVertexId: id, footVertexId: id, state }).strict()).min(4).max(ROCK_SHELL_LIMITS.sections),
}).strict()

/** Structural schema. Full actual-geometry checks are inspectRockShell's job. */
export const rockShellSchema = z.preprocess((input, context) => {
  const issue = inspectJsonInput(input)
  if (issue) { context.addIssue({ code: 'custom', message: issue.message }); return z.NEVER }
  return input
}, shape.superRefine((shell, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message })
  if (Object.keys(shell.verticesMm).length > ROCK_SHELL_LIMITS.vertices || Object.keys(shell.faces).length > ROCK_SHELL_LIMITS.faces) fail('侧壳完整几何超过有限预算。')
  const allocated = [...Object.keys(shell.verticesMm), ...Object.keys(shell.faces), ...shell.sections.map(v => v.id)]
  if (new Set(allocated).size !== allocated.length) fail('侧壳节点、面和剖面ID须唯一。')
  const reserved = [shell.hostAreaId, shell.footSurfaceRef.id, ...shell.sourceBoundaryMm.flatMap(v => [v.id, v.segmentId])]
  if (allocated.some(v => reserved.includes(v))) fail('侧壳实际几何不能复用宿主/源边/地面ID。')
  for (const [key, face] of Object.entries(shell.faces)) if (key !== face.id || new Set(face.vertexIds).size !== 3 || face.vertexIds.some(v => !Object.hasOwn(shell.verticesMm, v))) fail('侧壳实际三角面引用缺失或重复。')
  for (const section of shell.sections) if ([section.topVertexId, section.shoulderVertexId, section.kneeVertexId, section.footVertexId].some(v => !Object.hasOwn(shell.verticesMm, v))) fail('侧壳完整剖面节点缺失。')
}))

export type RockShell = z.infer<typeof shape>
export type RockShellPoint = RockShell['verticesMm'][string]
export type RockShellSection = RockShell['sections'][number]
export type RockShellFace = RockShell['faces'][string]
export interface RockShellHost {
  id: string; floorId: string; boundaryMm: TerrainPoint[]; groundElevationMm: number; rockBody: { baseElevationMm: number }
}
export interface CreateRockShellIntent {
  footSurfaceRef: SurfaceRef; footElevationMm: number; widthMm: number; direction: PointMm; seed: string
  excludedSegmentIds: string[]
  /** Caller must list every strip source and endpoint-edge dependency. */
  requiredExcludedSegmentIds?: string[]
}
export interface RockShellIssue { code: string; message: string }
export interface RockShellSample {
  inside: true; hostAreaId: string; faceId: string; sourceSegmentId: string; zMm: number
  normal: { x: number; y: number; z: number }; walkable: false
}
export interface RockShellTriangle { faceId: string; sourceSegmentId: string; verticesMm: [RockShellPoint, RockShellPoint, RockShellPoint] }
