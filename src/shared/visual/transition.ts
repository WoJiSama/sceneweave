import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { BoundsMm, Issue, PointMm, SceneDocument, TerrainArea, TerrainConnection, Visibility } from '../model/scene.js'
import { corridor, openingEndpoints, pointInPolygon, polygonsOverlap, propFootprint, supportSurfaceAt, terrainPoints } from '../geometry/geometry.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { visual3TransitionSchema, type TerrainTransition, type TerrainTransitionPolygon, type TerrainTransitionStroke } from '../terrain-generation/composition-contracts.js'
import { assertSimpleVisualPolyline, sampleVisualBoundary } from './geometry.js'
import type { SampledBoundary, VisualBoundary } from './types.js'
import { visualBoundarySchema } from './schema.js'
import { visualBase } from './base.js'

/**
 * T10's transition builder is deliberately a pure, DOM-free geometry boundary.
 * It reads the current scene once, materializes integer-mm geometry, and stores
 * enough hashes for a cold reader to reject stale output. No renderer is
 * allowed to regenerate a transition from a seed.
 */

export interface TerrainTransitionRequest {
  id: string
  floorId?: string
  layerId?: string
  visibility?: Visibility
  editLocked?: boolean
  enabled?: boolean
  boundaryId: string
  kind: TerrainTransition['kind']
  side: TerrainTransition['side']
  widthMm: number
  clipMm: BoundsMm
  sampleSpacingMm?: number
  reachMm?: number
  opacity?: number
}

export interface TerrainDistanceField {
  readonly sampled: SampledBoundary
  readonly clipMm: BoundsMm
  readonly reachMm: number
  readonly sampleSpacingMm: number
  readonly boundaryHash: string
  readonly inputHash: string
  distanceAt(point: PointMm): number
}

export interface TransitionLocalRefreshRequest {
  scopeMm: BoundsMm
  haloMm?: number
  transitionIds?: readonly string[]
}

export interface TransitionLocalRefreshResult {
  transitions: Record<string, TerrainTransition>
  changedIds: string[]
  readBoundsMm: BoundsMm
}

type SurfaceKind = TerrainTransition['leftSurface']
type Polygon = PointMm[]
type SourceSide = { area: TerrainArea | null; reverse: boolean; surface: SurfaceKind; elevationMm: number; sourceId: string }
type Mask = { id: string; visibility: Visibility; polygon: Polygon; kind: 'obstacle' | 'opening' }

const EPS = 1e-7
const HASH_ZERO = '0'.repeat(64)
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const dedupe = (points: PointMm[]): PointMm[] => points.filter((p, i) => i === 0 || !same(p, points[i - 1]))
const quantize = (value: number): number => value < 0 ? -Math.floor(Math.abs(value) + .5) : Math.floor(value + .5)
const qPoint = (p: PointMm): PointMm => ({ x: quantize(p.x), y: quantize(p.y) })
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const edges = (points: Polygon): [PointMm, PointMm][] => points.map((p, i) => [p, points[(i + 1) % points.length]])
const positive = (value: number) => Number.isSafeInteger(value) && value > 0
const area = (points: Polygon) => points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0) / 2
const boundsOf = (points: PointMm[]): BoundsMm => {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 }
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.floor(Math.min(...xs)), y: Math.floor(Math.min(...ys)), width: Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs)), height: Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys)) }
}
const boundsPolygon = (b: BoundsMm): Polygon => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
const boundsOverlap = (a: BoundsMm, b: BoundsMm): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const expandBounds = (b: BoundsMm, amount: number): BoundsMm => ({ x: b.x - amount, y: b.y - amount, width: b.width + amount * 2, height: b.height + amount * 2 })
const unionBounds = (a: BoundsMm, b: BoundsMm): BoundsMm => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), right = Math.max(a.x + a.width, b.x + b.width), bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}
const hash = (value: unknown): string => sha256Text(canonicalJson(value))

const palette: Record<SurfaceKind, string> = {
  water: '#8FC9DC', sand: '#E4C58F', soil: '#A88A68', grass: '#8DBA78', rock: '#9D9B95', path: '#B99B72', forest: '#547C58',
}
const classifyMaterial = (scene: SceneDocument, area: TerrainArea): SurfaceKind | undefined => {
  const materialId = area.surfaceStyle?.base.materialRef.id
  const material = materialId ? scene.materials[materialId] : undefined
  const words = material ? [material.name, ...material.tags].join(' ').toLowerCase() : ''
  if (/(water|sea|lake|river|pond|ocean|浅水|海|湖|河)/.test(words)) return 'water'
  if (/(sand|beach|砂|沙)/.test(words)) return 'sand'
  if (/(soil|earth|mud|dirt|土|泥)/.test(words)) return 'soil'
  if (/(forest|wood|tree|林|森)/.test(words)) return 'forest'
  if (/(grass|meadow|moss|草|苔)/.test(words)) return 'grass'
  if (/(rock|stone|cliff|岩|石)/.test(words)) return 'rock'
  if (/(path|road|trail|路|道)/.test(words)) return 'path'
  return undefined
}

const sceneVisual3 = (scene: SceneDocument) => {
  if (scene.schemaVersion !== 4 || scene.visual?.version !== 3) throw new Error('T10过渡必须在严格scene4/visual3工程中生成。')
  return scene.visual
}
const visualBoundary = (scene: SceneDocument, id: string): VisualBoundary => {
  const visual = sceneVisual3(scene), boundary = visual.base.base.boundaries[id]
  if (!boundary) throw new Error(`过渡引用的边界不存在：${id}`)
  visualBoundarySchema.parse(boundary)
  return boundary
}
const floor = (scene: SceneDocument, id: string) => own(scene.floors, id) ?? (() => { throw new Error(`过渡Floor不存在：${id}`) })()

function areaAtBinding(scene: SceneDocument, boundary: VisualBoundary, reverse: boolean, side: { areaId: string; startPointId: string; endPointId: string; reverse: boolean }, sampled: SampledBoundary): SourceSide {
  const area = own(scene.terrainAreas, side.areaId)
  if (!area || area.floorId !== boundary.floorId) throw new Error(`过渡绑定地形不存在或跨Floor：${side.areaId}`)
  const points = area.boundaryMm
  if (!points.some(p => p.id === side.startPointId) || !points.some(p => p.id === side.endPointId)) throw new Error(`过渡绑定端点不存在：${side.areaId}`)
  const expected = side.reverse ? sampled.points.slice().reverse() : sampled.points
  // The diagnostics path performs the same exact endpoint check; this second
  // check keeps the transition hash independent from a mutable array index.
  if (boundary.closed && side.reverse) { const first = expected.pop()!; expected.unshift(first) }
  const chain = (() => {
    const start = points.findIndex(p => p.id === side.startPointId), end = points.findIndex(p => p.id === side.endPointId)
    if ((start === end) !== boundary.closed) throw new Error('闭合/开放过渡端点标记不一致。')
    const result = [points[start]]; let index = (start + 1) % points.length
    while (index !== end) { result.push(points[index]); index = (index + 1) % points.length; if (result.length > points.length) throw new Error('过渡绑定地形链无法闭合。') }
    if (!boundary.closed) result.push(points[end])
    return result
  })()
  if (chain.length !== expected.length || chain.some((p, i) => !same(p.positionMm, expected[i]))) throw new Error(`过渡边界与持久地形采样不一致：${side.areaId}`)
  const material = classifyMaterial(scene, area)
  if (!material) throw new Error(`无法从地形材质严格推导表面类型：${area.id}`)
  return { area, reverse, surface: material, elevationMm: area.groundElevationMm, sourceId: area.id }
}

function resolveOutside(scene: SceneDocument, boundary: VisualBoundary, sampled: SampledBoundary, source: SourceSide): SourceSide {
  if (!source.area) throw new Error('过渡缺少可解析的地形侧。')
  const sign = source.reverse ? 1 : -1
  for (let i = 0; i < sampled.points.length; i++) for (const factor of [0.1, .25, .5, 1, 2, 4, 8]) {
    const sample = sampled.points[i], normal = sampled.samples[Math.min(i, sampled.samples.length - 1)].normal
    const point = { x: Math.round(sample.x + normal.x * sign * boundary.sampleSpacingMm * factor), y: Math.round(sample.y + normal.y * sign * boundary.sampleSpacingMm * factor) }
    const support = supportSurfaceAt(scene, point, boundary.floorId)
    if (!support || support.kind !== 'terrainArea' || support.id === source.area.id) continue
    const area = own(scene.terrainAreas, support.id), surface = area && classifyMaterial(scene, area)
    if (!area || !surface) throw new Error(`无法从过渡外侧严格推导表面类型：${support.id}`)
    return { area, reverse: !source.reverse, surface, elevationMm: area.groundElevationMm, sourceId: area.id }
  }
  throw new Error(`过渡外侧没有可验证的相邻地形：${source.area.id}`)
}

function resolveSources(scene: SceneDocument, boundary: VisualBoundary, sampled: SampledBoundary): { left: SourceSide; right: SourceSide } {
  if (boundary.binding.kind === 'terrain') {
    const sides = boundary.binding.sides.map(side => areaAtBinding(scene, boundary, side.reverse, side, sampled))
    if (sides.length > 2) throw new Error('过渡最多绑定两侧地形。')
    const left = sides.find(side => !side.reverse)
    const right = sides.find(side => side.reverse)
    if (sides.length === 2 && (!left || !right || left.sourceId === right.sourceId)) throw new Error('共享过渡两侧必须是相反方向的不同地形。')
    if (!left && !right) throw new Error('过渡没有可用地形侧。')
    if (!left) return { left: resolveOutside(scene, boundary, sampled, right!), right: right! }
    if (!right) return { left: left!, right: resolveOutside(scene, boundary, sampled, left) }
    return { left, right }
  }
  if (boundary.binding.kind === 'path') {
    const path = own(scene.paths, boundary.binding.pathId)
    if (!path || path.floorId !== boundary.floorId) throw new Error('过渡绑定道路不存在或跨Floor。')
    if (boundary.visibility === 'public' && path.visibility !== 'public') throw new Error('公开过渡不能引用私密道路。')
    const support = path.supportRefs.find(ref => ref.kind === 'terrainArea' ? !!own(scene.terrainAreas, ref.id) : false)
    const area = support?.kind === 'terrainArea' ? own(scene.terrainAreas, support.id) : undefined
    const surface = area ? classifyMaterial(scene, area) : undefined
    if (!area || !surface) throw new Error(`无法从道路支撑材质严格推导表面类型：${area?.id ?? path.id}`)
    return { left: { area: null, reverse: false, surface: 'path', elevationMm: area.groundElevationMm, sourceId: `path:${path.id}` }, right: { area, reverse: true, surface, elevationMm: area.groundElevationMm, sourceId: area.id } }
  }
  throw new Error('装饰边界没有真实地形/道路来源，不能生成T10过渡。')
}

/** World-space square-cap/miter-limit-2/bevel stroke outline used by both hit testing and renderers. */
export function terrainTransitionStrokePolygon(points: readonly PointMm[], widthMm: number): PointMm[] {
  if (!positive(widthMm) || points.length < 2) return []
  const r = widthMm / 2, p = points.map(point => ({ ...point })), directions = p.slice(1).map((point, i) => {
    const length = Math.hypot(point.x - p[i].x, point.y - p[i].y); return length ? { x: (point.x - p[i].x) / length, y: (point.y - p[i].y) / length } : null
  })
  if (directions.some(value => !value)) return []
  const side = (sign: number): PointMm[] => {
    const first = directions[0]!, last = directions.at(-1)!, result: PointMm[] = [{ x: p[0].x - first.x * r - first.y * r * sign, y: p[0].y - first.y * r + first.x * r * sign }]
    for (let i = 1; i < p.length - 1; i++) {
      const before = directions[i - 1]!, after = directions[i]!, a = { x: p[i].x - before.y * r * sign, y: p[i].y + before.x * r * sign }, b = { x: p[i].x - after.y * r * sign, y: p[i].y + after.x * r * sign }
      const determinant = before.x * after.y - before.y * after.x
      if (Math.abs(determinant) < 1e-12) { if (before.x * after.x + before.y * after.y < 0) return []; result.push(a); continue }
      const t = ((b.x - a.x) * after.y - (b.y - a.y) * after.x) / determinant, intersection = { x: a.x + before.x * t, y: a.y + before.y * t }
      if (Math.hypot(intersection.x - p[i].x, intersection.y - p[i].y) <= 2 * r + EPS) result.push(intersection); else result.push(a, b)
    }
    result.push({ x: p.at(-1)!.x + last.x * r - last.y * r * sign, y: p.at(-1)!.y + last.y * r + last.x * r * sign }); return result
  }
  const left = side(-1), right = side(1); if (!left.length || !right.length) return []
  const result = dedupe([...left, ...right.reverse()].map(qPoint));
  try { assertSimpleVisualPolyline(result, true) } catch { return [] }
  return area(result) < 0 ? result.reverse() : result
}

const connectionPolygon = (scene: SceneDocument, connection: TerrainConnection): Polygon => corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm + 2, true).map(qPoint)
function wallPolygon(scene: SceneDocument, wall: SceneDocument['walls'][string]): Polygon | undefined {
  const a = own(scene.vertices, wall.startVertexId), b = own(scene.vertices, wall.endVertexId); if (!a || !b) return undefined
  return corridor({ x: a.xMm, y: a.yMm }, { x: b.xMm, y: b.yMm }, wall.thicknessMm, true).map(qPoint)
}
function relevantConnection(scene: SceneDocument, boundary: VisualBoundary, connection: TerrainConnection, sourceIds: Set<string>): boolean {
  if (connection.floorId !== boundary.floorId || connection.from.surfaceRef.kind !== 'terrainArea' || connection.to.surfaceRef.kind !== 'terrainArea') return false
  const from = own(scene.terrainAreas, connection.from.surfaceRef.id), to = own(scene.terrainAreas, connection.to.surfaceRef.id)
  if (!from || !to || !sourceIds.has(from.id) || !sourceIds.has(to.id)) return false
  return pointInPolygon(connection.from.positionMm, terrainPoints(from)) && pointInPolygon(connection.to.positionMm, terrainPoints(to))
}

function collectMasks(scene: SceneDocument, boundary: VisualBoundary, sources: { left: SourceSide; right: SourceSide }, influence: Polygon): { masks: Mask[]; sourceIds: string[] } {
  const sourceIds = new Set([sources.left.sourceId, sources.right.sourceId]), masks: Mask[] = [], sourceRecords: string[] = []
  for (const connection of Object.values(scene.terrainConnections).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!relevantConnection(scene, boundary, connection, sourceIds) || connection.blocksMovement) continue
    const polygon = connectionPolygon(scene, connection); if (!polygon.length || !polygonsOverlap(polygon, influence)) continue
    if (connection.visibility === 'gm' && boundary.visibility === 'public') throw new Error(`公开过渡依赖GM连接：${connection.id}`)
    masks.push({ id: connection.id, visibility: connection.visibility, polygon, kind: 'opening' }); sourceRecords.push(`opening:${connection.id}:${hash(connection)}`)
  }
  for (const wall of Object.values(scene.walls).sort((a, b) => a.id.localeCompare(b.id))) {
    if (wall.floorId !== boundary.floorId || (!wall.blocksMovement && !wall.blocksSight)) continue
    const polygon = wallPolygon(scene, wall); if (!polygon || !polygonsOverlap(polygon, influence)) continue
    const openings = Object.values(scene.openings).filter(opening => opening.wallId === wall.id && (opening.state === 'open' || opening.kind === 'window') && (!opening.secret || opening.revealed)).sort((a, b) => a.id.localeCompare(b.id))
    let pieces: MultiPolygon = [[polygon.map(p => [p.x, p.y] as [number, number])]]
    for (const opening of openings) {
      const [a, b] = openingEndpoints(scene, opening), openingPolygon = corridor(a, b, wall.thicknessMm + 2, true).map(qPoint)
      if (openingPolygon.length) pieces = polygonClipping.difference(pieces as any, [openingPolygon.map(p => [p.x, p.y])] as any) as MultiPolygon
    }
    // `pieces` is the actual solid wall after restoring its valid openings.
    for (const part of pieces) {
      if (part.length !== 1) throw new Error(`墙体开口产生孔洞，无法以无孔过渡表达：${wall.id}`)
      masks.push({ id: wall.id, visibility: 'public', polygon: part[0].map(([x, y]) => ({ x, y })), kind: 'obstacle' })
    }
    sourceRecords.push(`wall:${wall.id}:${hash(wall)}:${openings.map(opening => opening.id).join(',')}`)
  }
  for (const prop of Object.values(scene.props).sort((a, b) => a.id.localeCompare(b.id))) {
    if (prop.floorId !== boundary.floorId || (!prop.blocksMovement && !prop.blocksSight)) continue
    const polygon = propFootprint(prop).map(qPoint); if (!polygon.length || !polygonsOverlap(polygon, influence)) continue
    if (prop.visibility === 'gm' && boundary.visibility === 'public') throw new Error(`公开过渡依赖GM物件：${prop.id}`)
    masks.push({ id: prop.id, visibility: prop.visibility, polygon, kind: 'obstacle' }); sourceRecords.push(`prop:${prop.id}:${hash(prop)}`)
  }
  for (const region of Object.values(scene.regions).sort((a, b) => a.id.localeCompare(b.id))) {
    if (region.floorId !== boundary.floorId || !region.blocksMovement) continue
    const polygon = region.boundaryMm.map(qPoint); if (!polygon.length || !polygonsOverlap(polygon, influence)) continue
    if (region.visibility === 'gm' && boundary.visibility === 'public') throw new Error(`公开过渡依赖GM区域：${region.id}`)
    masks.push({ id: region.id, visibility: region.visibility, polygon, kind: 'obstacle' }); sourceRecords.push(`region:${region.id}:${hash(region)}`)
  }
  return { masks, sourceIds: sourceRecords.sort() }
}

function ensureRange(request: TerrainTransitionRequest, boundary: VisualBoundary, sampled: SampledBoundary, floorBounds: BoundsMm): { widthMm: number; reachMm: number; spacing: number } {
  if (!request.id || !request.boundaryId || !positive(request.widthMm) || request.widthMm > Math.hypot(request.clipMm.width, request.clipMm.height)) throw new Error('过渡宽度必须为正且不超过裁剪范围对角线。')
  if (![request.clipMm.x, request.clipMm.y, request.clipMm.width, request.clipMm.height].every(Number.isSafeInteger) || !positive(request.clipMm.width) || !positive(request.clipMm.height)
    || request.clipMm.x < floorBounds.x || request.clipMm.y < floorBounds.y || request.clipMm.x + request.clipMm.width > floorBounds.x + floorBounds.width || request.clipMm.y + request.clipMm.height > floorBounds.y + floorBounds.height) throw new Error('过渡裁剪范围必须完整位于Floor边界内。')
  const spacing = request.sampleSpacingMm ?? boundary.sampleSpacingMm
  if (spacing !== boundary.sampleSpacingMm) throw new Error('过渡采样间距必须锁定为来源边界采样间距。')
  const reachMm = request.reachMm ?? request.widthMm
  if (!positive(reachMm) || reachMm < request.widthMm || !Number.isSafeInteger(reachMm)) throw new Error('过渡距离场reachMm必须是覆盖宽度的正整数。')
  if (!sampled.points.length) throw new Error('过渡来源边界没有采样点。')
  return { widthMm: request.widthMm, reachMm, spacing }
}

function createField(boundary: VisualBoundary, sampled: SampledBoundary, options: { clipMm: BoundsMm; reachMm: number; sampleSpacingMm: number; sourceHash: string }): TerrainDistanceField {
  const boundaryHash = options.sourceHash, inputHash = hash({ algorithmId: 'terrain-distance', algorithmVersion: 1, metric: 'euclidean-mm', boundaryHash, clipMm: options.clipMm, reachMm: options.reachMm, sampleSpacingMm: options.sampleSpacingMm })
  const segments = sampled.points.map((p, i) => [p, sampled.points[i + 1] ?? (sampled.closed ? sampled.points[0] : p)] as [PointMm, PointMm]).filter(([a, b]) => !same(a, b))
  const distanceAt = (point: PointMm): number => {
    let result = Infinity
    for (const [a, b] of segments) { const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy, t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0; result = Math.min(result, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))) }
    return result
  }
  return { sampled, clipMm: cloneJson(options.clipMm), reachMm: options.reachMm, sampleSpacingMm: options.sampleSpacingMm, boundaryHash, inputHash, distanceAt }
}

const toMulti = (polygon: Polygon): MultiPolygon => [[polygon.map(p => [p.x, p.y] as [number, number])]]
const fromMulti = (multi: MultiPolygon): Polygon[] => {
  if (multi.some(poly => poly.length !== 1)) throw new Error('过渡裁剪产生孔洞；首版拒绝隐式填孔。')
  return multi.map(poly => {
    const points = dedupe(poly[0].map(([x, y]) => qPoint({ x, y })))
    if (points.length > 1 && same(points[0], points.at(-1)!)) points.pop()
    return points
  })
}
function materializeBand(center: Polygon, widthMm: number, clipMm: BoundsMm, masks: Mask[]): Polygon[] {
  const stroke = terrainTransitionStrokePolygon(center, widthMm); if (stroke.length < 3) throw new Error('过渡笔触在整数毫米量化后退化。')
  let result: MultiPolygon = polygonClipping.intersection(toMulti(stroke) as any, toMulti(boundsPolygon(clipMm)) as any) as MultiPolygon
  for (const mask of masks.filter(item => item.kind === 'obstacle')) {
    if (!result.length) break
    result = polygonClipping.difference(result as any, toMulti(mask.polygon) as any) as MultiPolygon
  }
  const polygons = fromMulti(result)
  if (!polygons.length) return []
  if (polygons.some(poly => poly.length < 3 || Math.abs(area(poly)) < 1 || poly.some(p => !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)))) throw new Error('过渡裁剪产生退化多边形。')
  for (const poly of polygons) assertSimpleVisualPolyline(poly, true)
  return polygons
}

function transitionSemantics(kind: TerrainTransition['kind'], left: SourceSide, right: SourceSide): void {
  const surfaces = new Set([left.surface, right.surface])
  if ((kind === 'shore' || kind === 'riverMouth') && !surfaces.has('water')) throw new Error(`${kind}过渡必须有真实水面侧。`)
  if (kind === 'grassRock' && !(surfaces.has('grass') && surfaces.has('rock'))) throw new Error('grassRock过渡必须有真实草地和岩石侧。')
  if (kind === 'forestEdge' && !surfaces.has('forest')) throw new Error('forestEdge过渡必须有真实森林侧。')
  if (kind === 'pathShoulder' && !surfaces.has('path')) throw new Error('pathShoulder过渡必须绑定真实道路侧。')
  if (kind === 'cliff' && left.elevationMm === right.elevationMm) throw new Error('cliff过渡必须有真实高差。')
}

function materializeInternal(scene: SceneDocument, request: TerrainTransitionRequest): { row: TerrainTransition; field: TerrainDistanceField } {
  const boundary = visualBoundary(scene, request.boundaryId), sampled = sampleVisualBoundary(boundary), floorBounds = floor(scene, boundary.floorId).boundsMm
  const outputFloorId = request.floorId ?? boundary.floorId, outputLayerId = request.layerId ?? boundary.layerId
  if (outputFloorId !== boundary.floorId) throw new Error('过渡输出Floor必须与来源边界一致。')
  const outputLayer = own(scene.userLayers, outputLayerId)
  if (!outputLayer || outputLayer.floorId !== boundary.floorId) throw new Error('过渡输出图层必须是来源Floor中的现存用户图层。')
  const range = ensureRange(request, boundary, sampled, floorBounds), sources = resolveSources(scene, boundary, sampled)
  transitionSemantics(request.kind, sources.left, sources.right)
  if (request.visibility && request.visibility !== boundary.visibility) throw new Error('过渡visibility必须继承来源边界，不能扩大公开范围。')
  if (boundary.visibility === 'public' && [sources.left.area, sources.right.area].some(area => area?.visibility === 'gm')) throw new Error('公开过渡不能引用GM地形。')
  const normal = (i: number) => sampled.samples[Math.min(i, sampled.samples.length - 1)].normal
  const base = sampled.points.map((point, i) => ({ point, normal: normal(i) }))
  const sideCenters = request.side === 'both' ? [1, -1] : [request.side === 'left' ? 1 : -1]
  const influence = boundsPolygon(expandBounds(request.clipMm, range.widthMm)).map(qPoint)
  const collected = collectMasks(scene, boundary, sources, influence)
  const sourceHash = hash({ boundary, sampled, sources: { left: sources.left.area, right: sources.right.area, leftSourceId: sources.left.sourceId, rightSourceId: sources.right.sourceId, leftSurface: sources.left.surface, rightSurface: sources.right.surface, leftElevationMm: sources.left.elevationMm, rightElevationMm: sources.right.elevationMm }, dependencies: collected.sourceIds })
  const field = createField(boundary, sampled, { clipMm: request.clipMm, reachMm: range.reachMm, sampleSpacingMm: range.spacing, sourceHash })
  const allPolygons: TerrainTransitionPolygon[] = []
  for (const sign of sideCenters) {
    const center = dedupe(base.filter(({ point }) => field.distanceAt(point) <= range.reachMm + range.spacing).map(({ point, normal }) => qPoint({ x: point.x + normal.x * sign * range.widthMm / 2, y: point.y + normal.y * sign * range.widthMm / 2 })))
    if (center.length < 2) continue
    for (const [index, polygon] of materializeBand(center, range.widthMm, request.clipMm, collected.masks).entries()) allPolygons.push({ id: `${request.id}-polygon-${allPolygons.length}`, pointsMm: polygon, fillColor: palette[sign > 0 ? sources.left.surface : sources.right.surface], opacity: request.opacity ?? .78, materialRef: null })
  }
  if (!allPolygons.length) throw new Error('过渡裁剪后没有可保存的几何。')
  if (allPolygons.length > 128) throw new Error('过渡多边形超过128条预算。')
  const common = { id: request.id, floorId: outputFloorId, layerId: outputLayerId, visibility: request.visibility ?? boundary.visibility, editLocked: request.editLocked ?? boundary.editLocked, enabled: request.enabled ?? true, boundaryId: request.boundaryId, kind: request.kind, side: request.side, leftSurface: sources.left.surface, rightSurface: sources.right.surface, leftElevationMm: sources.left.elevationMm, rightElevationMm: sources.right.elevationMm, widthMm: range.widthMm, distanceSource: { algorithmId: 'terrain-distance' as const, algorithmVersion: 1 as const, metric: 'euclidean-mm' as const, boundaryHash: field.boundaryHash, clipMm: cloneJson(request.clipMm), reachMm: range.reachMm, sampleSpacingMm: range.spacing, inputHash: field.inputHash }, polygons: allPolygons, strokes: [] as TerrainTransitionStroke[] }
  const { polygons: _polygons, strokes: _strokes, ...input } = common
  const inputHash = hash({ ...input, dependencies: collected.sourceIds })
  const outputHash = hash({ polygons: common.polygons, strokes: common.strokes })
  const row: TerrainTransition = { ...common, inputHash, outputHash }
  visual3TransitionSchema.parse(row)
  return { row, field }
}

export function materializeTerrainTransition(scene: SceneDocument, request: TerrainTransitionRequest): TerrainTransition {
  return materializeInternal(scene, request).row
}

export function refreshTerrainTransition(scene: SceneDocument, row: TerrainTransition): TerrainTransition {
  return materializeTerrainTransition(scene, { id: row.id, floorId: row.floorId, layerId: row.layerId, visibility: row.visibility, editLocked: row.editLocked, enabled: row.enabled, boundaryId: row.boundaryId, kind: row.kind, side: row.side, widthMm: row.widthMm, clipMm: row.distanceSource.clipMm, sampleSpacingMm: row.distanceSource.sampleSpacingMm, reachMm: row.distanceSource.reachMm, opacity: row.polygons[0]?.opacity ?? row.strokes[0]?.opacity ?? .78 })
}

export function transitionBounds(row: Pick<TerrainTransition, 'polygons' | 'strokes'>): BoundsMm {
  const points = [...row.polygons.flatMap(p => p.pointsMm), ...row.strokes.flatMap(stroke => terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm))]
  return boundsOf(points)
}

export const terrainTransitionInfluenceBounds = transitionBounds

/** Include the persisted source curve and clip/reach, not only old output pixels. */
function transitionRefreshBounds(scene: SceneDocument, row: TerrainTransition): BoundsMm {
  const boundary = scene.visual?.version === 3 ? scene.visual.base.base.boundaries[row.boundaryId] : undefined
  const sourcePoints = boundary?.segments.flatMap(segment => [segment.start, segment.control1, segment.control2, segment.end]) ?? []
  const source = sourcePoints.length ? expandBounds(boundsOf(sourcePoints), row.distanceSource.reachMm + row.distanceSource.sampleSpacingMm) : transitionBounds(row)
  return unionBounds(unionBounds(source, transitionBounds(row)), row.distanceSource.clipMm)
}

/** Complete local dependency envelope: current output plus source curve, clip and reach. */
export const terrainTransitionRefreshBounds = transitionRefreshBounds

export function hitTerrainTransition(row: Pick<TerrainTransition, 'polygons' | 'strokes'>, point: PointMm, toleranceMm = 0): boolean {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) return false
  if (row.polygons.some(polygon => pointInPolygon(point, polygon.pointsMm))) return true
  return row.strokes.some(stroke => {
    const expanded = toleranceMm ? terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm + toleranceMm * 2) : terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm)
    return expanded.length > 2 && pointInPolygon(point, expanded)
  })
}

export function validateTerrainTransition(scene: SceneDocument, row: unknown): Issue[] {
  const issues: Issue[] = [], add = (code: string, message: string) => issues.push({ code, message, entityId: typeof row === 'object' && row && 'id' in row && typeof row.id === 'string' ? row.id : undefined })
  const parsed = visual3TransitionSchema.safeParse(row)
  if (!parsed.success) {
    const boundary = typeof row === 'object' && row !== null && 'boundaryId' in row ? row.boundaryId : undefined
    // Keep a malformed or missing source boundary distinguishable from an
    // otherwise malformed transition.  The strict schema error is retained
    // for every other field so callers still get the complete contract
    // failure without trying to regenerate an invalid row.
    if (typeof boundary !== 'string' || !boundary) add('TRANSITION_BOUNDARY', '过渡必须引用严格视觉边界。')
    add('TRANSITION_SCHEMA', parsed.error.issues.map(issue => issue.message).join('；')); return issues
  }
  try {
    const expected = refreshTerrainTransition(scene, parsed.data)
    if (expected.inputHash !== parsed.data.inputHash) add('TRANSITION_INPUT_HASH', '过渡来源、两侧、开口/障碍依赖或参数哈希失配。')
    if (expected.outputHash !== parsed.data.outputHash) add('TRANSITION_OUTPUT_HASH', '过渡物化几何哈希失配。')
    if (canonicalJson(expected.polygons) !== canonicalJson(parsed.data.polygons) || canonicalJson(expected.strokes) !== canonicalJson(parsed.data.strokes)) add('TRANSITION_GEOMETRY', '过渡几何不是当前严格来源的确定性结果。')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    add(/边界|boundary/i.test(message) ? 'TRANSITION_BOUNDARY' : 'TRANSITION_SOURCE', message)
  }
  return issues
}

export function validateTerrainTransitions(scene: SceneDocument): Issue[] {
  let visual: ReturnType<typeof sceneVisual3>
  try { visual = sceneVisual3(scene) } catch (error) { return [{ code: 'TRANSITION_VERSION', message: error instanceof Error ? error.message : String(error) }] }
  const rows = visual.transitions, issues: Issue[] = []
  for (const [id, row] of Object.entries(rows)) {
    if (id !== row.id) issues.push({ code: 'TRANSITION_ID', message: '过渡记录键必须等于id。', entityId: id })
    issues.push(...validateTerrainTransition(scene, row))
  }
  return issues
}

export function refreshTerrainTransitionsLocal(scene: SceneDocument, request: TransitionLocalRefreshRequest): TransitionLocalRefreshResult {
  const visual = sceneVisual3(scene), ids = request.transitionIds ? new Set(request.transitionIds) : null
  if (![request.scopeMm.x, request.scopeMm.y, request.scopeMm.width, request.scopeMm.height].every(Number.isSafeInteger) || !positive(request.scopeMm.width) || !positive(request.scopeMm.height)) throw new Error('局部过渡范围必须为正整数矩形。')
  const rows: Record<string, TerrainTransition> = Object.fromEntries(Object.entries(visual.transitions).map(([id, row]) => [id, cloneJson(row)])), changedIds: string[] = []
  const widths = Object.values(visual.transitions).map(row => row.widthMm), halo = request.haloMm ?? (widths.length ? Math.max(...widths) : 0)
  if (!Number.isSafeInteger(halo) || halo < 0) throw new Error('局部过渡haloMm必须为非负整数。')
  const readBoundsMm = expandBounds(request.scopeMm, halo)
  for (const row of Object.values(visual.transitions)) {
    if (ids && !ids.has(row.id)) continue
    // Explicit IDs are already a caller-owned dependency closure. For
    // automatic selection use both the old rendered band and the current
    // source curve/clip so a moved boundary cannot leave a stale row behind.
    if (!ids && !boundsOverlap(transitionRefreshBounds(scene, row), readBoundsMm)) continue
    rows[row.id] = refreshTerrainTransition(scene, row); changedIds.push(row.id)
  }
  changedIds.sort()
  return { transitions: rows, changedIds, readBoundsMm }
}

export function createTerrainDistanceField(scene: SceneDocument, request: TerrainTransitionRequest): TerrainDistanceField {
  return materializeInternal(scene, request).field
}

/** Kept private to make accidental zero-hash output obvious in debugger snapshots. */
export const transitionHashSentinel = HASH_ZERO
