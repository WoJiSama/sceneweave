import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import { z } from 'zod'
import type { PointMm, BoundsMm } from '../model/scene.js'
import type { PolygonWithHoles } from '../geometry/polygon-boolean.js'
import { captureJson, canonicalJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { assertSimpleVisualPolyline } from '../visual/geometry.js'
import { distanceToTerrainSegment, simplifyTerrainContour, terrainValueNoise } from './field.js'

const Q = 1_000_000, COORDINATE = 1_000_000_000
export const TERRAIN_COMPOSITION_LIMITS = Object.freeze({ features: 128, members: 128, gridNodes: 65536,
  gridAxis: 512, rawContourPoints: 65536, ringPoints: 512, outputPoints: 8192, polygons: 128, metadataBytes: 4 * 1024 * 1024 })
export type TerrainCompositionField = 'land' | 'elevation' | 'vegetation'
export type TerrainThresholdField = Exclude<TerrainCompositionField, 'vegetation'>
export class TerrainCompositionError extends Error {
  constructor(readonly code: string, message: string) { super(`地貌组合拒绝[${code}]: ${message}`); this.name = 'TerrainCompositionError' }
}
const reject = (code: string, message: string): never => { throw new TerrainCompositionError(code, message) }
const int = z.number().finite().refine(Number.isSafeInteger, '必须为安全整数')
const coordinate = int.refine(value => Math.abs(value) <= COORDINATE, '坐标超过±1e9mm')
const positive = int.refine(value => value > 0 && value <= COORDINATE, '必须为正整数且不超过1e9')
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const pointSchema = z.object({ x: coordinate, y: coordinate }).strict()
const boundsSchema = z.object({ x: coordinate, y: coordinate, width: positive, height: positive }).strict()
const precisionSchema = z.object({ sampleSpacingMm: positive, toleranceMm: positive, noiseCellMm: positive }).strict()
const ellipseSchema = z.object({ kind: z.literal('ellipse'), centerMm: pointSchema, radiusXMm: positive, radiusYMm: positive, rotationMilliDeg: int.min(0).max(359999) }).strict()
const corridorSchema = z.object({ kind: z.literal('corridor'), pointsMm: z.array(pointSchema).min(2).max(32), widthMm: positive }).strict()
const featureCommon = { id, floorId: id, layerId: id, visibility: z.enum(['public', 'gm']), editLocked: z.boolean(), elevationMm: coordinate,
  roughnessPpm: int.min(0).max(Q), seedKey: z.string().min(1).max(128) }
export const terrainCompositionFeatureSchema = z.union([
  z.object({ ...featureCommon, kind: z.enum(['landmass', 'lakeBasin', 'forest', 'clearing', 'plateau']), shape: ellipseSchema }).strict(),
  z.object({ ...featureCommon, kind: z.enum(['riverValley', 'ridge']), shape: corridorSchema }).strict(),
])
export const terrainCompositionMemberSchema = z.object({ featureId: id, field: z.enum(['land', 'elevation', 'vegetation']),
  operation: z.enum(['add', 'subtract', 'max']), weightPpm: int.min(1).max(Q) }).strict()
const sourceFields = { algorithmId: z.literal('terrain-compose'), algorithmVersion: z.literal(1), seed: z.string().min(1).max(128),
  precision: precisionSchema, boundsMm: boundsSchema, baseElevationMm: coordinate, members: z.array(terrainCompositionMemberSchema).min(1).max(128),
  features: z.record(id, terrainCompositionFeatureSchema) }
export const terrainCompositionSourceSchema = z.object(sourceFields).strict()
const gridSchema = z.object({ originMm: pointSchema, columns: int.min(2).max(512), rows: int.min(2).max(512), spacingMm: positive }).strict()
export const terrainCompositionThresholdSchema = z.object({ field: z.enum(['land', 'elevation']), valueQ: int.min(-Q).max(Q),
  targetCoveragePpm: int.min(0).max(Q), grid: gridSchema, sourceInput: terrainCompositionSourceSchema }).strict()
const inputSchema = z.object({ seed: sourceFields.seed, precision: precisionSchema, boundsMm: boundsSchema, baseElevationMm: coordinate,
  members: sourceFields.members, features: sourceFields.features, landCoveragePpm: int.min(0).max(Q), elevationCoveragePpm: int.min(0).max(Q),
  frozenThresholds: z.object({ land: terrainCompositionThresholdSchema.optional(), elevation: terrainCompositionThresholdSchema.optional() }).strict().optional() }).strict()
export type TerrainCompositionFeature = z.infer<typeof terrainCompositionFeatureSchema>
export type TerrainCompositionMember = z.infer<typeof terrainCompositionMemberSchema>
export type TerrainCompositionInput = z.infer<typeof inputSchema>
export type TerrainCompositionSourceInput = z.infer<typeof terrainCompositionSourceSchema>
export type TerrainCompositionGrid = z.infer<typeof gridSchema>
export type TerrainCompositionThreshold = z.infer<typeof terrainCompositionThresholdSchema>
export interface TerrainCompositionFieldPlan {
  polygons: PolygonWithHoles[]
  /** Complete closed rings, without a repeated final point. Holes are explicit. */
  contours: { pointsMm: PointMm[]; hole: boolean; polygonIndex: number }[]
  thresholdQ: number
  sampledCoveragePpm: number
  targetCoveragePpm: number | null
  coverageErrorPpm: number | null
  areaMm2: number
  vertexCount: number
}
export interface TerrainCompositionPlan {
  algorithmId: 'terrain-compose'; algorithmVersion: 1
  input: TerrainCompositionInput
  grid: TerrainCompositionGrid
  fields: Record<TerrainCompositionField, TerrainCompositionFieldPlan>
  thresholds: Partial<Record<TerrainThresholdField, TerrainCompositionThreshold>>
  /** Geometry accounting only; the caller must charge full expanded adoption cost. */
  geometryBudget: { gridNodes: number; polygons: number; rings: number; points: number; finalAdoptionCostChecked: false }
}
const fields: TerrainCompositionField[] = ['land', 'elevation', 'vegetation']
const allowed: Record<TerrainCompositionFeature['kind'], TerrainCompositionField[]> = { landmass: ['land'], lakeBasin: ['land'],
  riverValley: ['land', 'elevation'], ridge: ['elevation'], forest: ['vegetation'], clearing: ['vegetation'], plateau: ['elevation'] }
const same = (a: PointMm, b: PointMm): boolean => a.x === b.x && a.y === b.y
const inBounds = (p: PointMm, b: BoundsMm): boolean => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height
const signedVisualArea = (ring: PointMm[]): number => Number(ring.reduce((sum, point, i) => { const next = ring[(i + 1) % ring.length]; return sum + BigInt(point.x) * BigInt(next.y) - BigInt(next.x) * BigInt(point.y) }, 0n)) / 2
const sourceOf = (input: TerrainCompositionInput): TerrainCompositionSourceInput => ({ algorithmId: 'terrain-compose', algorithmVersion: 1,
  seed: input.seed, precision: input.precision, boundsMm: input.boundsMm, baseElevationMm: input.baseElevationMm, members: input.members,
  features: Object.fromEntries(Object.entries(input.features).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) })

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  let owned: unknown
  try { owned = captureJson(raw) } catch (error) { return reject('INVALID_INPUT', error instanceof Error ? error.message : '非JSON输入。') }
  const result = schema.safeParse(owned)
  if (!result.success) return reject('INVALID_INPUT', result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 1500))
  return result.data
}
function checkSource(input: TerrainCompositionSourceInput): void {
  const b = input.boundsMm
  if (b.x + b.width > COORDINATE || b.y + b.height > COORDINATE) reject('INVALID_BOUNDS', '范围终点超过坐标保护值。')
  if (Object.keys(input.features).length > 128) reject('FEATURE_LIMIT', '特征字典超过128项。')
  for (const [key, feature] of Object.entries(input.features)) {
    if (key !== feature.id) reject('FEATURE_ID', '特征字典键必须等于id。')
    const points = feature.shape.kind === 'ellipse' ? [feature.shape.centerMm] : feature.shape.pointsMm
    if (points.some(point => !inBounds(point, b))) reject('FEATURE_BOUNDS', `特征${key}控制点位于候选范围外。`)
    if (feature.shape.kind === 'corridor' && feature.shape.pointsMm.some((point, index, points) => index > 0 && same(point, points[index - 1]))) reject('DEGENERATE_FEATURE', `特征${key}含零长控制段。`)
  }
  let floorId: string | undefined
  const keys = new Set<string>()
  for (const member of input.members) {
    const feature = input.features[member.featureId], key = `${member.featureId}\0${member.field}`
    if (!feature) reject('FEATURE_REFERENCE', `缺少特征${member.featureId}。`)
    if (keys.has(key)) reject('DUPLICATE_MEMBER', '同一特征与场不能重复。')
    if (!allowed[feature.kind].includes(member.field)) reject('FEATURE_FIELD', `特征${feature.kind}不能写入${member.field}。`)
    if (floorId !== undefined && feature.floorId !== floorId) reject('FLOOR_MISMATCH', '组合成员必须位于同Floor。')
    floorId = feature.floorId; keys.add(key)
  }
  if (encodeUtf8(canonicalJson(input)).length > TERRAIN_COMPOSITION_LIMITS.metadataBytes) reject('METADATA_LIMIT', '完整冻结来源超过4MiB。')
}
function gridFor(input: TerrainCompositionSourceInput): TerrainCompositionGrid {
  const spacingMm = input.precision.sampleSpacingMm, columns = Math.ceil(input.boundsMm.width / spacingMm) + 1, rows = Math.ceil(input.boundsMm.height / spacingMm) + 1
  if (columns > 512 || rows > 512 || columns * rows > 65536) reject('GRID_LIMIT', '临时格网超过65536节点或512单轴上限；须显式降低精度。')
  return { originMm: { x: input.boundsMm.x, y: input.boundsMm.y }, columns, rows, spacingMm }
}

/** The stream key contains feature identity and seedKey, never dictionary or member indexes. */
function featureSupport(input: TerrainCompositionSourceInput, feature: TerrainCompositionFeature, p: PointMm): number {
  const stream = `${feature.id}\0${feature.seedKey}`, cell = input.precision.noiseCellMm, roughness = feature.roughnessPpm / Q
  const size = feature.shape.kind === 'ellipse' ? Math.min(feature.shape.radiusXMm, feature.shape.radiusYMm) : feature.shape.widthMm / 2
  const warp = size * .18 * roughness
  const x = p.x + warp * terrainValueNoise(input.seed, `${stream}/warp-x`, p.x / (cell * 2), p.y / (cell * 2))
  const y = p.y + warp * terrainValueNoise(input.seed, `${stream}/warp-y`, p.x / (cell * 2), p.y / (cell * 2))
  let distance: number
  if (feature.shape.kind === 'ellipse') {
    const shape = feature.shape, angle = shape.rotationMilliDeg * Math.PI / 180000, dx = x - shape.centerMm.x, dy = y - shape.centerMm.y
    distance = Math.hypot((dx * Math.cos(angle) + dy * Math.sin(angle)) / shape.radiusXMm, (-dx * Math.sin(angle) + dy * Math.cos(angle)) / shape.radiusYMm)
  } else {
    const shape = feature.shape, point = { x, y }
    distance = Math.min(...shape.pointsMm.slice(1).map((b, i) => distanceToTerrainSegment(point, shape.pointsMm[i], b))) / (shape.widthMm / 2)
  }
  const noise = roughness * (.18 * terrainValueNoise(input.seed, `${stream}/structure`, x / (cell * 4), y / (cell * 4))
    + .10 * terrainValueNoise(input.seed, `${stream}/shore`, x / cell, y / cell)
    + .035 * terrainValueNoise(input.seed, `${stream}/detail`, x / (cell / 2), y / (cell / 2)))
  return Math.max(0, Math.min(1, 1 - distance + noise))
}
function evaluator(input: TerrainCompositionSourceInput, field: TerrainCompositionField): (point: PointMm) => number {
  const members = input.members.filter(member => member.field === field)
  return point => {
    let value = 0
    for (const member of members) {
      const feature = input.features[member.featureId], elevation = field === 'elevation' ? (feature.elevationMm - input.baseElevationMm) / 10000 : 1
      const contribution = featureSupport(input, feature, point) * member.weightPpm / Q * elevation
      if (member.operation === 'add') value += contribution
      else if (member.operation === 'subtract') value -= contribution
      else value = Math.max(value, contribution)
    }
    // Monotonic bounded encoding avoids clipping large sums or making extrema unselectable.
    return Math.max(-Q + 1, Math.min(Q - 1, Math.round(value / (1 + Math.abs(value)) * Q)))
  }
}
/** Returns the unthresholded quantized signed field, independently of plan/frozen thresholds. */
export function evaluateCompositionField(rawInput: unknown, field: TerrainCompositionField, rawPoint: PointMm): number {
  if (!fields.includes(field)) return reject('FIELD', '未知地貌场。')
  const owned = parse(z.union([inputSchema, terrainCompositionSourceSchema]), rawInput)
  const input = 'algorithmId' in owned ? owned : sourceOf(owned), point = parse(pointSchema, rawPoint)
  checkSource(input)
  return evaluator(input, field)(point)
}
interface Samples { values: Int32Array; withinBounds: number[] }
function sample(input: TerrainCompositionSourceInput, field: TerrainCompositionField, grid: TerrainCompositionGrid): Samples {
  const values = new Int32Array(grid.columns * grid.rows), withinBounds: number[] = [], at = evaluator(input, field)
  for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.columns; x++) {
    const point = { x: grid.originMm.x + x * grid.spacingMm, y: grid.originMm.y + y * grid.spacingMm }, value = at(point)
    values[y * grid.columns + x] = value
    if (inBounds(point, input.boundsMm)) withinBounds.push(value)
  }
  return { values, withinBounds }
}
function thresholdFor(values: number[], targetCoveragePpm: number): number {
  const sorted = values.slice().sort((a, b) => b - a), target = sorted.length * targetCoveragePpm / Q
  // Explicit empty/full candidates are required: a target of zero must not
  // retain the highest sampled plateau, and a target of one must include the
  // minimum plateau. Thresholds remain within the persisted [-Q,Q] range.
  let bestValue = sorted[0], bestError = target, count = 0
  for (let i = 0; i < sorted.length;) {
    const value = sorted[i]
    while (i < sorted.length && sorted[i] === value) { count++; i++ }
    // A midpoint avoids artificial sub-millimetre slivers at sampled values.
    const threshold = i < sorted.length ? Math.floor((value + sorted[i]) / 2) : value - 1, error = Math.abs(count - target)
    if (error < bestError || error === bestError && (Math.abs(threshold) < Math.abs(bestValue) || Math.abs(threshold) === Math.abs(bestValue) && threshold > bestValue)) { bestError = error; bestValue = threshold }
  }
  return bestValue
}
/** Cold readers recompute valueQ from its complete frozen source; a matching hash alone is insufficient. */
export function recomputeCompositionThreshold(rawSourceInput: unknown, field: TerrainThresholdField, targetCoveragePpm: number, rawGrid: TerrainCompositionGrid): number {
  if (field !== 'land' && field !== 'elevation') return reject('FIELD', '只有land/elevation支持覆盖阈值。')
  const source = parse(terrainCompositionSourceSchema, rawSourceInput), grid = parse(gridSchema, rawGrid)
  const target = parse(int.min(0).max(Q), targetCoveragePpm)
  checkSource(source)
  if (canonicalJson(grid) !== canonicalJson(gridFor(source))) reject('THRESHOLD_GRID', '阈值格网必须与来源精度/范围精确一致。')
  if (!source.members.some(member => member.field === field)) reject('EMPTY_THRESHOLD_FIELD', '阈值来源缺少对应场成员。')
  return thresholdFor(sample(source, field, grid).withinBounds, target)
}

type FloatPoint = [number, number]
type Node = { key: string; point: FloatPoint; value: number; index: number }
const floatArea = (ring: FloatPoint[]): number => {
  const [ox, oy] = ring[0]
  return ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]; return sum + (point[0] - ox) * (next[1] - oy) - (next[0] - ox) * (point[1] - oy) }, 0) / 2
}
const floatInside = (p: FloatPoint, ring: FloatPoint[]): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < (ring[j][0] - ring[i][0]) * (p[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside
  return inside
}
/** Triangles share exact node/edge identities. Cancelling interior edges preserves holes and boundary closure. */
function extractPolygons(input: TerrainCompositionSourceInput, grid: TerrainCompositionGrid, values: Int32Array, thresholdQ: number): PolygonWithHoles[] {
  const edges = new Map<string, { from: Node; to: Node }>(), interpolated = new Map<string, Node>()
  const node = (x: number, y: number): Node => { const index = y * grid.columns + x; return { key: `v${index}`, point: [grid.originMm.x + x * grid.spacingMm, grid.originMm.y + y * grid.spacingMm], value: values[index] - thresholdQ - .5, index } }
  const intersection = (a: Node, b: Node): Node => {
    const [lo, hi] = a.index < b.index ? [a, b] : [b, a], key = `e${lo.index}:${hi.index}`
    let result = interpolated.get(key)
    if (!result) { const t = lo.value / (lo.value - hi.value); result = { key, point: [lo.point[0] + (hi.point[0] - lo.point[0]) * t, lo.point[1] + (hi.point[1] - lo.point[1]) * t], value: 0, index: -1 }; interpolated.set(key, result) }
    return result
  }
  const triangle = (vertices: Node[]) => {
    const ring: Node[] = []
    for (let i = 0; i < vertices.length; i++) {
      const current = vertices[i], previous = vertices[(i + vertices.length - 1) % vertices.length]
      if ((current.value > 0) !== (previous.value > 0)) ring.push(intersection(previous, current))
      if (current.value > 0) ring.push(current)
    }
    for (let i = 0; i < ring.length; i++) {
      const from = ring[i], to = ring[(i + 1) % ring.length], key = from.key < to.key ? `${from.key}/${to.key}` : `${to.key}/${from.key}`, existing = edges.get(key)
      if (existing) { if (existing.from.key !== to.key || existing.to.key !== from.key) reject('AMBIGUOUS_CONTOUR', '格网片内部边方向冲突。'); edges.delete(key) }
      else edges.set(key, { from, to })
    }
  }
  for (let y = 0; y < grid.rows - 1; y++) for (let x = 0; x < grid.columns - 1; x++) {
    const a = node(x, y), b = node(x + 1, y), c = node(x + 1, y + 1), d = node(x, y + 1)
    triangle([a, b, c]); triangle([a, c, d])
  }
  if (!edges.size) return []
  if (edges.size > TERRAIN_COMPOSITION_LIMITS.rawContourPoints) reject('CONTOUR_LIMIT', '完整原始轮廓超过65536点。')
  const outgoing = new Map<string, { from: Node; to: Node }>(), incoming = new Set<string>()
  for (const edge of edges.values()) {
    if (outgoing.has(edge.from.key) || incoming.has(edge.to.key)) reject('AMBIGUOUS_CONTOUR', '分量仅在一点接触，无法证明独立简单环。')
    outgoing.set(edge.from.key, edge); incoming.add(edge.to.key)
  }
  const rings: FloatPoint[][] = []
  while (outgoing.size) {
    const first = outgoing.keys().next().value as string, ring: FloatPoint[] = []; let current = first
    do {
      const edge = outgoing.get(current)
      if (!edge) return reject('OPEN_CONTOUR', '存在未闭合的格网边界。')
      outgoing.delete(current); ring.push(edge.from.point); current = edge.to.key
    } while (current !== first)
    if (ring.length < 3 || floatArea(ring) === 0) reject('DEGENERATE_CONTOUR', '提取到退化分量。')
    rings.push(ring)
  }
  const outer = rings.filter(ring => floatArea(ring) > 0), holes = rings.filter(ring => floatArea(ring) < 0)
  const polygons: MultiPolygon = outer.map(ring => [ring])
  for (const hole of holes) {
    const candidates = outer.map((ring, i) => ({ ring, i, area: floatArea(ring) })).filter(value => floatInside(hole[0], value.ring)).sort((a, b) => a.area - b.area)
    if (!candidates.length) reject('ORPHAN_HOLE', '孔洞缺少外环。')
    polygons[candidates[0].i].push(hole)
  }
  const b = input.boundsMm, rectangle: MultiPolygon = [[[[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]]]]
  let clipped: MultiPolygon
  try { clipped = polygonClipping.intersection(polygons, rectangle) } catch { return reject('CLIP_FAILURE', '完整轮廓裁切失败。') }
  return normalizePolygons(clipped, input.precision.toleranceMm)
}
function canonicalRing(points: PointMm[], positive: boolean): PointMm[] {
  const ring = points.map(point => ({ ...point }))
  if ((signedVisualArea(ring) > 0) !== positive) ring.reverse()
  let first = 0
  for (let i = 1; i < ring.length; i++) if (ring[i].x < ring[first].x || ring[i].x === ring[first].x && ring[i].y < ring[first].y) first = i
  return ring.slice(first).concat(ring.slice(0, first))
}
const compareRing = (a: PointMm[], b: PointMm[]): number => a[0].x - b[0].x || a[0].y - b[0].y || a.length - b.length || signedVisualArea(a) - signedVisualArea(b)
const cross = (a: PointMm, b: PointMm, c: PointMm): bigint => BigInt(b.x - a.x) * BigInt(c.y - a.y) - BigInt(b.y - a.y) * BigInt(c.x - a.x)
const onSegment = (a: PointMm, b: PointMm, p: PointMm): boolean => cross(a, b, p) === 0n && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
function intersects(a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b)
  return (ac === 0n && onSegment(a, b, c)) || (ad === 0n && onSegment(a, b, d)) || (ca === 0n && onSegment(c, d, a)) || (cb === 0n && onSegment(c, d, b))
    || (ac < 0n) !== (ad < 0n) && (ca < 0n) !== (cb < 0n)
}
function validatePolygonTopology(polygons: PolygonWithHoles[]): void {
  const all = polygons.flatMap((polygon, polygonIndex) => [polygon.outer, ...polygon.holes].map((ring, ringIndex) => ({ ring, polygonIndex, hole: ringIndex > 0 })))
  for (const { ring } of all) {
    const origin = ring[0]
    try { assertSimpleVisualPolyline(ring.map(p => ({ x: p.x - origin.x, y: p.y - origin.y })), true) } catch { reject('QUANTIZATION_TOPOLOGY', '毫米量化/简化使完整轮廓退化或自相交。') }
    if (ring.length < 3 || signedVisualArea(ring) === 0 || new Set(ring.map(p => `${p.x}/${p.y}`)).size !== ring.length) reject('QUANTIZATION_TOPOLOGY', '毫米量化/简化合并了轮廓顶点。')
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i].ring, b = all[j].ring
    for (let x = 0; x < a.length; x++) for (let y = 0; y < b.length; y++) if (intersects(a[x], a[(x + 1) % a.length], b[y], b[(y + 1) % b.length])) reject('QUANTIZATION_TOPOLOGY', '轮廓相交或接触，不能保全分量与孔洞。')
  }
  for (const polygon of polygons) {
    const outer = polygon.outer.map(p => [p.x, p.y] as FloatPoint)
    for (let i = 0; i < polygon.holes.length; i++) {
      const hole = polygon.holes[i]
      if (!floatInside([hole[0].x, hole[0].y], outer)) reject('QUANTIZATION_TOPOLOGY', '简化/量化使孔洞越出外环。')
      for (let j = i + 1; j < polygon.holes.length; j++) if (floatInside([hole[0].x, hole[0].y], polygon.holes[j].map(p => [p.x, p.y])) || floatInside([polygon.holes[j][0].x, polygon.holes[j][0].y], hole.map(p => [p.x, p.y]))) reject('QUANTIZATION_TOPOLOGY', '孔洞相互包含。')
    }
  }
  for (let i = 0; i < polygons.length; i++) for (let j = 0; j < polygons.length; j++) if (i !== j) {
    const p = polygons[i].outer[0], other = polygons[j]
    if (floatInside([p.x, p.y], other.outer.map(p => [p.x, p.y])) && !other.holes.some(hole => floatInside([p.x, p.y], hole.map(p => [p.x, p.y])))) reject('QUANTIZATION_TOPOLOGY', '简化/量化使独立分量互相包含。')
  }
}
function normalizePolygons(raw: MultiPolygon, toleranceMm: number): PolygonWithHoles[] {
  if (raw.length > TERRAIN_COMPOSITION_LIMITS.polygons) reject('COMPONENT_LIMIT', '完整输出超过128个分量。')
  let rawPointCount = 0
  const quantize = (ring: FloatPoint[]): PointMm[] => {
    const points = ring.slice()
    if (points.length > 1 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]) points.pop()
    rawPointCount += points.length
    if (rawPointCount > 65536) reject('CONTOUR_LIMIT', '裁切后的完整轮廓超过65536点。')
    if (points.length < 3 || points.some(p => !p.every(Number.isFinite))) reject('DEGENERATE_CONTOUR', '裁切输出包含退化轮廓。')
    // Adjacent samples may quantize to the same boundary vertex. Coalescing
    // that vertex changes no integer geometry; never drop a component/hole.
    const rounded = points.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }))
    const result = rounded.filter((point, i) => !same(point, rounded[(i + rounded.length - 1) % rounded.length]))
    if (result.length < 3) reject('QUANTIZATION_TOPOLOGY', '毫米量化使分量或孔洞消失。')
    if ((floatArea(points) > 0) !== (signedVisualArea(result) > 0)) reject('QUANTIZATION_TOPOLOGY', '毫米量化改变了环方向。')
    return result
  }
  const quantized = raw.map(polygon => ({ outer: quantize(polygon[0]), holes: polygon.slice(1).map(quantize) }))
  validatePolygonTopology(quantized)
  // A small ring may collapse at the requested tolerance. Retry only with a
  // smaller error bound; never erase a component or loosen the caller's error.
  let result = quantized
  for (let attempt = 0; attempt < 12; attempt++) {
    const tolerance = toleranceMm / 2 ** attempt
    const simplify = (ring: PointMm[]): PointMm[] => simplifyTerrainContour({ points: ring, closed: true }, tolerance)
    try {
      const candidate = quantized.map(polygon => ({ outer: simplify(polygon.outer), holes: polygon.holes.map(simplify) }))
      validatePolygonTopology(candidate)
      result = candidate
      break
    } catch { /* Keep the complete quantized geometry if no smaller bound works. */ }
  }
  let count = 0
  for (const polygon of result) for (const ring of [polygon.outer, ...polygon.holes]) {
    if (ring.length > 512) reject('RING_POINT_LIMIT', '误差范围内的完整环超过512点。')
    count += ring.length
  }
  if (count > 8192) reject('OUTPUT_POINT_LIMIT', '误差范围内的完整输出超过8192点。')
  result = result.map(polygon => ({ outer: canonicalRing(polygon.outer, true), holes: polygon.holes.map(hole => canonicalRing(hole, false)).sort(compareRing) }))
  return result.sort((a, b) => compareRing(a.outer, b.outer))
}

/** Pure preview. No document writes, entity identity allocation, adoption-cost exemption or hidden retry. */
export function planTerrainComposition(rawInput: unknown): TerrainCompositionPlan {
  const input = parse(inputSchema, rawInput), source = sourceOf(input)
  checkSource(source)
  const grid = gridFor(source), thresholds: TerrainCompositionPlan['thresholds'] = {}, result = {} as TerrainCompositionPlan['fields']
  for (const field of fields) {
    const active = source.members.some(member => member.field === field), target = field === 'land' ? input.landCoveragePpm : field === 'elevation' ? input.elevationCoveragePpm : null
    const samples = active ? sample(source, field, grid) : { values: new Int32Array(0), withinBounds: [] }, frozen = field !== 'vegetation' ? input.frozenThresholds?.[field] : undefined
    let thresholdQ = 0
    if (frozen) {
      if (!active || frozen.field !== field || frozen.targetCoveragePpm !== target) reject('FROZEN_THRESHOLD', '冻结阈值与目标场/覆盖率不一致。')
      checkSource(frozen.sourceInput)
      if (canonicalJson(frozen.grid) !== canonicalJson(grid) || frozen.sourceInput.seed !== source.seed || frozen.sourceInput.baseElevationMm !== source.baseElevationMm
        || canonicalJson(frozen.sourceInput.precision) !== canonicalJson(source.precision) || canonicalJson(frozen.sourceInput.boundsMm) !== canonicalJson(source.boundsMm)) reject('FROZEN_THRESHOLD', '局部候选不能改变冻结范围、精度、种子或基准高程。')
      if (recomputeCompositionThreshold(frozen.sourceInput, frozen.field, frozen.targetCoveragePpm, frozen.grid) !== frozen.valueQ) reject('FROZEN_THRESHOLD', '冻结valueQ与完整来源重算不一致。')
      thresholdQ = frozen.valueQ; thresholds[field as TerrainThresholdField] = frozen
    } else if (active && field !== 'vegetation') {
      thresholdQ = thresholdFor(samples.withinBounds, target!)
      thresholds[field] = { field, valueQ: thresholdQ, targetCoveragePpm: target!, grid, sourceInput: source }
    }
    const polygons = active ? extractPolygons(source, grid, samples.values, thresholdQ) : [], contours = polygons.flatMap((polygon, polygonIndex) => [
      { pointsMm: polygon.outer, hole: false, polygonIndex }, ...polygon.holes.map(pointsMm => ({ pointsMm, hole: true, polygonIndex }))])
    const sampledCoveragePpm = active ? Math.round(samples.withinBounds.filter(value => value > thresholdQ).length / samples.withinBounds.length * Q) : 0
    result[field] = { polygons, contours, thresholdQ, sampledCoveragePpm, targetCoveragePpm: target, coverageErrorPpm: target === null ? null : sampledCoveragePpm - target,
      areaMm2: polygons.reduce((sum, polygon) => sum + Math.abs(signedVisualArea(polygon.outer)) - polygon.holes.reduce((holes, hole) => holes + Math.abs(signedVisualArea(hole)), 0), 0),
      vertexCount: contours.reduce((sum, contour) => sum + contour.pointsMm.length, 0) }
  }
  const plans = Object.values(result), points = plans.reduce((sum, field) => sum + field.vertexCount, 0)
  if (points > 8192) reject('OUTPUT_POINT_LIMIT', '全部场的完整输出合计超过8192点。')
  return freezeJson({ algorithmId: 'terrain-compose', algorithmVersion: 1, input, grid, fields: result, thresholds,
    geometryBudget: { gridNodes: grid.columns * grid.rows, polygons: plans.reduce((sum, field) => sum + field.polygons.length, 0),
      rings: plans.reduce((sum, field) => sum + field.contours.length, 0), points, finalAdoptionCostChecked: false } })
}

/** A fixed derived physical band. Its complete polygon is persisted by the materializer. */
export function extractCompositionFieldLevel(rawSource:unknown,field:TerrainCompositionField,valueQ:number):PolygonWithHoles[]{
 const source=parse(terrainCompositionSourceSchema,rawSource);checkSource(source)
 if(!fields.includes(field)||!Number.isSafeInteger(valueQ)||valueQ< -Q||valueQ>Q)reject('FIELD_LEVEL','固定分带阈值无效。')
 const grid=gridFor(source),samples=sample(source,field,grid)
 return freezeJson(extractPolygons(source,grid,samples.values,valueQ))
}
