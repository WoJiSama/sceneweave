import type { AppearanceGraph } from '../model/appearance.js'
import type { BoundsMm, Opening, PointMm, SceneDocument } from '../model/scene.js'
import type { Projection } from '../projection/types.js'
import { openingEndpoints, propFootprint } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { projectScene } from '../projection/projection.js'
import { validateAppearanceGraph } from '../validation/content.js'
import { cloneJson } from '../validation/json.js'
import { nativeSceneSchema } from '../validation/scene.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'

/** Source audit only, not a claim of successful import or player-view acceptance. */
export const UVTT_TARGET = Object.freeze({ importer: 'Universal Battlemap Importer', version: '6.1.1', foundryMajor: 14,
  source: 'https://github.com/moo-man/FVTT-DD-Import/blob/3c78eb1b640f00b9bc9b3e30382ebbd03ee374ba/ddimport.js' })
export const UVTT_LIMITS = Object.freeze({ minPixelsPerGrid: 50, preferredPixelsPerGrid: 140, maxLongEdgePx: 4096, minLongEdgePx: 256, maxGridSpan: 81, maxCoordinateErrorPx: .05 })
export interface UvttPortal {
  position: PointMm
  bounds: [PointMm, PointMm]
  rotation: number
  /** UBI uses this for door versus proximity-window, never the initial door state. */
  closed: boolean
  freestanding: false
}
export interface UvttLight { position: PointMm; range: number; intensity: number; color: string; shadows: boolean }
export interface UvttGeometry {
  format: 0.2
  resolution: { map_origin: PointMm; map_size: PointMm; pixels_per_grid: number }
  line_of_sight: [PointMm, PointMm][]
  portals: UvttPortal[]
  lights: UvttLight[]
}
export interface UvttUnitsSummary {
  display: 'm' | 'ft'
  gridSizeMm: number
  distancePerGrid: number
  distanceUnit: 'm' | 'ft'
  gridVisible: boolean
}
export interface UvttReport {
  warnings: string[]
  blocked: string[]
  counts: { walls: number; wallSegments: number; portals: number; lights: number; blockingProps: number; hiddenSecretOpenings: number; terrainBlockersOmitted: number }
}
export interface UvttPlan {
  /** An owned player projection, with only UVTT-specific temporary paint changes. */
  projection: Projection | null
  /** The browser must clip drawing to this fixed original extent before adding padding. */
  sourceBoundsMm: BoundsMm
  boundsMm: BoundsMm
  widthPx: number
  heightPx: number
  pixelsPerGrid: number
  units: UvttUnitsSummary
  /** Null whenever any blocking issue exists; never serialize a partial structure package. */
  geometry: UvttGeometry | null
  report: UvttReport
}

const EPS = 1e-8
const point = (x: number, y: number): PointMm => ({ x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y })
const inside = (p: PointMm, b: BoundsMm) => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height
const at = (a: PointMm, b: PointMm, t: number) => point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
const add = (values: string[], message: string) => { if (!values.includes(message)) values.push(message) }
const floorDiv = (value: bigint, divisor: bigint) => { const q = value / divisor; return value < 0n && value % divisor !== 0n ? q - 1n : q }
const ceilDiv = (value: bigint, divisor: bigint) => -floorDiv(-value, divisor)

/** Clip each independent physical line, without joining endpoints or creating a crop-border wall. */
function clipSegment(a: PointMm, b: PointMm, bounds: BoundsMm): [PointMm, PointMm] | null {
  const dx = b.x - a.x, dy = b.y - a.y
  let near = 0, far = 1
  for (const [p, q] of [[-dx, a.x - bounds.x], [dx, bounds.x + bounds.width - a.x], [-dy, a.y - bounds.y], [dy, bounds.y + bounds.height - a.y]]) {
    if (Math.abs(p) < EPS) { if (q < 0) return null; continue }
    const t = q / p
    if (p < 0) near = Math.max(near, t)
    else far = Math.min(far, t)
    if (near > far) return null
  }
  if ((far - near) * Math.hypot(dx, dy) < EPS) return null
  const bounded = (t: number) => { const p = at(a, b, t); return point(Math.max(bounds.x, Math.min(bounds.x + bounds.width, p.x)), Math.max(bounds.y, Math.min(bounds.y + bounds.height, p.y))) }
  return [bounded(near), bounded(far)]
}

interface WallLine { points: [PointMm, PointMm]; semantics: string }
/** Match player projection normalization: private split vertices cannot survive as LOS endpoints. */
function canonicalWallLines(lines: WallLine[], report: UvttReport): [PointMm, PointMm][] {
  const active = new Map(lines.map((line, index) => [index, line])), ends = new Map<string, Set<number>>()
  const key = (p: PointMm) => `${p.x},${p.y}`
  const register = (index: number, line: WallLine) => { for (const p of line.points) { const values = ends.get(key(p)) ?? new Set<number>(); values.add(index); ends.set(key(p), values) } }
  const remove = (index: number, line: WallLine) => { for (const p of line.points) { const values = ends.get(key(p)); values?.delete(index); if (!values?.size) ends.delete(key(p)) } }
  lines.forEach((line, index) => register(index, line))
  for (let index = 0; index < lines.length; index++) {
    let merged = true
    while (merged && active.has(index)) {
      merged = false
      const row = active.get(index)!
      search: for (const joint of row.points) for (const otherIndex of ends.get(key(joint)) ?? []) {
        if (otherIndex === index) continue
        const other = active.get(otherIndex)!, a = row.points.find(p => key(p) !== key(joint))!, b = other.points.find(p => key(p) !== key(joint))!
        const ax = a.x - joint.x, ay = a.y - joint.y, bx = b.x - joint.x, by = b.y - joint.y
        if (ax * bx + ay * by >= 0 || Math.abs(ax * by - ay * bx) > EPS * Math.max(Math.hypot(ax, ay), Math.hypot(bx, by))) continue
        if (row.semantics !== other.semantics) {
          if (report.counts.hiddenSecretOpenings) add(report.blocked, '共线墙具有不同的移动或视线语义，无法证明归一化后的结构不泄露隐藏拆分；请使用普通玩家 PNG。')
          continue
        }
        remove(index, row); remove(otherIndex, other); active.delete(otherIndex)
        const next: WallLine = { points: [a, b], semantics: row.semantics }
        active.set(index, next); register(index, next); merged = true; break search
      }
    }
  }
  const comparePoint = (a: PointMm, b: PointMm) => a.x - b.x || a.y - b.y
  return [...active.values()].map(row => [...row.points].sort(comparePoint) as [PointMm, PointMm]).sort((a, b) => comparePoint(a[0], b[0]) || comparePoint(a[1], b[1]))
}

function layout(scene: SceneDocument, report: UvttReport) {
  const source = scene.exportBoundsMm, grid = BigInt(scene.units.gridSizeMm)
  const left = floorDiv(BigInt(source.x), grid), top = floorDiv(BigInt(source.y), grid)
  const right = ceilDiv(BigInt(source.x) + BigInt(source.width), grid), bottom = ceilDiv(BigInt(source.y) + BigInt(source.height), grid)
  const values = [left * grid, top * grid, (right - left) * grid, (bottom - top) * grid, right * grid, bottom * grid]
  if (!values.every(value => value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER))) {
    add(report.blocked, '整格补边超出安全整数毫米范围；请缩小或移动导出范围，或使用普通玩家 PNG。')
    return { boundsMm: cloneJson(source), widthPx: 0, heightPx: 0, pixelsPerGrid: 0 }
  }
  const boundsMm = { x: Number(values[0]), y: Number(values[1]), width: Number(values[2]), height: Number(values[3]) }
  const columns = right - left, rows = bottom - top, longest = columns > rows ? columns : rows
  if (longest > BigInt(UVTT_LIMITS.maxGridSpan)) {
    add(report.blocked, '整格补边后的长边超过 81 格，无法同时满足每格至少 50 像素与 4096 像素上限；请调整格距或导出范围，或使用普通玩家 PNG。')
    return { boundsMm, widthPx: 0, heightPx: 0, pixelsPerGrid: 0 }
  }
  const span = Number(longest), pixelsPerGrid = Math.max(Math.ceil(UVTT_LIMITS.minLongEdgePx / span), Math.min(UVTT_LIMITS.preferredPixelsPerGrid, Math.floor(UVTT_LIMITS.maxLongEdgePx / span)))
  if (boundsMm.x !== source.x || boundsMm.y !== source.y || boundsMm.width !== source.width || boundsMm.height !== source.height)
    add(report.warnings, '图片向世界主格起点补边并扩为整格尺寸；新增边带留空，不绘制原导出范围外的内容。')
  return { boundsMm, widthPx: Number(columns) * pixelsPerGrid, heightPx: Number(rows) * pixelsPerGrid, pixelsPerGrid }
}

function hasPrivateStructure(scene: SceneDocument): boolean {
  const visible = createPublicVisibility(scene)
  return Object.values(scene.rooms).some(value => !visible.room(value.id))
    || Object.values(scene.terrainAreas).some(value => !visible.terrainArea(value.id))
    || Object.values(scene.props).some(value => !visible.prop(value))
    || Object.values(scene.paths).some(value => !visible.path(value.id))
    || Object.values(scene.terrainEdges).some(value => !visible.terrainEdge(value.id))
    || Object.values(scene.terrainConnections).some(value => !visible.terrainConnection(value.id))
    || Object.values(scene.regions).some(value => value.kind !== 'manualMask' && value.visibility !== 'public')
    || Object.values(scene.decorations ?? {}).some(value => !visible.decoration(value))
}

function temporaryProjection(projection: Projection, boundsMm: BoundsMm): Projection {
  const result = cloneJson(projection)
  result.bounds = cloneJson(boundsMm); result.gridSizeMm = null; result.notes = []; result.regions = []
  for (const wall of result.walls) for (const opening of wall.openings) opening.paintSymbol = false
  if (result.visual) result.visual.lights = []
  return result
}

/** Pure format planning only. The browser export owner must independently validate all actual resources. */
export function buildUvttPlan(input: SceneDocument, appearance?: AppearanceGraph): UvttPlan {
  const report: UvttReport = { warnings: [
    '本文件按 Universal Battlemap Importer 6.1.1 的固定源码映射生成；目标 Foundry 14 的真实导入、玩家视角与保存重开尚待验收。',
    '导入时关闭自定义每格像素和可开关窗户，墙偏移设为 0、精度设为最高；按下方实际单位与每格距离手动核对目标场景格线。',
    '环境、阴影、雾与滤镜保留为静态底图效果，不创建目标原生实体；动态光照结果仍须在目标端复核。',
  ], blocked: [], counts: { walls: 0, wallSegments: 0, portals: 0, lights: 0, blockingProps: 0, hiddenSecretOpenings: 0, terrainBlockersOmitted: 0 } }
  const checked = validateSceneSnapshot(input)
  let scene: SceneDocument
  if (checked.ok) scene = checked.document
  else {
    // An unsupported Floor count still gets a safe, structured refusal; invalid source data never gets a plan.
    const parsed = checked.errors.some(issue => issue.code === 'UNSUPPORTED_FLOORS') ? nativeSceneSchema.safeParse(input) : null
    if (!parsed?.success) throw new Error('场景未通过完整模型校验，不能生成 UVTT 导出计划。')
    scene = parsed.data as SceneDocument
  }
  const grid = scene.units.gridSizeMm, size = layout(scene, report), sourceBoundsMm = cloneJson(scene.exportBoundsMm)
  const units: UvttUnitsSummary = { display: scene.units.display, gridSizeMm: grid, distancePerGrid: grid / (scene.units.display === 'ft' ? 304.8 : 1000), distanceUnit: scene.units.display, gridVisible: scene.units.gridVisible }
  const plan: UvttPlan = { ...size, sourceBoundsMm, units, projection: null, geometry: null, report }
  if (Object.keys(scene.floors).length !== 1) {
    add(report.blocked, 'UVTT 结构包仅支持单 Floor；请使用受支持的单层工程或普通玩家 PNG。')
    return plan
  }
  if (scene.mapMode === 'regional') add(report.blocked, '区域地图不具有本适配器支持的战斗场景结构；请使用普通玩家 PNG。')
  if (Object.values(scene.regions).some(value => value.kind === 'manualMask'))
    add(report.blocked, '场景使用固定私密遮罩，无法证明 UVTT 原生结构与灯光的玩家保密；请导出普通玩家 PNG。')
  if (hasPrivateStructure(scene))
    add(report.blocked, '场景含无法可靠映射的私密几何或依赖，结构包已阻止；请使用安全的普通玩家 PNG。')
  let projection: Projection
  try {
    const graph = appearance === undefined ? undefined : validateAppearanceGraph(appearance, scene)
    projection = projectScene(scene, 'player', graph)
  } catch {
    add(report.blocked, '无法建立完整且安全的玩家投影；请先处理普通玩家 PNG 的导出限制。')
    return plan
  }
  plan.projection = temporaryProjection(projection, size.boundsMm)
  if (projection.limitations.length) add(report.blocked, '当前场景包含尚不支持的绘制特征；请先处理普通玩家 PNG 的导出限制。')
  if (report.blocked.length) return plan

  const origin = point(size.boundsMm.x / grid, size.boundsMm.y / grid)
  const worldGrid = (p: PointMm) => {
    const converted = point(p.x / grid, p.y / grid)
    // UBI subtracts the absolute grid origin before scaling. Reject cancellation
    // that cannot agree with the renderer's local-world transform to 0.05px.
    const errorX = Math.abs(((converted.x - origin.x) - (p.x - size.boundsMm.x) / grid) * size.pixelsPerGrid)
    const errorY = Math.abs(((converted.y - origin.y) - (p.y - size.boundsMm.y) / grid) * size.pixelsPerGrid)
    const sx = size.widthPx / size.boundsMm.width, sy = size.heightPx / size.boundsMm.height
    const canvasErrorX = Math.abs(p.x * sx - size.boundsMm.x * sx - (p.x - size.boundsMm.x) * sx)
    const canvasErrorY = Math.abs(p.y * sy - size.boundsMm.y * sy - (p.y - size.boundsMm.y) * sy)
    if (![errorX, errorY, canvasErrorX, canvasErrorY].every(value => Number.isFinite(value) && value <= UVTT_LIMITS.maxCoordinateErrorPx))
      add(report.blocked, '绝对世界坐标过大，导入器减原点后的误差超过 0.05 像素；请将场景移近世界原点或使用普通玩家 PNG。')
    return converted
  }
  worldGrid(point(sourceBoundsMm.x, sourceBoundsMm.y))
  worldGrid(point(sourceBoundsMm.x + sourceBoundsMm.width, sourceBoundsMm.y + sourceBoundsMm.height))
  const geometry: UvttGeometry = { format: .2, resolution: { map_origin: worldGrid(point(size.boundsMm.x, size.boundsMm.y)), map_size: point(size.boundsMm.width / grid, size.boundsMm.height / grid), pixels_per_grid: size.pixelsPerGrid }, line_of_sight: [], portals: [], lights: [] }
  const lineKeys = new Set<string>(), sourceWallLines: WallLine[] = []
  const appendLine = (a: PointMm, b: PointMm, semantics?: string): boolean => {
    const clipped = clipSegment(a, b, sourceBoundsMm)
    if (!clipped) return false
    const converted = clipped.map(worldGrid) as [PointMm, PointMm], key = converted.map(p => `${p.x},${p.y}`).sort().join('|')
    if (lineKeys.has(key)) return false
    lineKeys.add(key); geometry.line_of_sight.push(converted)
    if (semantics !== undefined) sourceWallLines.push({ points: clipped, semantics })
    return true
  }
  const openingsByWall = new Map<string, Opening[]>()
  for (const opening of Object.values(scene.openings)) {
    const values = openingsByWall.get(opening.wallId) ?? []
    values.push(opening); openingsByWall.set(opening.wallId, values)
  }
  for (const wall of Object.values(scene.walls).sort((a, b) => a.id.localeCompare(b.id))) {
    const av = scene.vertices[wall.startVertexId], bv = scene.vertices[wall.endVertexId], a = point(av.xMm, av.yMm), b = point(bv.xMm, bv.yMm)
    if (!clipSegment(a, b, sourceBoundsMm)) continue
    report.counts.walls++
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
    const parameter = (p: PointMm) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2
    const gaps: [number, number][] = []
    let hiddenSecret = false
    for (const opening of openingsByWall.get(wall.id) ?? []) {
      const ends = openingEndpoints(scene, opening), clipped = clipSegment(...ends, sourceBoundsMm)
      if (!clipped) continue
      if (opening.secret && !opening.revealed) { hiddenSecret = true; report.counts.hiddenSecretOpenings++; continue }
      if (!ends.every(end => inside(end, sourceBoundsMm))) {
        add(report.blocked, '导出范围切过门窗，不能安全偏移、截短或扩大原生开口；请调整范围或使用普通玩家 PNG。')
        continue
      }
      const values = ends.map(parameter).sort((left, right) => left - right)
      gaps.push([values[0], values[1]])
      geometry.portals.push({ position: worldGrid(at(ends[0], ends[1], .5)), bounds: ends.map(worldGrid) as [PointMm, PointMm], rotation: (Math.atan2(ends[1].y - ends[0].y, ends[1].x - ends[0].x) * 180 / Math.PI + 360) % 360, closed: opening.kind === 'door', freestanding: false })
      if (!wall.blocksMovement && !wall.blocksSight) add(report.warnings, '部分门窗附着于原本不阻挡移动或视线的墙；导入器将这些开口建立为默认阻挡门窗，请在目标端复核并校正。')
      if (opening.kind === 'window') add(report.warnings, '窗户映射为导入器的近距透光窗：保持移动阻挡，但采用目标端固定的视线/光照阈值，不保证与本地窗户完全一致。')
      if (opening.kind === 'door') add(report.warnings, '普通门导入为可操作门；导入器不读取本地开关状态，请在目标端逐门核对并设置。')
      if (opening.locked) add(report.warnings, '上锁状态无法通过该导入器保留；请在目标端重新设置门锁。')
      if (opening.secret) add(report.warnings, '已揭示秘密门降级为普通门；目标端不会保留秘密门类型或揭示记录。')
    }
    if (wall.blocksMovement !== wall.blocksSight) add(report.warnings, '部分墙仅阻挡移动或视线；原生薄墙按同时阻挡两者保守导出，请复核目标通行与视线。')
    if (hiddenSecret && !wall.blocksMovement && !wall.blocksSight)
      add(report.blocked, '非阻挡墙上的未揭示秘密门无法安全降级为连续阻挡墙，结构包已阻止；请使用普通玩家 PNG。')
    if (wall.blocksMovement || wall.blocksSight) {
      const semantics = `${wall.blocksMovement}/${wall.blocksSight}`
      let start = 0
      for (const [near, far] of gaps.sort((left, right) => left[0] - right[0])) { if (near > start + EPS) appendLine(at(a, b, start), at(a, b, near), semantics); start = Math.max(start, far) }
      if (start < 1 - EPS) appendLine(at(a, b, start), b, semantics)
    }
  }
  geometry.line_of_sight = canonicalWallLines(sourceWallLines, report).map(ends => ends.map(worldGrid) as [PointMm, PointMm])
  lineKeys.clear()
  for (const ends of geometry.line_of_sight) lineKeys.add(ends.map(p => `${p.x},${p.y}`).sort().join('|'))
  if (report.counts.walls) add(report.warnings, '墙厚仅保留在底图，原生墙使用中心线；通道净宽、碰撞与墙角需在目标端复核。')
  if (report.counts.hiddenSecretOpenings) add(report.warnings, '未揭示秘密门安全降级为连续普通墙，不导出秘密门位置或可操作门；需要时在主持人目标工程中另行配置。')
  for (const prop of projection.props) {
    if (!prop.blocksMovement && !prop.blocksSight) continue
    const footprint = propFootprint(prop), before = geometry.line_of_sight.length
    for (let index = 0; index < footprint.length; index++) appendLine(footprint[index], footprint[(index + 1) % footprint.length])
    if (geometry.line_of_sight.length > before) report.counts.blockingProps++
    if (prop.blocksMovement !== prop.blocksSight && geometry.line_of_sight.length > before)
      add(report.warnings, '部分物件仅阻挡移动或视线；按旋转后的物理占地边界保守映射为同时阻挡两者的薄墙。')
  }
  report.counts.terrainBlockersOmitted = Object.values(scene.terrainAreas).filter(value => value.blocksMovement || value.blocksSight).length
    + Object.values(scene.terrainEdges).filter(value => value.blocksMovement || value.blocksSight || value.kind === 'cliff').length
    + Object.values(scene.regions).filter(value => value.blocksMovement).length
    + Object.values(scene.terrainConnections).filter(value => value.blocksMovement).length
  if (Object.keys(scene.terrainAreas).length || Object.keys(scene.terrainEdges).length || Object.keys(scene.terrainConnections).length || Object.keys(scene.paths).length || Object.keys(scene.regions).length || Object.keys(scene.rooms).length)
    add(report.warnings, '地形面及边缘、悬崖、高程、楼梯/坡道、道路和区域的阻挡、通行、净宽与移动代价未映射为原生规则；外观保留在底图，不能据图像认定已可通行。')
  if (Object.keys(scene.notes).length || Object.keys(scene.regions).length) add(report.warnings, '注记和区域边框不写入 UVTT 底图，也不作为文字或区域元数据导出。')
  for (const light of projection.visual?.lights ?? []) {
    if (!light.enabled || light.visibility !== 'public' || !light.intensity) continue
    if (!inside(light.positionMm, sourceBoundsMm)) { add(report.warnings, '中心位于原导出范围外的点光不导出；目标端不会保留这些范围外灯光对画面的影响。'); continue }
    geometry.lights.push({ position: worldGrid(light.positionMm), range: light.radiusMm / grid, intensity: light.intensity * 10, color: `FF${light.color.slice(1).toUpperCase()}`, shadows: light.wallOcclusion })
    if (!light.wallOcclusion) add(report.warnings, '导入器忽略 shadows，无法保留不受墙遮挡的点光设置；请在目标端复核灯光遮挡。')
    if (light.positionMm.x - light.radiusMm < sourceBoundsMm.x || light.positionMm.y - light.radiusMm < sourceBoundsMm.y || light.positionMm.x + light.radiusMm > sourceBoundsMm.x + sourceBoundsMm.width || light.positionMm.y + light.radiusMm > sourceBoundsMm.y + sourceBoundsMm.height)
      add(report.warnings, '部分点光半径越过原导出范围；原生点光不截短半径，目标端光效可能延伸到图片外。')
  }
  report.counts.wallSegments = geometry.line_of_sight.length
  report.counts.portals = geometry.portals.length; report.counts.lights = geometry.lights.length
  if (geometry.lights.length) {
    add(report.warnings, '显式点光移交目标原生灯，底图不再烘焙点光；本地强度除以 2 映射目标 alpha，目标明亮半径为昏暗半径的一半，颜色与光照不是逐像素等价。')
    add(report.warnings, '导入器按游戏系统默认每格距离计算灯光半径，随后修改场景格距不会自动校正灯光；请按导出摘要中每盏灯的目标 dim/bright 数值逐一核对半径。')
  }
  if (!report.blocked.length) plan.geometry = geometry
  return plan
}
