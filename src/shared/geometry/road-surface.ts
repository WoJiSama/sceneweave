import { z } from 'zod'
import type { Path, PointMm } from '../model/scene.js'
import { defaultStaircase } from '../stairs/contracts.js'
import { planStaircase, staircasePointAt } from '../stairs/geometry.js'
import { int, point } from '../validation/primitives.js'
import { reliefBounds } from './terrain-relief.js'

export const ROAD_PPM = 1_000_000
export const AUTOMATIC_ROAD_VERSION = 'terrain-road3'
export const AUTOMATIC_ROAD_MAX_FIXED_POINTS = 12
export const ROAD_STATION_LIMIT = 512
export const ROAD_RISER_LIMIT_MM = 198
export const ROAD_LANDING_LENGTH_MM = 1500
export const ROAD_LANDING_MIN_MM = 850
export const ROAD_LANDING_MAX_MM = 4000
export const ROAD_MIN_GOING_MM = 240
export const ROAD_SHOULDER_LIMIT_MM = 500
export const ROAD_SURFACE_DEPTH_MM = 980
export class RoadFootprintConflict extends Error {
  constructor(message: string, readonly shoulderMm?: number) { super(message) }
}
export const ROAD_PROFILE_KINDS = ['trail', 'landing', 'tread'] as const
const coordinatePair = z.tuple([int, int])
const shoulder = z.number().int().min(0).max(ROAD_SHOULDER_LIMIT_MM)

const roadStationSchema = z.object({
  atPpm: z.number().int().min(0).max(ROAD_PPM),
  kind: z.enum(ROAD_PROFILE_KINDS),
  inZMm: coordinatePair,
  outZMm: coordinatePair.optional(),
  shoulderMm: z.tuple([shoulder, shoulder]),
  bankZMm: coordinatePair,
}).strict()

export const roadSurfaceSchema = z.object({
  version: z.literal(1),
  stations: z.array(roadStationSchema).min(2).max(ROAD_STATION_LIMIT),
}).strict().refine(({ stations }) => stations[0]?.atPpm === 0 && stations.at(-1)?.atPpm === ROAD_PPM
  && stations.every((row, i) => (!i || row.atPpm > stations[i - 1].atPpm) && (i > 0 && i < stations.length - 1 || !row.outZMm)), '道路断面须完整、按路线顺序排列，且两端连续接地。')

export const roadLandingSchema = z.object({ pointMm: point, lengthMm: z.number().int().min(ROAD_LANDING_MIN_MM).max(ROAD_LANDING_MAX_MM), elevationMm: int }).strict()
const roadIntentFields = { fixedPointsMm: z.array(point).min(2).max(AUTOMATIC_ROAD_MAX_FIXED_POINTS), automaticStairs: z.boolean() }
export const automaticRouteSchema = z.discriminatedUnion('algorithm', [
  z.object({ algorithm: z.enum(['terrain-road1', 'terrain-road2']), ...roadIntentFields }).strict(),
  z.object({ algorithm: z.literal(AUTOMATIC_ROAD_VERSION), ...roadIntentFields,
    landings: z.array(roadLandingSchema).max(AUTOMATIC_ROAD_MAX_FIXED_POINTS - 2).optional() }).strict(),
])
export type AutomaticRoute = z.infer<typeof automaticRouteSchema>
export type RoadSurface = z.infer<typeof roadSurfaceSchema>
export type RoadStation = z.infer<typeof roadStationSchema>
export type RoadLanding = z.infer<typeof roadLandingSchema>
export type RoadSpanKind = typeof ROAD_PROFILE_KINDS[number]
export type RoadVertex = PointMm & { z: number }
export type RoadSection = [PointMm, PointMm, PointMm, PointMm]
export type RoadRow = [RoadVertex, RoadVertex, RoadVertex, RoadVertex]
export type RoadSpan = { kind: RoadSpanKind; start: RoadRow; end: RoadRow; aPpm: number; bPpm: number }
export type RoadRiser = { lower: RoadRow; upper: RoadRow; ascending: boolean; atPpm: number }

export const toRoadPpm = (distance: number, length: number) => Math.round(distance / length * ROAD_PPM)
export const pointPair = <T>(value: (side: 0 | 1) => T): [T, T] => [value(0), value(1)]
const cross = (a: PointMm, b: PointMm, p: PointMm) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y

/** The stair frame already owns miter joins and independently authored local widths. */
export function roadSurfaceFrame(path: Pick<Path, 'centerlineMm' | 'widthMm' | 'widthSections'>) {
  const config = { ...defaultStaircase(), layout: { kind: 'stretch' as const, stepCount: 1 } }
  const frame = planStaircase(path.centerlineMm, path.widthMm, config, path.widthSections)
  const knots = new Map(frame.sections.map(s => [toRoadPpm(s.distanceMm, frame.lengthMm), s.distanceMm]))
  const distance = (ppm: number) => knots.get(ppm) ?? ppm / ROAD_PPM * frame.lengthMm
  const pointAt = (ppm: number, lateral = 0) => staircasePointAt(frame, distance(ppm), lateral)
  const sectionAt = (ppm: number, [rightMm, leftMm]: readonly [number, number]): RoadSection => {
    const right = pointAt(ppm, -.5), left = pointAt(ppm, .5)
    const len = Math.hypot(left.x - right.x, left.y - right.y)
    const dx = (left.x - right.x) / len, dy = (left.y - right.y) / len
    return [{ x: right.x - dx * rightMm, y: right.y - dy * rightMm }, right, left, { x: left.x + dx * leftMm, y: left.y + dy * leftMm }]
  }
  if (knots.size !== frame.sections.length) throw new Error('道路转弯或宽度过渡之间的断面距离太短。')
  return { length: frame.lengthMm, knots, distance, pointAt, sectionAt, coreMm: frame.footprintMm }
}

function ring(rows: RoadRow[], right: 0 | 1, left: 2 | 3) {
  const points = [...rows.map(row => row[right]), ...rows.toReversed().map(row => row[left])]
  const reduced: PointMm[] = []
  for (const { x, y } of points) {
    const p = { x, y }
    if (reduced.length && same(p, reduced.at(-1)!)) continue
    while (reduced.length > 1) {
      const a = reduced.at(-2)!, b = reduced.at(-1)!
      if (Math.abs(cross(a, b, p)) > .0001 || (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) < 0) break
      reduced.pop()
    }
    reduced.push(p)
  }
  if (reduced.length && same(reduced[0], reduced.at(-1)!)) reduced.pop()
  const area = reduced.reduce((sum, a, i) => sum + cross(reduced[0], a, reduced[(i + 1) % reduced.length]), 0)
  return area > 0 ? reduced : reduced.reverse()
}

export function buildRoadSurface(path: Pick<Path, 'centerlineMm' | 'widthMm' | 'widthSections'>, surface: RoadSurface) {
  const frame = roadSurfaceFrame(path), stations = surface.stations
  const rows = stations.map(station => {
    const xy = frame.sectionAt(station.atPpm, station.shoulderMm)
    const vertices = (z: [number, number]): RoadRow => [
      { ...xy[0], z: station.bankZMm[0] }, { ...xy[1], z: z[0] }, { ...xy[2], z: z[1] }, { ...xy[3], z: station.bankZMm[1] },
    ]
    const before = vertices(station.inZMm)
    return { before, after: station.outZMm ? vertices(station.outZMm) : before }
  })
  const spans = rows.slice(0, -1).map(({ after }, i): RoadSpan => ({ kind: stations[i].kind, start: after, end: rows[i + 1].before, aPpm: stations[i].atPpm, bPpm: stations[i + 1].atPpm }))
  const risers = rows.flatMap(({ before, after }, i): RoadRiser[] => {
    if (before === after) return []
    const ascending = after[1].z > before[1].z
    return [{ lower: ascending ? before : after, upper: ascending ? after : before, ascending, atPpm: stations[i].atPpm }]
  })
  return { spans, risers, footprintMm: ring(rows.map(row => row.before), 0, 3), coreMm: ring(rows.map(row => row.before), 1, 2) }
}
export type RoadSurfaceGeometry = ReturnType<typeof buildRoadSurface>

export function roadSpanTriangles(span: RoadSpan, lane: 0 | 1 | 2): [RoadVertex, RoadVertex, RoadVertex][] {
  const { start, end } = span, [a, b, c, d] = [start[lane], end[lane], end[lane + 1], start[lane + 1]]
  return ([[a, b, c], [a, c, d]] as [RoadVertex, RoadVertex, RoadVertex][]).filter(([a, b, c]) => Math.abs(cross(a, b, c)) > .0001)
}

export function roadFaceNormal([a, b, c]: [RoadVertex, RoadVertex, RoadVertex]) {
  const det = cross(a, b, c)
  const dx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / det
  const dy = ((c.z - a.z) * (b.x - a.x) - (b.z - a.z) * (c.x - a.x)) / det
  const length = Math.hypot(dx, dy, 1)
  return { x: -dx / length, y: -dy / length, z: 1 / length }
}

export function createRoadSurfaceSampler(geometry: RoadSurfaceGeometry) {
  const bounds = reliefBounds(geometry.footprintMm)
  const faces = geometry.spans.toReversed().flatMap(span => ([1, 0, 2] as const).flatMap(lane => roadSpanTriangles(span, lane).map(vertices => ({ vertices, bounds: reliefBounds(vertices), core: lane === 1 }))))
  const contains = (p: PointMm, box: typeof bounds) => p.x >= box.x - .000001 && p.x <= box.x + box.width + .000001 && p.y >= box.y - .000001 && p.y <= box.y + box.height + .000001
  const sample = (p: PointMm) => {
    if (!contains(p, bounds)) return null
    let shoulder: { zMm: number; normal: { x: number; y: number; z: number }; core: boolean } | null = null
    for (const { vertices: [a, b, c], bounds, core } of faces) {
      if (!contains(p, bounds) || shoulder && !core) continue
      const det = cross(a, b, c), u = cross(a, p, c) / det, v = cross(a, b, p) / det
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue
      const hit = { zMm: a.z + u * (b.z - a.z) + v * (c.z - a.z), normal: roadFaceNormal([a, b, c]), core }
      if (core) return hit
      shoulder = hit
    }
    return shoulder
  }
  return { sample, bounds }
}
